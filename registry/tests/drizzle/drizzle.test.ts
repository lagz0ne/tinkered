import { expect, test } from "vite-plus/test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  createScope,
  isError as isCoreError,
  namespace,
  operation,
  resource,
  tag,
  type Observe,
  type Resource,
} from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";
import { createQueryLogger, openTransaction } from "../../src/drizzle/index.ts";

const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});
const config = tag<{ url: string }>({ label: "users.config" });

async function openUsers({ config }: { config: { url: string } }, ctx: Resource.Ctx) {
  const client = new PGlite(config.url);
  ctx.defer(() => client.close());
  const db = drizzle({ client, logger: createQueryLogger(ctx) });
  await db.execute(sql`create table users (id serial primary key, name text not null)`);
  ctx.log("database opened", { url: config.url });
  return db;
}

const sharedDatabase = resource({
  label: "sharedDatabase",
  target: "scope",
  depends: { config },
  factory: openUsers,
});
const database = resource({
  label: "database",
  target: "namespace",
  depends: { config },
  factory: openUsers,
});
const transaction = resource({
  label: "transaction",
  target: "session",
  depends: { db: database },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
const borrowedClient = tag<PGlite>({ label: "borrowedClient" });
const borrowedDatabase = resource({
  label: "borrowedDatabase",
  target: "scope",
  depends: { client: borrowedClient },
  factory: ({ client }, ctx) => drizzle({ client, logger: createQueryLogger(ctx) }),
});
const borrowedTransaction = resource({
  label: "borrowedTransaction",
  target: "session",
  depends: { db: borrowedDatabase },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});

function readName(raw: unknown) {
  if (typeof raw !== "string") throw new Error("bad name");
  return raw;
}

const insertUser = operation({
  label: "insertUser",
  input: readName,
  depends: { tx: transaction },
  run: ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
});
const insertBorrowed = operation({
  label: "insertBorrowed",
  input: readName,
  depends: { tx: borrowedTransaction },
  run: ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
});
const failure = new Error("request failed");
const insertThenThrow = operation({
  label: "insertThenThrow",
  depends: { tx: transaction },
  run: async ({ tx }) => {
    await tx.insert(users).values({ name: "grace" });
    throw failure;
  },
});
const parked = operation({
  label: "parkedInsert",
  depends: { tx: borrowedTransaction },
  run: async ({ tx }, ctx) => {
    await tx.insert(users).values({ name: "hopper" });
    await ctx.clock.sleep(10_000, ctx.signal);
  },
});

test("a scope database stays shared across agent namespaces", async () => {
  const agentA = namespace();
  const agentB = namespace();
  const scope = createScope({ tags: [config({ url: "memory://shared" })] });
  const first = await scope.resolve(sharedDatabase);
  expect(await scope.resolve(sharedDatabase, { ns: agentA })).toBe(first);
  expect(await scope.resolve(sharedDatabase, { ns: agentB })).toBe(first);
  await scope.close();
});

test("one database declaration opens lazily in each root and closes only its owned client", async () => {
  const logs: Observe.Log[] = [];
  const first = createScope({
    tags: [config({ url: "memory://first" })],
    observe: { log: (entry) => logs.push(entry) },
  });
  const second = createScope({ tags: [config({ url: "memory://second" })] });
  expect(logs).toEqual([]);
  const firstDb = await first.resolve(sharedDatabase);
  expect(await first.resolve(sharedDatabase)).toBe(firstDb);
  const secondDb = await second.resolve(sharedDatabase);
  expect(secondDb).not.toBe(firstDb);
  await first.close();
  expect(firstDb.$client.closed).toBe(true);
  await secondDb.insert(users).values({ name: "still open" });
  expect(await secondDb.select({ name: users.name }).from(users)).toEqual([{ name: "still open" }]);
  await second.close();
  expect(secondDb.$client.closed).toBe(true);
});

test("each tenant database stays open across request transactions until scope close", async () => {
  const logs: Observe.Log[] = [];
  const a = namespace({ tags: [config({ url: "memory://a" })] });
  const b = namespace({ tags: [config({ url: "memory://b" })] });
  const scope = createScope({ observe: { log: (entry) => logs.push(entry) } });
  await scope.session({ ns: a }, (s) => s.run(insertUser, { input: "ada" }));
  await scope.session({ ns: a }, (s) => s.run(insertUser, { input: "grace" }));
  await scope.session({ ns: b }, (s) => s.run(insertUser, { input: "hopper" }));
  expect(
    logs
      .filter((entry) => entry.message === "database opened")
      .map((entry) => entry.attributes.url),
  ).toEqual(["memory://a", "memory://b"]);
  const first = await scope.resolve(database, { ns: a });
  const second = await scope.resolve(database, { ns: b });
  expect(first).not.toBe(second);
  expect((await first.select().from(users)).map((row) => row.name)).toEqual(["ada", "grace"]);
  expect((await second.select().from(users)).map((row) => row.name)).toEqual(["hopper"]);
  await scope.close({ graceful: true });
  expect(first.$client.closed).toBe(true);
  expect(second.$client.closed).toBe(true);
});

test("a failed tenant request rolls back without losing another request's commit", async () => {
  const tenant = namespace({ tags: [config({ url: "memory://tenant" })] });
  const scope = createScope();
  await scope.session({ ns: tenant }, (s) => s.run(insertUser, { input: "ada" }));
  await expect(scope.session({ ns: tenant }, (s) => s.run(insertThenThrow))).rejects.toBe(failure);
  const db = await scope.resolve(database, { ns: tenant });
  expect((await db.select().from(users)).map((row) => row.name)).toEqual(["ada"]);
  await scope.close();
});

test("a request config tag cannot replace its tenant database config", async () => {
  const logs: Observe.Log[] = [];
  const tenant = namespace({ tags: [config({ url: "memory://tenant" })] });
  const scope = createScope({ observe: { log: (entry) => logs.push(entry) } });
  await scope.session({ ns: tenant, tags: [config({ url: "memory://request" })] }, (s) =>
    s.run(insertUser, { input: "ada" }),
  );
  expect(
    logs
      .filter((entry) => entry.message === "database opened")
      .map((entry) => entry.attributes.url),
  ).toEqual(["memory://tenant"]);
  await scope.close();
});

test("a session insert commits: a root read sees the row after success", async () => {
  const scope = createScope({ tags: [config({ url: "memory://commit" })] });
  await scope.session((s) => s.run(insertUser, { input: "ada" }));
  const db = await scope.resolve(database);
  expect((await db.select().from(users)).map((row) => row.name)).toEqual(["ada"]);
  await scope.close();
});

test("a failed commit rejects the session with TeardownFailed holding the database error", async () => {
  const scope = createScope({ tags: [config({ url: "memory://failed-commit" })] });
  const db = await scope.resolve(database);
  await db.execute(
    sql`alter table users add constraint names_unique unique (name) deferrable initially deferred`,
  );
  let seen: unknown;
  try {
    await scope.session(async (session) => {
      await session.run(insertUser, { input: "ada" });
      await session.run(insertUser, { input: "ada" });
    });
  } catch (error: unknown) {
    seen = error;
  } finally {
    await scope.close();
  }
  if (!isCoreError(seen, "TeardownFailed")) throw seen;
  expect(seen.payload.causes).toMatchObject([{ code: "23505" }]);
});

test("a throwing op rolls back: session rejects with the op error and the row is absent", async () => {
  const scope = createScope({ tags: [config({ url: "memory://rollback" })] });
  await expect(scope.session((s) => s.run(insertThenThrow))).rejects.toBe(failure);
  const db = await scope.resolve(database);
  expect(await db.select().from(users)).toEqual([]);
  await scope.close();
});

test("a forced close rolls back: the parked insert is absent after cancelled", async () => {
  const clock = makeTestClock({ now: 0 });
  let markWaiting!: () => void;
  const waiting = new Promise<void>((resolve) => {
    markWaiting = resolve;
  });
  const client = new PGlite();
  await client.exec("create table users (id serial primary key, name text not null)");
  const scope = createScope({
    tags: [borrowedClient(client)],
    clock: {
      ...clock,
      sleep: (ms, signal) => {
        markWaiting();
        return clock.sleep(ms, signal);
      },
    },
  });
  const running = scope.session((s) => s.run(parked));
  await waiting;
  const closing = scope.close();
  expect((await closing).status).toBe("cancelled");
  await expect(running).rejects.toBeDefined();
  expect(await drizzle({ client }).select().from(users)).toEqual([]);
  await client.close();
});

test("two sequential sessions open two native transactions", async () => {
  const scope = createScope({ tags: [config({ url: "memory://sequential" })] });
  let first: unknown;
  await scope.session(async (session) => {
    first = await session.resolve(transaction);
    await session.run(insertUser, { input: "ada" });
  });
  await scope.session(async (session) => {
    expect(await session.resolve(transaction)).not.toBe(first);
    await session.run(insertUser, { input: "grace" });
  });
  const db = await scope.resolve(database);
  expect((await db.select().from(users)).map((row) => row.name)).toEqual(["ada", "grace"]);
  await scope.close();
});

test("no config binding raises core MissingTag with the config label", async () => {
  const scope = createScope();
  let seen: unknown;
  try {
    await scope.resolve(database);
  } catch (error: unknown) {
    seen = error;
  }
  if (!isCoreError(seen, "MissingTag")) throw seen;
  expect(seen.payload.label).toBe("users.config");
  await scope.close();
});

test("each statement writes one db query log line with sql and never the params", async () => {
  const logs: Observe.Log[] = [];
  const scope = createScope({
    tags: [config({ url: "memory://logging" })],
    observe: { log: (entry) => logs.push(entry) },
  });
  await scope.session((s) => s.run(insertUser, { input: "secret" }));
  const queries = logs.filter((entry) => entry.message === "db query");
  expect(queries.length).toBeGreaterThan(0);
  for (const entry of queries) expect(typeof entry.attributes.sql).toBe("string");
  const dumped = logs.map((entry) => JSON.stringify(entry.attributes));
  expect(dumped.some((line) => line.includes("secret"))).toBe(false);
  await scope.close();
});

test("at the root tx builds once and a graceful scope close commits with success", async () => {
  const client = new PGlite();
  await client.exec("create table users (id serial primary key, name text not null)");
  const scope = createScope({ tags: [borrowedClient(client)] });
  const first = await scope.resolve(borrowedTransaction);
  await scope.run(insertBorrowed, { input: "ada" });
  expect(await scope.resolve(borrowedTransaction)).toBe(first);
  expect((await scope.close({ graceful: true })).status).toBe("success");
  const rows = await drizzle({ client }).select().from(users);
  expect(rows.map((row) => row.name)).toEqual(["ada"]);
  await client.close();
});

test("a failed begin rejects the session without waiting for a transaction handle", async () => {
  const client = new PGlite();
  await client.close();
  const scope = createScope({ tags: [borrowedClient(client)] });
  let beginError: unknown;
  let seen: unknown;
  try {
    await scope.session(async (session) => {
      try {
        await session.run(insertBorrowed, { input: "ada" });
      } catch (error) {
        beginError = error;
        throw error;
      }
    });
  } catch (error) {
    seen = error;
  } finally {
    await scope.close();
  }
  if (!isCoreError(seen, "TeardownFailed")) throw seen;
  expect(seen.payload.causes).toContain(beginError);
});
