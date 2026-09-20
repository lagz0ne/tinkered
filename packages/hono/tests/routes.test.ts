import { expect, test } from "vite-plus/test";
import { createScope, operation, tag, type Observe } from "@tinker/core";
import { hono, route } from "../src/index.ts";

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
function userRows(loads: { get: number; post: number }) {
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

/** Mount the user rows through the extension on a scope carrying the tenant binding. */
async function userApp(loads: { get: number; post: number }) {
  const web = hono({ routes: userRows(loads) });
  const scope = createScope({ tags: [tenant("public")], extensions: [web] });
  await scope.ready;
  return { scope, app: scope.resolve(web) };
}

test("an app built from flat rows answers two verbs", async () => {
  const { scope, app } = await userApp({ get: 0, post: 0 });
  const got = await app.request("/users/42");
  expect(got.status).toBe(200);
  expect(await got.json()).toEqual({ id: 42, tenant: "public" });
  const posted = await app.request("/users", { method: "POST" });
  expect(posted.status).toBe(200);
  expect(await posted.json()).toEqual({ id: 7 });
  await scope.close();
});

test("every loader runs once at start and none runs at request time", async () => {
  const loads = { get: 0, post: 0 };
  const { scope, app } = await userApp(loads);
  expect(loads).toEqual({ get: 1, post: 1 });
  await app.request("/users/1");
  await app.request("/users/2");
  await app.request("/users", { method: "POST" });
  expect(loads).toEqual({ get: 1, post: 1 });
  await scope.close();
});

test("a rejecting loader rejects ready at boot with the loader error", async () => {
  const failure = new Error("bad route");
  const web = hono({ routes: [route.get("/x", () => Promise.reject(failure))] });
  const scope = createScope({ extensions: [web] });
  await expect(scope.ready).rejects.toBe(failure);
  await scope.close();
});

test("a mounted app still takes request tags, a request span, and one log line", async () => {
  const logs: Observe.Log[] = [];
  const web = hono({
    routes: userRows({ get: 0, post: 0 }),
    tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  });
  const scope = createScope({
    tags: [tenant("acme")],
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const app = scope.resolve(web);
  const res = await app.request("/users/42", { headers: { "x-tenant": "beta" } });
  expect(await res.json()).toEqual({ id: 42, tenant: "beta" });
  expect(scope.spans().find((s) => s.name === "GET /users/:id")?.kind).toBe("operation");
  expect(logs.map((entry) => entry.message)).toEqual(["http request"]);
  await scope.close();
});

test("rows are plain data, not scope tags: nothing is mounted without the extension", async () => {
  const rows = [route.get("/x", ping)];
  expect(rows[0]).toEqual({
    method: "GET",
    path: "/x",
    load: rows[0]?.load,
    route: { input: undefined, respond: undefined },
  });
  const scope = createScope({ tags: [tenant("public")] });
  const web = hono({ routes: [] });
  const owned = createScope({ extensions: [web] });
  await owned.ready;
  const res = await owned.resolve(web).request("/x");
  expect(res.status).toBe(404);
  await owned.close();
  await scope.close();
});

test("one row plus one extension answers without the composition root", async () => {
  const web = hono({ routes: [route.get("/ping", ping)] });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/ping");
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("pong");
  await scope.close();
});

test("mount adds a hand-built route inside the same session middleware", async () => {
  const web = hono({
    routes: [],
    mount: (inner) => {
      inner.get("/extra", (c) => c.json("pong"));
    },
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/extra");
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
  const web = hono({
    routes: [
      route.post("/named", createNamed, {
        input: (c) => c.req.json(),
        respond: (named, c) => c.json(named, 201),
      }),
    ],
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
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
  expect(bad.status).toBe(400);
  expect(await bad.text()).toBe("bad request");
  await scope.close();
});
