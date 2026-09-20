import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import { createScope, makeTestClock, operation, resource, tag, type Observe } from "@tinker/core";
import { hono, isError, request, route, stream } from "../src/index.ts";

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

test("a request-derived tag shadows the scope binding and the op sees the request url", async () => {
  const web = hono({
    routes: [route.get("/users/:id", () => getUser, { input: (c) => c.req.param("id") })],
    tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  });
  const scope = createScope({ tags: [tenant("acme")], extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  const res = await app.request("/users/42", { headers: { "x-tenant": "beta" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 42, tenant: "beta", path: "/users/42" });
  const fallback = await app.request("/users/42");
  expect(await fallback.json()).toEqual({ id: 42, tenant: "public", path: "/users/42" });
  await scope.close();
});

test("a void op answers its value as json by default, or as text with respond", async () => {
  const health = operation({ label: "health", run: () => "ok" });
  const web = hono({
    routes: [
      route.get("/json", () => health),
      route.get("/text", () => health, { respond: (v, c) => c.text(String(v)) }),
    ],
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
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
  const web = hono({
    routes: [route.get("/a", () => who), route.get("/b", () => who)],
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
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
  const web = hono({ routes: [route.get("/slow", () => slow)] });
  const scope = createScope({ clock: makeTestClock({ now: 0 }), extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  const ac = new AbortController();
  const pending = app.request("/slow", { signal: ac.signal });
  ac.abort();
  const settled = await Promise.allSettled([pending]);
  expect(ends).toEqual(["cancelled"]);
  expect(settled[0].status).toBe("rejected");
  await scope.close();
});

test("the extension mounts no session of its own: stream without rows raises NoSession to onError", async () => {
  let seen: unknown;
  const app = new Hono().get("/stream", (c) =>
    stream(c, (emit) => {
      emit("a");
      return Promise.resolve();
    }),
  );
  app.onError((e, c) => {
    seen = e;
    return c.text("err", 500);
  });
  const res = await app.request("/stream");
  expect(res.status).toBe(500);
  if (!isError(seen, "NoSession")) throw seen;
  expect(seen.payload.label).toBe("stream");
});

test("a graceful scope close waits for the in-flight request, then succeeds", async () => {
  const clk = makeTestClock({ now: 0 });
  const slow = operation({
    label: "slow",
    run: (_deps, { clock, signal }) => clock.sleep(10_000, signal),
  });
  const web = hono({ routes: [route.get("/slow", () => slow)] });
  const scope = createScope({ clock: clk, extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
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
  const web = hono({ routes: [route.get("/slow", () => slow)] });
  const scope = createScope({ clock: clk, extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  const pending = app.request("/slow");
  const closing = scope.close();
  expect((await closing).status).toBe("cancelled");
  expect(ends).toEqual(["cancelled"]);
  const settled = await Promise.allSettled([pending]);
  expect(settled[0].status).toBe("rejected");
});

test("one request yields a request span with the route op nested under it", async () => {
  const web = hono({
    routes: [route.get("/users/:id", () => getUser, { input: (c) => c.req.param("id") })],
  });
  const scope = createScope({
    tags: [tenant("acme")],
    observe: { history: 20 },
    extensions: [web],
  });
  await scope.ready;
  const app = scope.resolve(web);
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
  const web = hono({
    routes: [route.get("/users/:id", () => getUser, { input: (c) => c.req.param("id") })],
  });
  const scope = createScope({
    tags: [tenant("acme")],
    clock: clk,
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const app = scope.resolve(web);
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
  const web = hono({ routes: [route.get("/boom", () => boom)] });
  const scope = createScope({ observe: { history: 20 }, extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  let seen: unknown;
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
  const web = hono({
    routes: [route.get("/users/:id", () => getUser, { input: (c) => c.req.param("id") })],
    tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  });
  const scope = createScope({ tags: [tenant("acme")], extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  const res = await app.request("/users/42");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 42, tenant: "public", path: "/users/42" });
  expect(scope.spans()).toEqual([]);
  await scope.close();
});

test("input is required at the type level when the operation takes one", () => {
  const needsInput: [] extends Parameters<typeof route.get> ? false : true = true;
  expect(needsInput).toBe(true);
  const ping = operation({ label: "ping", run: () => "pong" });
  const row = route.get("/ping", () => ping);
  expect(row.method).toBe("GET");
});

test("resolving the extension before ready raises NotResolved", async () => {
  const ping = operation({ label: "ping", run: () => "pong" });
  const web = hono({ routes: [route.get("/ping", () => ping)] });
  const scope = createScope({ extensions: [web] });
  try {
    scope.resolve(web);
    throw new Error("unreachable");
  } catch (e) {
    const { isError: isCoreError } = await import("@tinker/core");
    if (!isCoreError(e, "NotResolved")) throw e;
  }
  await scope.ready;
  const app = scope.resolve(web);
  const res = await app.request("/ping");
  expect(res.status).toBe(200);
  await scope.close();
});

test("two hono extensions on one scope are two apps", async () => {
  const one = operation({ label: "one", run: () => "one" });
  const two = operation({ label: "two", run: () => "two" });
  const first = hono({ routes: [route.get("/one", () => one)] });
  const second = hono({ routes: [route.get("/two", () => two)] });
  const scope = createScope({ extensions: [first, second] });
  await scope.ready;
  const appOne = scope.resolve(first);
  const appTwo = scope.resolve(second);
  expect(await (await appOne.request("/one")).text()).toContain("one");
  expect(await appOne.request("/two")).toMatchObject({ status: 404 });
  expect(await (await appTwo.request("/two")).text()).toContain("two");
  expect(await appTwo.request("/one")).toMatchObject({ status: 404 });
  await scope.close();
});
