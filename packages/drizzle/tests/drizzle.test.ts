import { expect, test } from "vite-plus/test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  createScope,
  isError as isCoreError,
  makeTestClock,
  namespace,
  operation,
  type Observe,
} from "@tinker/core";
import { drizzleStore, type DrizzleStore } from "../src/index.ts";

/** The one test table: an id plus a name. */
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

/** A PGlite-backed Drizzle database: the concrete `DB` the frame tests bind. */
type PgDatabase = ReturnType<typeof drizzle>;

/** The store under test: PGlite in memory, table created in `open`, client closed in `close`. */
function usersStore(
  label: string,
  hooks?: { opened?: () => void },
): DrizzleStore.Frame<null, PgDatabase> {
  return drizzleStore({
    label,
    open: async (_config, { logger }) => {
      hooks?.opened?.();
      const db = drizzle(new PGlite(), { logger });
      await db.execute(
        sql`create table if not exists users (id serial primary key, name text not null)`,
      );
      return db;
    },
    close: (db) => db.$client.close(),
  });
}

/** An op that inserts one name through the session transaction. */
function insertOp<Config>(store: DrizzleStore.Frame<Config, PgDatabase>) {
  return operation({
    label: "insertUser",
    input: (raw: unknown) => {
      if (typeof raw !== "string") throw new Error("bad name");
      return raw;
    },
    depends: { tx: store.tx },
    run: async ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
  });
}

test("db opens once per scope and close runs on scope close", async () => {
  let opens = 0;
  const store = usersStore("users", { opened: () => opens++ });
  const scope = createScope({ tags: [store.config(null)] });
  const read = operation({
    label: "read",
    depends: { db: store.db },
    run: ({ db }) => db.select().from(users),
  });
  await scope.run(read);
  await scope.run(read);
  expect(opens).toBe(1);
  const client = (await scope.controller(store.db).resolve()).$client;
  await scope.close();
  expect(client.closed).toBe(true);
});

test("one store keeps each tenant database open across request transactions until scope close", async () => {
  const opened: string[] = [];
  const closed: string[] = [];
  const transactions = { count: 0 };
  const store = drizzleStore<string, PgDatabase>({
    open: async (name, { logger }) => {
      opened.push(name);
      const db = drizzle(new PGlite(), { logger });
      await db.execute(sql`create table users (id serial primary key, name text not null)`);
      return countingDb(db, transactions);
    },
    close: async (db) => {
      const rows = await db.select().from(users);
      closed.push(rows.map((row) => row.name).join(","));
      await db.$client.close();
    },
  });
  expect(store.label).toBe("drizzle");
  const a = namespace({ tags: [store.config("a")] });
  const b = namespace({ tags: [store.config("b")] });
  const scope = createScope();
  await scope.session({ ns: a }, (s) => s.run(insertOp(store), { input: "ada" }));
  await scope.session({ ns: a }, (s) => s.run(insertOp(store), { input: "grace" }));
  await scope.session({ ns: b }, (s) => s.run(insertOp(store), { input: "hopper" }));
  expect(opened).toEqual(["a", "b"]);
  expect(transactions.count).toBe(3);
  const first = await scope.controller(store.db, { ns: a }).resolve();
  const second = await scope.controller(store.db, { ns: b }).resolve();
  expect(first).not.toBe(second);
  expect((await first.select().from(users)).map((row) => row.name)).toEqual(["ada", "grace"]);
  expect((await second.select().from(users)).map((row) => row.name)).toEqual(["hopper"]);
  expect(closed).toEqual([]);
  await scope.close({ graceful: true });
  expect(closed.sort()).toEqual(["ada,grace", "hopper"]);
  expect(first.$client.closed).toBe(true);
  expect(second.$client.closed).toBe(true);
});

test("a failed tenant request rolls back without losing another request's commit", async () => {
  const store = usersStore("users");
  const tenant = namespace({ tags: [store.config(null)] });
  const scope = createScope();
  await scope.session({ ns: tenant }, (s) => s.run(insertOp(store), { input: "ada" }));
  const insertThenThrow = operation({
    label: "failedInsert",
    depends: { tx: store.tx },
    run: async ({ tx }) => {
      await tx.insert(users).values({ name: "grace" });
      throw new Error("request failed");
    },
  });
  await expect(scope.session({ ns: tenant }, (s) => s.run(insertThenThrow))).rejects.toThrow(
    "request failed",
  );
  const db = await scope.controller(store.db, { ns: tenant }).resolve();
  expect((await db.select().from(users)).map((row) => row.name)).toEqual(["ada"]);
  await scope.close();
});

test("a request config tag cannot replace its tenant database config", async () => {
  const opened: string[] = [];
  const store = drizzleStore<string, PgDatabase>({
    open: async (name, { logger }) => {
      opened.push(name);
      const db = drizzle(new PGlite(), { logger });
      await db.execute(sql`create table users (id serial primary key, name text not null)`);
      return db;
    },
    close: (db) => db.$client.close(),
  });
  const tenant = namespace({ tags: [store.config("tenant")] });
  const scope = createScope();
  await scope.session({ ns: tenant, tags: [store.config("request")] }, (s) =>
    s.run(insertOp(store), { input: "ada" }),
  );
  expect(opened).toEqual(["tenant"]);
  await scope.close();
});

test("a session insert commits: a root read sees the row after success", async () => {
  const store = usersStore("users");
  const scope = createScope({ tags: [store.config(null)] });
  await scope.session((s) => s.run(insertOp(store), { input: "ada" }));
  const rows = await scope
    .controller(store.db)
    .resolve()
    .then((db) => db.select().from(users));
  expect(rows.map((row) => row.name)).toEqual(["ada"]);
  await scope.close();
});

