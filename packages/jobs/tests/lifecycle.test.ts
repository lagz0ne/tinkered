import {
  createScope,
  extension,
  makeTestClock,
  operation,
  type Operation,
  type Observe,
} from "@tinker/core";
import { hono } from "@tinker/hono";
import { sql } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { isError, job, jobs } from "../src/index.ts";
import { fixture, scopes, store } from "./fixtures.ts";

test("graceful close stops fetching and lets a running job commit", async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const work = operation({
    label: "wait and save",
    depends: { tx: store.tx },
    run: async ({ tx }, ctx: Operation.Ctx<{ value: string }>) => {
      await tx.execute(sql`insert into receipts values (${ctx.input.value})`);
      entered.resolve();
      await finish.promise;
    },
  });
  const { client, clock, piece, tags } = await fixture([job("wait", work)]);
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  await scope.session(async (s) => {
    await s.run(piece.send, { input: { queue: "wait", data: { value: "first" } } });
    await s.run(piece.send, { input: { queue: "wait", data: { value: "second" } } });
  });
  const tick = clock.advance(500);
  await entered.promise;
  const closing = scope.close({ graceful: true });
  finish.resolve();
  await tick;
  expect((await closing).status).toBe("success");
  expect((await client.query("select * from receipts")).rows).toHaveLength(1);
  expect((await client.query("select state from pgboss.job order by state")).rows).toEqual([
    { state: "created" },
    { state: "completed" },
  ]);
});

test("forced close cancels the running job and rolls its session back", async () => {
  const entered = Promise.withResolvers<void>();
  const work = operation({
    label: "wait for abort",
    depends: { tx: store.tx },
    run: async ({ tx }, ctx) => {
      await tx.execute(sql`insert into receipts values ('cancelled')`);
      entered.resolve();
      await ctx.clock.sleep(60000, ctx.signal);
    },
  });
  const { client, clock, piece, tags } = await fixture([job("wait", work)]);
  const scope = createScope({ tags, clock: makeTestClock(), extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(piece.send, { input: { queue: "wait", data: {} } }));
  const tick = clock.advance(500);
  await entered.promise;
  const closed = await scope.close();
  await tick;
  expect(closed.status).toBe("cancelled");
  expect((await client.query("select * from receipts")).rows).toEqual([]);
  expect((await client.query("select state, output from pgboss.job")).rows).toEqual([
    {
      state: "retry",
      output: expect.objectContaining({ kind: "JobCancelled", payload: { queue: "wait" } }),
    },
  ]);
});

test("bad settings fail boot naming JOBS_URL before serving", async () => {
  for (const JOBS_URL of [
    undefined,
    "",
    "https://wrong.example",
    "postgres://",
    "postgres:///jobs",
  ]) {
    let opened = false;
    const web = hono([], {
      serve: () => {
        opened = true;
      },
    }).extension;
    const piece = jobs([], { tx: store.tx, env: { JOBS_URL } });
    const scope = createScope({ extensions: [web, piece.extension] });
    scopes.push(scope);
    try {
      await scope.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "InvalidConfig")) throw error;
      expect(error.payload.keys).toEqual(["JOBS_URL"]);
    }
    expect(opened).toBe(false);
  }
});

test("a piece rejects a second live scope and restarts after close", async () => {
  const { client, piece, tags } = await fixture([]);
  const first = createScope({ tags, extensions: [piece.extension] });
  scopes.push(first);
  await first.ready;
  const second = createScope({ tags, extensions: [piece.extension] });
  scopes.push(second);
  try {
    await second.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "PieceInUse")) throw error;
    expect(error.payload).toEqual({ label: "jobs" });
  }
  await first.close();
  const third = createScope({ tags, extensions: [piece.extension] });
  scopes.push(third);
  await third.ready;
  await first.close();
  await second.close();
  const fourth = createScope({ tags, extensions: [piece.extension] });
  scopes.push(fourth);
  await expect(fourth.ready).rejects.toMatchObject({
    kind: "PieceInUse",
    payload: { label: "jobs" },
  });
  expect((await client.query("select count(*)::int as count from pgboss.version")).rows).toEqual([
    { count: 1 },
  ]);
});

