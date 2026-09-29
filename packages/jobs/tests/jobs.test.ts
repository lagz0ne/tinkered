import { createScope, data, operation, type Operation, type Observe } from "@tinker/core";
import { hono, route } from "@tinker/hono";
import { sql } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { job } from "../src/index.ts";
import { fixture, scopes, store } from "./fixtures.ts";

const save = operation({
  label: "save receipt",
  depends: { tx: store.tx },
  run: async ({ tx }, { input }: Operation.Ctx<{ value: string }>) => {
    await tx.execute(sql`insert into receipts values (${input.value})`);
  },
});

async function readStates(client: Awaited<ReturnType<typeof fixture>>["client"]) {
  return (await client.query("select state, retry_count from pgboss.job order by created_on")).rows;
}

test("a committed request runs its job once with its data", async () => {
  const { client, clock, piece, tags } = await fixture([job("save", save)]);
  const add = operation({
    label: "add job",
    depends: { send: piece.send },
    run: ({ send }) => send.run({ input: { queue: "save", data: { value: "hello" } } }),
  });
  const web = hono([route.post("/", add)]).extension;
  const scope = createScope({ tags, extensions: [piece.extension, web] });
  scopes.push(scope);
  await scope.ready;
  const response = await scope.resolve(web).request("/", { method: "POST" });
  expect(response.status).toBe(200);
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 0 }]);
  await clock.advance(2000);
  expect((await client.query("select * from receipts")).rows).toEqual([{ value: "hello" }]);
});

test("a rolled back request leaves no job", async () => {
  const { client, clock, piece, tags } = await fixture([job("save", save)]);
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  const request = scope.createSession();
  await request.run(piece.send, { input: { queue: "save", data: { value: "gone" } } });
  await request.close();
  await clock.advance(1000);
  expect(await readStates(client)).toEqual([]);
  expect((await client.query("select * from receipts")).rows).toEqual([]);
});

test("a failing job retries then stays failed and logs one line", async () => {
  let attempts = 0;
  const fail = operation({
    label: "fail receipt",
    depends: { tx: store.tx },
    run: async ({ tx }, ctx) => {
      attempts++;
      await tx.execute(sql`insert into receipts values ('rolled back')`);
      ctx.raise("NoReceipt", {});
    },
  });
  const { client, clock, piece, tags } = await fixture([
    job("fail", fail, { retryLimit: 2, retryDelay: 2 }),
  ]);
  const logs: Observe.Log[] = [];
  const scope = createScope({
    tags,
    extensions: [piece.extension],
    observe: { log: (log) => logs.push(log) },
  });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(piece.send, { input: { queue: "fail", data: {} } }));
  for (let retry = 0; retry <= 2; retry++) {
    await clock.advance(retry === 0 ? 1000 : 2000);
    await expect
      .poll(() => readStates(client))
      .toEqual([{ state: retry === 2 ? "failed" : "retry", retry_count: retry }]);
  }
  await clock.advance(5000);
  expect(attempts).toBe(3);
  expect((await client.query("select * from receipts")).rows).toEqual([]);
  expect(logs.filter((log) => log.message === "job failed").map((log) => log.attributes)).toEqual([
    { queue: "fail", id: expect.any(String), error: expect.any(Error) },
  ]);
});

test("each job gets its own session cell", async () => {
  const count = data({ label: "count", initial: 0 });
  const seen: number[] = [];
  const change = operation({
    label: "change count",
    depends: { count: count.controller },
    run: ({ count }) => {
      seen.push(count.get());
      count.set(9);
    },
  });
  const { client, clock, piece, tags } = await fixture([job("count", change)]);
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  for (let i = 0; i < 2; i++) {
    await scope.session((s) => s.run(piece.send, { input: { queue: "count", data: {} } }));
    await clock.advance(1000);
    await expect.poll(() => readStates(client)).toHaveLength(i + 1);
    await expect.poll(() => seen.length).toBe(i + 1);
  }
  expect(seen).toEqual([0, 0]);
});

test("a cron row creates a job when the test clock reaches its schedule", async () => {
  const received: object[] = [];
  const receive = operation({
    label: "cron receipt",
    run: (_deps, ctx: Operation.Ctx<object>) => {
      received.push(ctx.input);
    },
  });
  const { client, clock, piece, tags } = await fixture([
    job("cron", receive, { cron: "1 * * * *" }),
  ]);
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  await clock.advance(59000);
  expect(received).toEqual([]);
  await clock.advance(10000);
  await expect
    .poll(async () => (await client.query("select state from pgboss.job where name = 'cron'")).rows)
    .toEqual([{ state: "completed" }]);
  expect(received).toEqual([{}]);
});

test("an open request can add jobs while due jobs wait for PGlite", async () => {
  const { client, clock, piece, tags } = await fixture([job("save", save)]);
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) =>
    s.run(piece.send, { input: { queue: "save", data: { value: "due" } } }),
  );
  const request = scope.createSession();
  await request.run(piece.send, { input: { queue: "save", data: { value: "request" } } });
  const polling = clock.advance(1000);
  await request.run(piece.send, { input: { queue: "save", data: { value: "still open" } } });
  await request.close({ graceful: true });
  await polling;
  await clock.advance(2000);
  await expect
    .poll(() => readStates(client))
    .toEqual(Array.from({ length: 3 }, () => ({ state: "completed", retry_count: 0 })));
  expect((await client.query("select value from receipts order by value")).rows).toEqual([
    { value: "due" },
    { value: "request" },
    { value: "still open" },
  ]);
});

test("a failed commit fails the job instead of marking it complete", async () => {
  const work = operation({
    label: "save duplicate",
    depends: { tx: store.tx },
    run: async ({ tx }) => {
      await tx.execute(sql`insert into receipts values ('same'), ('same')`);
    },
  });
  const { client, clock, piece, tags } = await fixture([job("duplicate", work, { retryLimit: 0 })]);
  await client.exec("alter table receipts add unique (value) deferrable initially deferred");
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(piece.send, { input: { queue: "duplicate", data: {} } }));
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "failed", retry_count: 0 }]);
  expect((await client.query("select * from receipts")).rows).toEqual([]);
});

test("job input passes through its operation parser", async () => {
  const parsed = operation({
    label: "parse receipt",
    input: (raw) => JSON.stringify(raw),
    depends: { tx: store.tx },
    run: async ({ tx }, ctx) => {
      await tx.execute(sql`insert into receipts values (${ctx.input})`);
    },
  });
  const { client, clock, piece, tags } = await fixture([job("parse", parsed)]);
  const scope = createScope({ tags, extensions: [piece.extension] });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) =>
    s.run(piece.send, { input: { queue: "parse", data: { value: "parsed" } } }),
  );
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 0 }]);
  expect((await client.query("select * from receipts")).rows).toEqual([
    { value: '{"value":"parsed"}' },
  ]);
});