test("a throwing op rolls back: session rejects with the op error and the row is absent", async () => {
  const store = usersStore("users");
  const scope = createScope({ tags: [store.config(null)] });
  const insertThenThrow = operation({
    label: "insertThenThrow",
    depends: { tx: store.tx },
    run: async ({ tx }) => {
      await tx.insert(users).values({ name: "grace" });
      throw new Error("kaboom");
    },
  });
  let seen: unknown;
  try {
    await scope.session((s) => s.run(insertThenThrow));
  } catch (error: unknown) {
    seen = error;
  }
  if (!(seen instanceof Error)) throw seen;
  expect(seen.message).toBe("kaboom");
  const rows = await scope
    .controller(store.db)
    .resolve()
    .then((db) => db.select().from(users));
  expect(rows).toEqual([]);
  await scope.close();
});

test("a forced close rolls back: the parked insert is absent after cancelled", async () => {
  const clock = makeTestClock({ now: 0 });
  const client = new PGlite();
  const store = drizzleStore<null, PgDatabase>({
    label: "users",
    open: async (_config, { logger }) => {
      const db = drizzle(client, { logger });
      await db.execute(
        sql`create table if not exists users (id serial primary key, name text not null)`,
      );
      return db;
    },
  });
  const scope = createScope({ tags: [store.config(null)], clock });
  const parked = operation({
    label: "parkedInsert",
    depends: { tx: store.tx },
    run: async ({ tx }, ctx) => {
      await tx.insert(users).values({ name: "hopper" });
      await ctx.clock.sleep(10_000, ctx.signal);
    },
  });
  const running = scope.session((s) => s.run(parked));
  const closing = scope.close();
  expect((await closing).status).toBe("cancelled");
  await expect(running).rejects.toBeDefined();
  const rows = await drizzle(client).select().from(users);
  expect(rows).toEqual([]);
});

/** A database that counts `transaction` calls and forwards everything else to the real one —
 * the count lives in the test, no global patch. */
function countingDb(db: PgDatabase, counter: { count: number }): PgDatabase {
  const transaction = db.transaction.bind(db);
  const counted = <T>(cb: (tx: DrizzleStore.Tx<PgDatabase>) => Promise<T>): Promise<T> => {
    counter.count++;
    return transaction(cb);
  };
  return new Proxy(db, {
    get: (target, key) => (key === "transaction" ? counted : target[key as keyof PgDatabase]),
  });
}

/** A store that counts `transaction` calls: `open` builds the real PGlite database and counts
 * only `transaction`, so the count lives in the test. */
function countingStore(
  label: string,
  counter: { count: number },
): DrizzleStore.Frame<null, PgDatabase> {
  return drizzleStore<null, PgDatabase>({
    label,
    open: async (_config, { logger }) => {
      const inner = drizzle(new PGlite(), { logger });
      await inner.execute(
        sql`create table if not exists users (id serial primary key, name text not null)`,
      );
      return countingDb(inner, counter);
    },
    close: (db) => db.$client.close(),
  });
}

test("two sequential sessions open two transactions", async () => {
  const counter = { count: 0 };
  const store = countingStore("users", counter);
  const scope = createScope({ tags: [store.config(null)] });
  await scope.session((s) => s.run(insertOp(store), { input: "ada" }));
  await scope.session((s) => s.run(insertOp(store), { input: "grace" }));
  expect(counter.count).toBe(2);
  await scope.close();
});

test("no config binding raises core MissingTag with the config label", async () => {
  const store = usersStore("users");
  const scope = createScope();
  let seen: unknown;
  try {
    await scope.controller(store.db).resolve();
  } catch (error: unknown) {
    seen = error;
  }
  if (!isCoreError(seen, "MissingTag")) throw seen;
  expect(seen.payload.label).toBe("users.config");
  await scope.close();
});

test("each statement writes one db query log line with sql and never the params", async () => {
  const logs: Observe.Log[] = [];
  const store = usersStore("users");
  const scope = createScope({
    tags: [store.config(null)],
    observe: { log: (entry) => logs.push(entry) },
  });
  await scope.session((s) => s.run(insertOp(store), { input: "secret" }));
  const queries = logs.filter((entry) => entry.message === "db query");
  expect(queries.length).toBeGreaterThan(0);
  for (const entry of queries) {
    expect(typeof entry.attributes.sql).toBe("string");
  }
  const dumped = logs.map((entry) => JSON.stringify(entry.attributes));
  expect(dumped.some((line) => line.includes("secret"))).toBe(false);
  await scope.close();
});

test("at the root tx builds once and a graceful scope close commits with success", async () => {
  const client = new PGlite();
  const counter = { count: 0 };
  await drizzle(client).execute(
    sql`create table users (id serial primary key, name text not null)`,
  );
  const store = drizzleStore<null, PgDatabase>({
    label: "users",
    open: (_config, { logger }) => countingDb(drizzle(client, { logger }), counter),
  });
  const scope = createScope({ tags: [store.config(null)] });
  await scope.run(insertOp(store), { input: "ada" });
  expect(counter.count).toBe(1);
  expect((await scope.close({ graceful: true })).status).toBe("success");
  expect(counter.count).toBe(1);
  const rows = await drizzle(client).select().from(users);
  expect(rows.map((row) => row.name)).toEqual(["ada"]);
});