test("a failed later start stops jobs and leaves the borrowed database open", async () => {
  const { client, clock, piece, tags } = await fixture([]);
  const cleaned = Promise.withResolvers<void>();
  const cleanup = extension({
    label: "observe cleanup",
    start: async (_scope, ctx, next) => {
      ctx.defer(() => cleaned.resolve());
      await next();
    },
  });
  const broken = extension({
    label: "broken",
    start: (_scope, ctx) => ctx.raise("BootFailed", {}),
  });
  const scope = createScope({ tags, extensions: [cleanup, piece.extension, broken] });
  scopes.push(scope);
  await expect(scope.ready).rejects.toMatchObject({ kind: "BootFailed" });
  await cleaned.promise;
  const fresh = createScope({ tags, extensions: [piece.extension] });
  scopes.push(fresh);
  await fresh.ready;
  await fresh.close();
  expect((await client.query("select count(*)::int as count from pgboss.version")).rows).toEqual([
    { count: 1 },
  ]);
  await client.close();
  await clock.advance(60000);
});

test("an unreachable JOBS_URL fails boot at the given Postgres address", async () => {
  for (const scheme of ["postgres", "postgresql"]) {
    const piece = jobs([], { tx: store.tx, env: { JOBS_URL: `${scheme}://127.0.0.1:1/jobs` } });
    const scope = createScope({ extensions: [piece.extension] });
    scopes.push(scope);
    try {
      await scope.ready;
      expect.unreachable();
    } catch (error) {
      if (isError(error, "InvalidConfig")) throw error;
      expect(error).toMatchObject({ code: "ECONNREFUSED", address: "127.0.0.1", port: 1 });
    }
    await scope.close();
  }
});

test("a piece stays owned until the whole root close ends", async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const late = extension({
    label: "late cleanup",
    start: async (_scope, ctx, next) => {
      ctx.defer(async () => {
        entered.resolve();
        await finish.promise;
      });
      await next();
    },
  });
  const { piece, tags } = await fixture([]);
  const first = createScope({ tags, extensions: [late, piece.extension] });
  scopes.push(first);
  await first.ready;
  const closing = first.close({ graceful: true });
  await entered.promise;
  const second = createScope({ tags, extensions: [piece.extension] });
  scopes.push(second);
  try {
    await second.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "PieceInUse")) throw error;
    expect(error.payload).toEqual({ label: "jobs" });
  } finally {
    finish.resolve();
    await closing;
  }
});

test("closing stops other queues while a running job drains", async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const wait = operation({
    label: "wait without transaction",
    run: async () => {
      entered.resolve();
      await finish.promise;
    },
  });
  let ran = false;
  const other = operation({
    label: "other queue",
    run: () => {
      ran = true;
    },
  });
  const { client, clock, piece, tags } = await fixture([job("wait", wait), job("other", other)]);
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(piece.send, { input: { queue: "wait", data: {} } }));
  await clock.advance(500);
  await entered.promise;
  await scope.session((s) => s.run(piece.send, { input: { queue: "other", data: {} } }));
  const closing = scope.close({ graceful: true });
  try {
    await clock.advance(5000);
    expect(ran).toBe(false);
    expect((await client.query("select state from pgboss.job where name = 'other'")).rows).toEqual([
      { state: "created" },
    ]);
  } finally {
    finish.resolve();
    await closing;
  }
});

test("worker database faults reach the scope log", async () => {
  const logs: Observe.Log[] = [];
  const work = operation({ label: "unreachable job", run: () => undefined });
  const { client, clock, piece, tags } = await fixture([job("work", work)]);
  const scope = createScope({
    tags,
    extensions: [piece.extension],
    observe: { log: (log) => logs.push(log) },
  });
  scopes.push(scope);
  await scope.ready;
  await client.exec("drop table pgboss.job cascade");
  await clock.advance(1000);
  await expect.poll(() => logs.filter((log) => log.level === 50).length).toBeGreaterThan(0);
  for (const log of logs.filter((log) => log.level === 50)) {
    expect(log.message).toBe("jobs worker failed");
    expect(log.attributes.error).toMatchObject({ code: "42P01" });
  }
});
