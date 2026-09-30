import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  onTestFinished,
} from "vite-plus/test";
import { PGlite } from "@electric-sql/pglite";
import {
  createScope,
  data,
  extension,
  operation,
  resource,
  tag,
  type Scope,
  type Observe,
  type Operation,
} from "@tinker/core";
import { openTransaction } from "@tinker/drizzle";
import { errorResponses, hono, route } from "@tinker/hono";
import { nats, subscribe as onNats, type Nats } from "@tinker/nats";
import { startNatsServer, type NatsServer } from "@tinker/nats/testing";
import { memoryPair, source, subscribe } from "@tinker/sync";
import { isError, liveUpdates } from "../src/index.ts";

let server: NatsServer.Handle;
let client: PGlite;
const scopes: Scope.Handle[] = [];
const lists = data<string[]>({ label: "list", initial: [] });
const databaseConfig = tag<PGlite>({ label: "shared.config" });
/** Each root borrows the same client; test cleanup owns its close. */
const db = resource({
  label: "shared.db",
  target: "scope",
  depends: { config: databaseConfig },
  factory: ({ config }) => config,
});
const tx = resource({
  label: "shared.tx",
  target: "session",
  depends: { db },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
const publish = operation({
  label: "publish",
  depends: { db, list: lists.controller },
  run: async ({ db, list }) => {
    const { rows } = await db.query<{ title: string }>("select title from issues order by title");
    const next = rows.map((row) => row.title);
    if (JSON.stringify(list.get()) !== JSON.stringify(next)) list.set(next);
  },
});
const save = operation({
  label: "save",
  depends: { tx },
  input: String,
  run: async ({ tx }, ctx) => {
    await tx.query("insert into issues (title) values ($1)", [ctx.input]);
    if (ctx.input === "fail") await tx.exec("select * from missing_table");
    return ctx.input;
  },
});
const read = operation({ label: "read", depends: { list: lists }, run: ({ list }) => list });
const saveTaken = operation({
  label: "saveTaken",
  depends: { tx },
  run: async ({ tx }, ctx) => {
    await tx.query("insert into issues (title) values ($1)", ["Taken"]);
    ctx.raise("Taken", { title: "Taken" });
  },
});

beforeAll(async () => {
  server = await startNatsServer();
  client = new PGlite();
  await client.exec(
    "create table issues (title text not null unique deferrable initially deferred)",
  );
}, 30000);
beforeEach(async () => {
  await client.exec("delete from issues");
});
afterEach(async () => {
  for (const scope of scopes.reverse()) await scope.close();
  scopes.length = 0;
});
afterAll(async () => {
  await client.close();
  await server.close();
});

async function boot(subject = "issues.changed", observe?: Observe.Config) {
  const web = hono([
    route.get("/issues", read),
    route.post("/issues/:title", save, { input: (c) => c.req.param("title") }),
  ]).extension;
  const src = source({ cells: [[lists, "issues"]] });
  const scope = createScope({
    observe,
    tags: [databaseConfig(client)],
    extensions: [web, src, liveUpdates(publish, { subject, env: { NATS_URL: server.url } })],
  });
  scopes.push(scope);
  await scope.ready;
  return { scope, app: scope.resolve(web), src };
}

async function viewer(host: Awaited<ReturnType<typeof boot>>) {
  const [near, far] = memoryPair();
  const served = host.scope.resolve(host.src).connect(near);
  const pipe = resource({ label: "pipe", factory: () => far });
  const sub = subscribe(pipe, { cells: [[lists, "issues"]] });
  const scope = createScope({ extensions: [sub] });
  scopes.push(scope);
  await scope.ready;
  onTestFinished(async () => {
    await scope.close();
    await served;
  });
  return { scope };
}

async function signals() {
  const messages: Nats.Message[] = [];
  const receive = operation({
    label: "signal",
    run: (_deps, ctx: Operation.Ctx<Nats.Message>) => {
      messages.push(ctx.input);
    },
  });
  const bus = nats([onNats("issues.changed", receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({ extensions: [bus.extension] });
  scopes.push(scope);
  await scope.ready;
  return { scope, messages };
}

test("a committed save reaches the other server's sync subscriber in both directions", async () => {
  const a = await boot();
  const b = await boot();
  const tabA = await viewer(a);
  const tabB = await viewer(b);
  await a.app.request("/issues/A", { method: "POST" });
  await expect.poll(() => tabB.scope.resolve(lists)).toEqual(["A"]);
  await b.app.request("/issues/B", { method: "POST" });
  await expect.poll(() => tabA.scope.resolve(lists)).toEqual(["A", "B"]);
});

test("one empty signal per commit re-reads on the sender without another snapshot or signal", async () => {
  const observer = await signals();
  const spans: Observe.Span[] = [];
  const a = await boot("issues.changed", { export: (span) => spans.push(span) });
  const tab = await viewer(a);
  const seen: string[][] = [];
  tab.scope.controller(lists).watch((value) => seen.push(value));
  await a.app.request("/issues/A", { method: "POST" });
  await expect.poll(() => spans.filter((span) => span.name === "stack.refresh").length).toBe(1);
  await a.scope.close();
  await observer.scope.close({ graceful: true });
  expect(observer.messages).toEqual([{ subject: "issues.changed", payload: new Uint8Array() }]);
  expect(seen).toEqual([["A"]]);
});

test("GET and a rolled-back save send no signal", async () => {
  const observer = await signals();
  const a = await boot();
  expect((await a.app.request("/issues")).status).toBe(200);
  expect((await a.app.request("/issues/fail", { method: "POST" })).status).toBe(500);
  await a.scope.close({ graceful: true });
  await observer.scope.close({ graceful: true });
  expect(observer.messages).toEqual([]);
  expect((await client.query("select title from issues")).rows).toEqual([]);
});

test("closing one server removes its NATS subscription while the other keeps publishing", async () => {
  const a = await boot();
  const b = await boot();
  const tab = await viewer(a);
  await b.scope.close({ graceful: true });
  const connections = await (await fetch(`${server.monitorUrl}/connz?subs=1`)).json();
  expect(connections).toMatchObject({
    num_connections: 1,
    connections: [{ subscriptions_list: ["issues.changed"] }],
  });
  await a.app.request("/issues/A", { method: "POST" });
  await expect.poll(() => tab.scope.resolve(lists)).toEqual(["A"]);
});

test("a different app subject leaves its published cells alone", async () => {
  const a = await boot();
  const other = await boot("other.changed");
  const control = await boot();
  let published = other.scope.resolve(lists);
  other.scope.controller(lists).watch((value) => {
    published = value;
  });
  await a.app.request("/issues/A", { method: "POST" });
  await expect.poll(() => control.scope.resolve(lists)).toEqual(["A"]);
  await a.scope.close({ graceful: true });
  await other.scope.close({ graceful: true });
  expect(published).toEqual([]);
});

test("a raised error mapped to 4xx rolls back and sends no signal", async () => {
  const observer = await signals();
  const web = hono([route.post("/issues", saveTaken)], {
    onError: errorResponses({ Taken: 409 }),
  }).extension;
  const scope = createScope({
    tags: [databaseConfig(client)],
    extensions: [
      web,
      liveUpdates(publish, { subject: "issues.changed", env: { NATS_URL: server.url } }),
    ],
  });
  scopes.push(scope);
  await scope.ready;
  const response = await scope.resolve(web).request("/issues", { method: "POST" });
  expect(response.status).toBe(409);
  await scope.close({ graceful: true });
  await observer.scope.close({ graceful: true });
  expect((await client.query("select title from issues")).rows).toEqual([]);
  expect(observer.messages).toEqual([]);
});

test.each(["", "issues.*", "issues.>", "issues..changed", ".issues", "issues.", "issues changed"])(
  "an invalid live subject fails boot (%s)",
  async (subject) => {
    const scope = createScope({ extensions: [liveUpdates(publish, { subject, env: {} })] });
    scopes.push(scope);
    try {
      await scope.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "BadLiveSubject")) throw error;
      expect(error.payload).toEqual({ subject });
    }
  },
);

test("live updates require NATS_URL at boot", async () => {
  const scope = createScope({
    extensions: [liveUpdates(publish, { subject: "issues.changed", env: {} })],
  });
  scopes.push(scope);
  await expect(scope.ready).rejects.toMatchObject({
    kind: "InvalidConfig",
    payload: { key: "NATS_URL" },
  });
});

test("a failed database commit sends no signal", async () => {
  const observer = await signals();
  const a = await boot();
  await a.app.request("/issues/A", { method: "POST" });
  await expect.poll(() => observer.messages.length).toBe(1);
  await a.app.request("/issues/A", { method: "POST" });
  await a.scope.close({ graceful: true });
  await observer.scope.close({ graceful: true });
  expect(observer.messages).toEqual([{ subject: "issues.changed", payload: new Uint8Array() }]);
  expect((await client.query("select title from issues")).rows).toEqual([{ title: "A" }]);
});

test("a failed second live root leaves the first root receiving signals", async () => {
  const saved = tag<{ value: string }>({ label: "saved" });
  const current = data({ label: "current", initial: "" });
  const publish = operation({
    label: "publish",
    depends: { saved, current: current.controller },
    run: ({ saved, current }) => current.set(saved.value),
  });
  const [publisher, bus] = liveUpdates(publish, {
    subject: "reuse.changed",
    env: { NATS_URL: server.url },
  });
  const failure = new Error("later start failed");
  const later = extension({
    label: "later",
    hooks: {
      start: () => {
        throw failure;
      },
    },
  });
  const first = { value: "first" };
  const a = createScope({ tags: [saved(first)], extensions: [publisher, bus] });
  scopes.push(a);
  await a.ready;
  const b = createScope({
    tags: [saved({ value: "second" })],
    extensions: [publisher, later, bus],
  });
  scopes.push(b);
  await expect(b.ready).rejects.toBe(failure);
  const sender = nats([], { env: { NATS_URL: server.url } });
  const source = createScope({ extensions: [sender.extension] });
  scopes.push(source);
  await source.ready;
  first.value = "refreshed";
  await source.run(sender.publish, {
    input: { subject: "reuse.changed", payload: new Uint8Array() },
  });
  await expect.poll(() => a.resolve(current)).toBe("refreshed");
});

test("live updates borrow one connection across roots", async () => {
  const { connect } = await import("@nats-io/transport-node");
  const connection = await connect({ servers: server.url });
  try {
    for (let root = 0; root < 3; root++) {
      const scope = createScope({
        tags: [store.config(db)],
        extensions: [
          liveUpdates(publish, {
            subject: "issues.changed",
            env: { NATS_URL: server.url },
            connection,
          }),
        ],
      });
      try {
        await scope.ready;
        expect(await (await fetch(`${server.monitorUrl}/connz`)).json()).toMatchObject({
          num_connections: 1,
          connections: [{ subscriptions: 1 }],
        });
      } finally {
        await scope.close({ graceful: true });
      }
      expect(connection.isClosed()).toBe(false);
      expect(await (await fetch(`${server.monitorUrl}/connz`)).json()).toMatchObject({
        num_connections: 1,
        connections: [{ subscriptions: 0 }],
      });
    }
  } finally {
    await connection.close();
  }
});
