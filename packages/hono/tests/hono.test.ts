import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import {
  createScope,
  makeTestClock,
  operation,
  resource,
  tag,
  type Observe,
  type Scope,
} from "@tinker/core";
import { handle, isError, request, tinker } from "../src/index.ts";

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
  depends: { tenant, req: request },
  run: ({ tenant, req }, ctx) => ({ id: ctx.input, tenant, path: new URL(req.url).pathname }),
});

/** Mount the user route behind the session middleware. */
function userApp(scope: Scope.Handle): Hono {
  const routes = new Hono().get("/users/:id", handle(getUser, { input: (c) => c.req.param("id") }));
  return new Hono()
    .use(tinker(scope, { tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")] }))
    .route("/", routes);
}

test("a request-derived tag shadows the scope binding and the op sees the request url", async () => {
  const scope = createScope({ tags: [tenant("acme")] });
  const app = userApp(scope);
  const res = await app.request("/users/42", { headers: { "x-tenant": "beta" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 42, tenant: "beta", path: "/users/42" });
  const fallback = await app.request("/users/42");
  expect(await fallback.json()).toEqual({ id: 42, tenant: "public", path: "/users/42" });
  await scope.close();
});

test("a void op answers its value as json by default, or as text with respond", async () => {
  const health = operation({ label: "health", run: () => "ok" });
  const scope = createScope();
  const app = new Hono()
    .use(tinker(scope))
    .get("/json", handle(health))
    .get("/text", handle(health, { respond: (v, c) => c.text(String(v)) }));
  const asJson = await app.request("/json");
  expect(asJson.status).toBe(200);
  expect(await asJson.json()).toBe("ok");
  const asText = await app.request("/text");
  expect(asText.status).toBe(200);
  expect(asText.headers.get("content-type")).toContain("text/plain");
  expect(await asText.text()).toBe("ok");
  await scope.close();
});

test("a session-target resource depending on request builds once per request", async () => {
  const builds: string[] = [];
  const perRequest = resource({
    label: "perRequest",
    target: "session",
    depends: { req: request },
    factory: ({ req }) => {
      builds.push(req.url);
      return { url: req.url };
    },
  });
  const who = operation({
    label: "who",
    depends: { seen: perRequest },
    run: ({ seen }) => seen.url,
  });
  const scope = createScope();
  const app = new Hono().use(tinker(scope)).get("/a", handle(who)).get("/b", handle(who));
  await app.request("/a");
  await app.request("/b");
  expect(builds.length).toBe(2);
  expect(builds[0]).toContain("/a");
  expect(builds[1]).toContain("/b");
  await scope.close();
});

test("a client abort force-closes the session: the op settles cancelled", async () => {
  const ends: string[] = [];
  const slow = operation({
    label: "slow",
    run: (_deps, { clock, signal, defer }) => {
      defer((end) => {
        ends.push(end.status);
      });
      return clock.sleep(10_000, signal);
    },
  });
  const scope = createScope({ clock: makeTestClock({ now: 0 }) });
  const app = new Hono().use(tinker(scope)).get("/slow", handle(slow));
  const ac = new AbortController();
  const pending = app.request("/slow", { signal: ac.signal });
  ac.abort();
  const settled = await Promise.allSettled([pending]);
  expect(ends).toEqual(["cancelled"]);
  expect(settled[0].status).toBe("rejected");
  await scope.close();
});

test("without the middleware the route raises NoSession carrying the op label", async () => {
  const ping = operation({ label: "ping", run: () => "pong" });
  let seen: unknown;
  const app = new Hono().get("/ping", handle(ping));
  app.onError((e, c) => {
    seen = e;
    return c.text("err", 500);
  });
  const res = await app.request("/ping");
  expect(res.status).toBe(500);
  if (!isError(seen, "NoSession")) throw seen;
  expect(seen.payload.label).toBe("ping");
});

test("a graceful scope close waits for the in-flight request, then succeeds", async () => {
  const clk = makeTestClock({ now: 0 });
  const slow = operation({
    label: "slow",
    run: (_deps, { clock, signal }) => clock.sleep(10_000, signal),
  });
  const scope = createScope({ clock: clk });
  const app = new Hono().use(tinker(scope)).get("/slow", handle(slow));
  const pending = app.request("/slow");
  const closing = scope.close({ graceful: true });
  clk.advance(10_000);
  const res = await pending;
  expect(res.status).toBe(200);
  expect((await closing).status).toBe("success");
});

test("a forced scope close cancels the in-flight request and its defer sees cancelled", async () => {
  const clk = makeTestClock({ now: 0 });
  const ends: string[] = [];
  const slow = operation({
    label: "slow",
    run: (_deps, { clock, signal, defer }) => {
      defer((end) => {
        ends.push(end.status);
      });
      return clock.sleep(10_000, signal);
    },
  });
  const scope = createScope({ clock: clk });
  const app = new Hono().use(tinker(scope)).get("/slow", handle(slow));
  const pending = app.request("/slow");
  const closing = scope.close();
  expect((await closing).status).toBe("cancelled");
  expect(ends).toEqual(["cancelled"]);
  const settled = await Promise.allSettled([pending]);
  expect(settled[0].status).toBe("rejected");
});

test("one request yields a request span with the route op nested under it", async () => {
  const scope = createScope({ tags: [tenant("acme")], observe: { history: 20 } });
  const app = userApp(scope);
  const res = await app.request("/users/42");
  expect(res.status).toBe(200);
  const spans = scope.spans();
  const head = spans.find((s) => s.name === "GET /users/:id");
  expect(head?.kind).toBe("operation");
  expect(head?.status).toBe("ok");
  expect(head?.attributes).toEqual({
    method: "GET",
    route: "/users/:id",
    path: "/users/42",
    status: 200,
  });
  const leaf = spans.find((s) => s.name === "getUser");
  expect(leaf?.parentId).toBe(head?.id);
  await scope.close();
});

test("one request writes one http request log line on the request span", async () => {
  const logs: Observe.Log[] = [];
  const clk = makeTestClock({ now: 0 });
  const scope = createScope({
    tags: [tenant("acme")],
    clock: clk,
    observe: { history: 20, log: (entry) => logs.push(entry) },
  });
  const app = userApp(scope);
  await app.request("/users/42");
  expect(logs.length).toBe(1);
  expect(logs[0].message).toBe("http request");
  expect(logs[0].attributes).toEqual({
    method: "GET",
    route: "/users/:id",
    path: "/users/42",
    status: 200,
    ms: 0,
  });
  const head = scope.spans().find((s) => s.name === "GET /users/:id");
  expect(logs[0].span).toBe(head);
  await scope.close();
});

test("a throwing route op settles the request span failed and reaches onError", async () => {
  const boom = operation({
    label: "boom",
    run: () => {
      throw new Error("kaboom");
    },
  });
  const scope = createScope({ observe: { history: 20 } });
  let seen: unknown;
  const app = new Hono().use(tinker(scope)).get("/boom", handle(boom));
  app.onError((e, c) => {
    seen = e;
    return c.text("err", 500);
  });
  const res = await app.request("/boom");
  expect(res.status).toBe(500);
  if (!(seen instanceof Error)) throw seen;
  expect(seen.message).toBe("kaboom");
  const head = scope.spans().find((s) => s.name === "GET /boom");
  expect(head?.status).toBe("failed");
  await scope.close();
});

test("with observation off no span is recorded and the request still answers", async () => {
  const scope = createScope({ tags: [tenant("acme")] });
  const app = userApp(scope);
  const res = await app.request("/users/42");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 42, tenant: "public", path: "/users/42" });
  expect(scope.spans()).toEqual([]);
  await scope.close();
});

test("input is required at the type level when the operation takes one", () => {
  const needsInput: [] extends Parameters<typeof handle<typeof getUser>> ? false : true = true;
  expect(needsInput).toBe(true);
});
