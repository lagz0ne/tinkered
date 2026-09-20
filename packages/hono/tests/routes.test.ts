import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import { createScope, operation, tag, type Observe } from "@tinker/core";
import { handle, honoApp, route, tinker } from "../src/index.ts";

/** A tenant tag: bound at the scope, rebound per request from a header. */
const tenant = tag<string>({ label: "tenant" });

/** Parse a route id into a number (the `{ rawInput }` path runs it). */
function parseId(raw: unknown): number {
  const id = Number(raw);
  if (Number.isNaN(id)) throw new Error("bad id");
  return id;
}

const getUser = operation({
  label: "getUser",
  input: parseId,
  depends: { tenant },
  run: ({ tenant }, ctx) => ({ id: ctx.input, tenant }),
});

const createUser = operation({ label: "createUser", run: () => ({ id: 7 }) });

const ping = operation({ label: "ping", run: () => "pong" });

/** Two counting loaders: each call records one load of its verb. */
function userTable(loads: { get: number; post: number }) {
  return [
    route.get(
      "/users/:id",
      () => {
        loads.get += 1;
        return getUser;
      },
      { input: (c) => c.req.param("id") },
    ),
    route.post("/users", () => {
      loads.post += 1;
      return createUser;
    }),
  ];
}

/** Mount the user table on a scope carrying the tenant binding. */
function userScope(loads: { get: number; post: number }) {
  return createScope({ tags: [tenant("public"), ...userTable(loads)] });
}

test("an app built only from scope bindings answers two verbs", async () => {
  const scope = userScope({ get: 0, post: 0 });
  const app = await honoApp(scope);
  const got = await app.request("/users/42");
  expect(got.status).toBe(200);
  expect(await got.json()).toEqual({ id: 42, tenant: "public" });
  const posted = await app.request("/users", { method: "POST" });
  expect(posted.status).toBe(200);
  expect(await posted.json()).toEqual({ id: 7 });
  await scope.close();
});

test("every loader runs once at mount and none runs at request time", async () => {
  const loads = { get: 0, post: 0 };
  const scope = userScope(loads);
  const app = await honoApp(scope);
  expect(loads).toEqual({ get: 1, post: 1 });
  await app.request("/users/1");
  await app.request("/users/2");
  await app.request("/users", { method: "POST" });
  expect(loads).toEqual({ get: 1, post: 1 });
  await scope.close();
});

test("a rejecting loader rejects honoApp at boot with the loader error", async () => {
  const failure = new Error("bad route");
  const scope = createScope({ tags: [route.get("/x", () => Promise.reject(failure))] });
  await expect(honoApp(scope)).rejects.toBe(failure);
  await scope.close();
});

test("a mounted app still takes request tags, a request span, and one log line", async () => {
  const logs: Observe.Log[] = [];
  const scope = createScope({
    tags: [tenant("acme"), ...userTable({ get: 0, post: 0 })],
    observe: { history: 20, log: (entry) => logs.push(entry) },
  });
  const app = await honoApp(scope, {
    tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  });
  const res = await app.request("/users/42", { headers: { "x-tenant": "beta" } });
  expect(await res.json()).toEqual({ id: 42, tenant: "beta" });
  expect(scope.spans().find((s) => s.name === "GET /users/:id")?.kind).toBe("operation");
  expect(logs.map((entry) => entry.message)).toEqual(["http request"]);
  await scope.close();
});

test("a route bound on a session is not mounted from the parent scope", async () => {
  const scope = createScope({ tags: [tenant("public")] });
  const child = scope.createSession({ tags: [route.get("/x", () => ping)] });
  const app = await honoApp(scope);
  const res = await app.request("/x");
  expect(res.status).toBe(404);
  await child.close();
  await scope.close();
});

test("hand mounting with tinker plus handle still answers", async () => {
  const scope = createScope();
  const app = new Hono().use(tinker(scope)).get("/x", handle(ping));
  const res = await app.request("/x");
  expect(res.status).toBe(200);
  await scope.close();
});

test("mount adds a hand-built route inside the same session middleware", async () => {
  const scope = createScope();
  const app = await honoApp(scope, {
    mount: (inner) => {
      inner.get("/extra", handle(ping));
    },
  });
  const res = await app.request("/extra");
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("pong");
  await scope.close();
});

/** Parse a named body at the door: an object with a string name. */
function parseNamed(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) throw new Error("bad body");
  if (!("name" in raw) || typeof raw.name !== "string") throw new Error("bad body");
  return raw.name;
}

const createNamed = operation({
  label: "createNamed",
  input: parseNamed,
  run: (_deps, ctx) => ({ name: ctx.input }),
});

test("an async input read answers the parsed body; a malformed body takes the error map", async () => {
  const scope = createScope({
    tags: [
      route.post("/named", () => createNamed, {
        input: (c) => c.req.json(),
        respond: (named, c) => c.json(named, 201),
      }),
    ],
  });
  const app = await honoApp(scope);
  const good = await app.request("/named", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ada" }),
  });
  expect(good.status).toBe(201);
  expect(await good.json()).toEqual({ name: "ada" });
  const bad = await app.request("/named", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{broken",
  });
  expect(bad.status).toBe(500);
  await scope.close();
});
