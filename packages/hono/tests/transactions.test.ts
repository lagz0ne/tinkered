import { expect, test } from "vite-plus/test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { createScope, LEVELS, operation, type Observe } from "@tinker/core";
import { drizzleStore } from "@tinker/drizzle";
import { emit, errorResponses, hono, isError, route, stream } from "../src/index.ts";

const issues = pgTable("issues", { title: text("title").notNull() });
const store = drizzleStore({
  label: "issues",
  open: async (_config: null, { logger }) => {
    const db = drizzle({ client: new PGlite(), logger });
    await db.execute(sql`create table issues (
      title text not null unique deferrable initially deferred
    )`);
    return db;
  },
  close: (db) => db.$client.close(),
});
const duplicate = operation({
  label: "duplicate",
  depends: { tx: store.tx },
  run: async ({ tx }) => {
    await tx.insert(issues).values([{ title: "A" }, { title: "A" }]);
    return "ok";
  },
});
const save = operation({
  label: "save",
  depends: { tx: store.tx },
  run: async ({ tx }) => {
    await tx.insert(issues).values({ title: "A" });
    return "ok";
  },
});
const saveThenRaise = operation({
  label: "saveThenRaise",
  depends: { save },
  run: async ({ save }, { raise }) => {
    await save.run();
    raise("IssueConflict", { title: "A" });
  },
});

test(
  "a failed commit answers 500, logs one line, and saves nothing",
  { timeout: 30_000 },
  async () => {
    const logs: Observe.Log[] = [];
    const { extension: web } = hono([
      route.post("/issues", duplicate, { respond: (value, c) => c.text(value, 201) }),
    ]);
    const scope = createScope({
      tags: [store.config(null)],
      extensions: [web],
      observe: { log: (entry) => logs.push(entry) },
    });
    try {
      await scope.ready;
      const response = await scope.resolve(web).request("/issues", { method: "POST" });
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("internal");
      const db = await scope.resolve(store.db);
      expect(await db.select().from(issues)).toEqual([]);
      expect(logs.filter((entry) => entry.message === "request failed")).toMatchObject([
        { level: LEVELS.error, attributes: { method: "POST", path: "/issues" } },
      ]);
    } finally {
      await scope.close();
    }
  },
);

test(
  "a save followed by a mapped 409 rolls back and keeps the mapped answer",
  { timeout: 30_000 },
  async () => {
    const { extension: web } = hono([route.post("/issues", saveThenRaise)], {
      onError: errorResponses<{ IssueConflict: { title: string } }>({
        IssueConflict: { status: 409, body: ({ title }) => ({ message: "reload", title }) },
      }),
    });
    const scope = createScope({ tags: [store.config(null)], extensions: [web] });
    try {
      await scope.ready;
      const response = await scope.resolve(web).request("/issues", { method: "POST" });
      expect(response.status).toBe(409);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.text()).toBe('{"message":"reload","title":"A"}');
      const db = await scope.resolve(store.db);
      expect(await db.select().from(issues)).toEqual([]);
    } finally {
      await scope.close();
    }
  },
);

test(
  "a save followed by an unmapped error answers 500 and rolls back",
  { timeout: 30_000 },
  async () => {
    const logs: Observe.Log[] = [];
    const { extension: web } = hono([route.post("/issues", saveThenRaise)]);
    const scope = createScope({
      tags: [store.config(null)],
      extensions: [web],
      observe: { log: (entry) => logs.push(entry) },
    });
    try {
      await scope.ready;
      const response = await scope.resolve(web).request("/issues", { method: "POST" });
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("internal");
      const db = await scope.resolve(store.db);
      expect(await db.select().from(issues)).toEqual([]);
      expect(logs.filter((entry) => entry.message === "request failed")).toMatchObject([
        { attributes: { kind: "IssueConflict" } },
      ]);
    } finally {
      await scope.close();
    }
  },
);

test("a successful save commits before its answer arrives", { timeout: 30_000 }, async () => {
  const { extension: web } = hono([
    route.post("/issues", save, {
      respond: (value, c) => {
        c.header("x-saved", "yes");
        return c.text(value, 201);
      },
    }),
  ]);
  const scope = createScope({ tags: [store.config(null)], extensions: [web] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/issues", { method: "POST" });
    const db = await scope.resolve(store.db);
    expect(await db.select().from(issues)).toEqual([{ title: "A" }]);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-saved")).toBe("yes");
    expect(await response.text()).toBe("ok");
  } finally {
    await scope.close();
  }
});

test(
  "a stream whose commit fails errors its body and logs one line",
  { timeout: 30_000 },
  async () => {
    const logs: Observe.Log[] = [];
    const finish = Promise.withResolvers<void>();
    const body = operation({
      label: "body",
      depends: { emit: emit.required, duplicate },
      run: async ({ emit, duplicate }) => {
        emit(await duplicate.run());
        await finish.promise;
      },
    });
    const ready = operation({ label: "ready", run: () => undefined });
    const { extension: web } = hono([
      route.get("/stream", ready, { respond: (_value, c) => stream(c, body) }),
    ]);
    const scope = createScope({
      tags: [store.config(null)],
      extensions: [web],
      observe: { log: (entry) => logs.push(entry) },
    });
    try {
      await scope.ready;
      const response = await scope.resolve(web).request("/stream");
      expect(response.status).toBe(200);
      if (!response.body) throw new Error("no stream body");
      const reader = response.body.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("ok");
      finish.resolve();
      const error = await reader.read().then(
        () => undefined,
        (cause: unknown) => cause,
      );
      if (!isError(error, "RequestCloseFailed")) throw error;
      expect(error.payload.result.teardownErrors).toMatchObject([{ code: "23505" }]);
      const db = await scope.resolve(store.db);
      expect(await db.select().from(issues)).toEqual([]);
      expect(logs.filter((entry) => entry.message === "request failed")).toMatchObject([
        { level: LEVELS.error, attributes: { method: "GET", path: "/stream" } },
      ]);
    } finally {
      finish.resolve();
      await scope.close();
    }
  },
);
