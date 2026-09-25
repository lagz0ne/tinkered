import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import {
  createScope,
  data,
  makeTestClock,
  namespace,
  operation,
  resource,
  tag,
  type Observe,
} from "@tinker/core";
import { emit, hono, isError, request, route, stream } from "../src/index.ts";

const noSessionBody = operation({
  label: "noSessionBody",
  depends: { emit: emit.required },
  run: ({ emit }) => emit("a"),
});

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
  const { extension: web } = hono(
    [route.get("/users/:id", getUser, { input: (c) => c.req.param("id") })],
    { tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")] },
  );
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

test("request namespaces share a tenant resource and keep tenant and request tags separate", async () => {
  const config = tag<string>({ label: "config" });
  const caller = tag<string>({ label: "caller" });
  const alpha = namespace({ tags: [config("alpha-db")] });
  const beta = namespace({ tags: [config("beta-db")] });
  let builds = 0;
  const db = resource({
    label: "db",
    target: "namespace",
    depends: { config },
    factory: ({ config }) => ({ id: ++builds, config }),
  });
  const readDb = operation({
    label: "readDb",
    depends: { db, caller },
    run: ({ db, caller }) => ({ ...db, caller }),
  });
  const { extension: web } = hono([route.get("/db", readDb)], {
    ns: (c) => (c.req.header("x-tenant") === "alpha" ? alpha : beta),
    tags: (c) => [caller(c.req.header("x-caller") ?? "guest")],
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  const first = await app.request("/db", {
    headers: { "x-tenant": "alpha", "x-caller": "ada" },
  });
  const other = await app.request("/db", {
    headers: { "x-tenant": "beta", "x-caller": "ben" },
  });
  const again = await app.request("/db", {
    headers: { "x-tenant": "alpha", "x-caller": "cam" },
  });
  expect(await first.json()).toEqual({ id: 1, config: "alpha-db", caller: "ada" });
  expect(await other.json()).toEqual({ id: 2, config: "beta-db", caller: "ben" });
  expect(await again.json()).toEqual({ id: 1, config: "alpha-db", caller: "cam" });
  expect(builds).toBe(2);
  await scope.close();
});

test("a cell written by a tenant request does not reach its next request", async () => {
  const alpha = namespace();
  const cell = data({ initial: 0 });
  const write = operation({
    label: "write",
    depends: { cell: cell.controller },
    run: ({ cell }) => {
      cell.set(7);
      return cell.get();
    },
  });
  const read = operation({ label: "read", depends: { cell }, run: ({ cell }) => cell });
  const { extension: web } = hono([route.post("/write", write), route.get("/read", read)], {
    ns: () => alpha,
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  expect(await (await app.request("/write", { method: "POST" })).json()).toBe(7);
  expect(await (await app.request("/read")).json()).toBe(0);
  await scope.close();
});

test("an undefined namespace hook uses the same default resource as no hook", async () => {
  let builds = 0;
  const shared = resource({ label: "shared", target: "namespace", factory: () => ++builds });
  const read = operation({ label: "read", depends: { shared }, run: ({ shared }) => shared });
  const { extension: plain } = hono([route.get("/read", read)]);
  const { extension: optional } = hono([route.get("/read", read)], { ns: () => undefined });
  const scope = createScope({ extensions: [plain, optional] });
  await scope.ready;
  expect(await (await scope.resolve(plain).request("/read")).json()).toBe(1);
  expect(await (await scope.resolve(optional).request("/read")).json()).toBe(1);
  expect(builds).toBe(1);
  await scope.close();
});

test("a void op answers its value as json by default, or as text with respond", async () => {
  const health = operation({ label: "health", run: () => "ok" });
  const { extension: web } = hono([
    route.get("/json", health),
    route.get("/text", health, { respond: (v, c) => c.text(String(v)) }),
  ]);
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
  const { extension: web } = hono([route.get("/a", who), route.get("/b", who)]);
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
  const { extension: web } = hono([route.get("/slow", slow)]);
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
  const app = new Hono().get("/stream", (c) => stream(c, noSessionBody));
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
  const { extension: web } = hono([route.get("/slow", slow)]);
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
  const { extension: web } = hono([route.get("/slow", slow)]);
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
  const { extension: web } = hono([
    route.get("/users/:id", getUser, { input: (c) => c.req.param("id") }),
  ]);
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
  const { extension: web } = hono([
    route.get("/users/:id", getUser, { input: (c) => c.req.param("id") }),
  ]);
  const scope = createScope({
    tags: [tenant("acme")],
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const app = scope.resolve(web);
  await app.request("/users/42");
  const requests = logs.filter((entry) => entry.message === "http request");
  expect(requests.length).toBe(1);
  expect(requests[0].attributes).toEqual({
    method: "GET",
    route: "/users/:id",
    path: "/users/42",
    status: 200,
  });
  const head = scope.spans().find((s) => s.name === "GET /users/:id");
  expect(requests[0].span).toBe(head);
  await scope.close();
});

test("a throwing route op settles the request span failed and reaches onError", async () => {
  const boom = operation({
    label: "boom",
    run: () => {
      throw new Error("kaboom");
    },
  });
  const { extension: web } = hono([route.get("/boom", boom)]);
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
  const { extension: web } = hono(
    [route.get("/users/:id", getUser, { input: (c) => c.req.param("id") })],
    { tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")] },
  );
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
  const row = route.get("/ping", ping);
  expect(row.method).toBe("GET");
});

test("resolving the extension before ready raises NotResolved", async () => {
  const ping = operation({ label: "ping", run: () => "pong" });
  const { extension: web } = hono([route.get("/ping", ping)]);
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
  const { extension: first } = hono([route.get("/one", one)]);
  const { extension: second } = hono([route.get("/two", two)]);
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

test("one scope close stops both servers once; a second close stops neither again", async () => {
  const stops: string[] = [];
  const serve = (name: string) => () => {
    stops.push(`listening:${name}`);
    return () => {
      stops.push(`stopped:${name}`);
    };
  };
  const one = operation({ label: "one", run: () => "one" });
  const two = operation({ label: "two", run: () => "two" });
  const { extension: first } = hono([route.get("/one", one)], { serve: serve("one") });
  const { extension: second } = hono([route.get("/two", two)], { serve: serve("two") });
  const scope = createScope({ extensions: [first, second] });
  await scope.ready;
  expect(stops.sort()).toEqual(["listening:one", "listening:two"]);
  expect(await (await scope.resolve(first).request("/one")).text()).toContain("one");
  expect(await (await scope.resolve(second).request("/two")).text()).toContain("two");
  stops.length = 0;
  await scope.close();
  // Both listeners stopped, each exactly once: no reap means the port
  // stays open (the leak fix 1 closes), a double stop means two owners.
  expect(stops.sort()).toEqual(["stopped:one", "stopped:two"]);
  stops.length = 0;
  await scope.close();
  // The second close finds both already reaped: neither stop runs again.
  expect(stops).toEqual([]);
});

test("two servers share a scope resource: a write through one is seen by the other", async () => {
  const audit = resource({
    label: "audit",
    target: "scope",
    factory: () => ({ entries: [] as string[] }),
  });
  const record = operation({
    label: "record",
    depends: { audit },
    run: ({ audit }) => {
      audit.entries.push("app");
      return audit.entries.length;
    },
  });
  const readAudit = operation({
    label: "readAudit",
    depends: { audit },
    run: ({ audit }) => [...audit.entries],
  });
  const { extension: appServer } = hono([route.post("/audit", record)]);
  const { extension: adminServer } = hono([route.get("/audit", readAudit)]);
  const scope = createScope({ extensions: [appServer, adminServer] });
  await scope.ready;
  const admin = scope.resolve(adminServer);
  expect(await (await admin.request("/audit")).json()).toEqual([]);
  const wrote = await scope.resolve(appServer).request("/audit", { method: "POST" });
  expect(await wrote.json()).toBe(1);
  // One scope-target instance for both servers: the app's write is the
  // admin's next read, and neither server built its own copy.
  expect(await (await admin.request("/audit")).json()).toEqual(["app"]);
  await scope.close();
});

test("a cell written through one server's request stays out of the other server's request", async () => {
  const draft = data({ initial: 0 });
  const writeDraft = operation({
    label: "writeDraft",
    depends: { draft: draft.controller },
    run: ({ draft }) => {
      draft.set(7);
      return draft.get();
    },
  });
  const readDraft = operation({
    label: "readDraft",
    depends: { draft },
    run: ({ draft }) => draft,
  });
  const { extension: appServer } = hono([route.post("/draft", writeDraft)]);
  const { extension: adminServer } = hono([route.get("/draft", readDraft)]);
  const scope = createScope({ extensions: [appServer, adminServer] });
  await scope.ready;
  const wrote = await scope.resolve(appServer).request("/draft", { method: "POST" });
  expect(await wrote.json()).toBe(7);
  // The write landed in the app request's session. The admin request is a
  // different session, so it reads the initial value, never the 7.
  expect(await (await scope.resolve(adminServer).request("/draft")).json()).toBe(0);
  await scope.close();
});

test("a path mounted on both servers answers from the server that got the request", async () => {
  const appPing = operation({ label: "appPing", run: () => "app" });
  const adminPing = operation({ label: "adminPing", run: () => "admin" });
  const { extension: appServer } = hono([route.get("/ping", appPing)]);
  const { extension: adminServer } = hono([route.get("/ping", adminPing)]);
  const scope = createScope({ extensions: [appServer, adminServer] });
  await scope.ready;
  expect(await (await scope.resolve(appServer).request("/ping")).json()).toBe("app");
  expect(await (await scope.resolve(adminServer).request("/ping")).json()).toBe("admin");
  await scope.close();
});

test("a serve bind returning a closer object closes its listener", async () => {
  let stops = 0;
  const { extension: web } = hono([], {
    serve: () => ({
      close: () => {
        stops++;
      },
    }),
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
  expect(stops).toBe(1);
});

test("a missing serve bind lets the scope close successfully", async () => {
  const { extension: web } = hono([]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
});

test("a close landing mid-bind still reaps the listener exactly once", async () => {
  let stops = 0;
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const ping = operation({ label: "ping", run: () => "pong" });
  let bound = false;
  const { extension: web } = hono([route.get("/ping", ping)], {
    serve: () => {
      bound = true;
      return gate.then(() => () => {
        stops += 1;
      });
    },
  });
  const scope = createScope({ extensions: [web] });
  // Wait until `start` is parked inside the bind (not merely scheduled):
  // the close must land while the bind is still pending for the race to
  // be real. `serve` ran means `ctx.defer` already registered, so the
  // close cannot take the idle fast path.
  for (let i = 0; i < 100 && !bound; i++) await Promise.resolve();
  expect(bound).toBe(true);
  const closing = scope.close();
  openGate();
  await closing;
  // The bind settled after the close ran: the stop fired at once, and the
  // later drain found nothing left to stop — exactly one stop, no leak.
  expect(stops).toBe(1);
  await scope.close();
  expect(stops).toBe(1);
});
