import { expect, test } from "vite-plus/test";
import {
  createScope,
  isError as isCoreError,
  makeTestClock,
  operation,
  resource,
  tag,
  type Observe,
  type Operation,
} from "@tinker/core";
import { hono, request, route } from "../src/index.ts";

const tenant = tag<string>({ label: "tenant" });
const secret = tag<string>({ label: "secret" });

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (Number.isNaN(id)) throw new Error("bad id");
  return id;
}

/** Serve one route whose `onError` answers every failure 503, recording each request
 * session's close status through a session resource the operation reads. */
async function serveRecovering(fail: (ctx: Operation.Ctx<void>) => unknown) {
  const ends: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { req: request },
    factory: (_deps, ctx) => {
      ctx.defer((end) => {
        ends.push(end.status);
      });
      return "tx";
    },
  });
  const failing = operation({ label: "failing", depends: { tx }, run: (_deps, ctx) => fail(ctx) });
  const { extension: web } = hono([route.get("/fail", failing)], {
    onError: (_error, c) => c.text("unavailable", 503),
  });
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  return { app: scope.resolve(web), ends, scope };
}

const getUser = operation({
  label: "getUser",
  input: parseId,
  depends: { tenant },
  run: ({ tenant }, ctx) => ({ id: ctx.input, tenant }),
});

test("a parse failure answers 400 with the request span ok and the op span failed", async () => {
  const logs: Observe.Log[] = [];
  let seen: unknown;
  const { extension: web } = hono(
    [route.get("/users/:id", getUser, { input: (c) => c.req.param("id") })],
    {
      onError: (e) => {
        seen = e;
        return undefined;
      },
    },
  );
  const scope = createScope({
    tags: [tenant("acme")],
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const app = scope.resolve(web);
  const res = await app.request("/users/abc");
  expect(res.status).toBe(400);
  if (!isCoreError(seen, "DataValidationFailed")) throw seen;
  expect(seen.payload.label).toBe("getUser");
  if (!(seen.payload.cause instanceof Error)) throw seen.payload.cause;
  const head = scope.spans().find((s) => s.name === "GET /users/:id");
  expect(head?.status).toBe("ok");
  expect(head?.attributes.status).toBe(400);
  const leaf = scope.spans().find((s) => s.name === "getUser");
  expect(leaf?.parentId).toBe(head?.id);
  expect(leaf?.status).toBe("failed");
  const requests = logs.filter((entry) => entry.message === "http request");
  expect(requests.length).toBe(1);
  expect(requests[0].attributes.status).toBe(400);
  await scope.close();
});

test("a missing required tag answers 500 with the request span ok", async () => {
  const logs: Observe.Log[] = [];
  const readSecret = operation({
    label: "readSecret",
    depends: { secret: secret.required },
    run: ({ secret }) => secret,
  });
  const { extension: web } = hono([route.get("/secret", readSecret)]);
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const res = await scope.resolve(web).request("/secret");
  expect(res.status).toBe(500);
  const head = scope.spans().find((s) => s.name === "GET /secret");
  expect(head?.status).toBe("ok");
  expect(head?.attributes.status).toBe(500);
  const requests = logs.filter((entry) => entry.message === "http request");
  expect(requests.length).toBe(1);
  expect(requests[0].attributes.status).toBe(500);
  await scope.close();
});

test("a missing required tag answers internal in the response body", async () => {
  const readSecret = operation({
    label: "readSecret",
    depends: { secret: secret.required },
    run: ({ secret }) => secret,
  });
  const { extension: web } = hono([route.get("/secret", readSecret)]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/secret");
  expect(res.status).toBe(500);
  expect(await res.text()).toBe("internal");
  await scope.close();
});

test("a client abort answers nothing usable but logs one 499 line and cancels the op", async () => {
  const logs: Observe.Log[] = [];
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
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const app = scope.resolve(web);
  const ac = new AbortController();
  const pending = app.request("/slow", { signal: ac.signal });
  ac.abort();
  const settled = await Promise.allSettled([pending]);
  expect(ends).toEqual(["cancelled"]);
  expect(settled[0].status).toBe("rejected");
  const requests = logs.filter((entry) => entry.message === "http request");
  expect(requests.length).toBe(1);
  expect(requests[0].attributes.status).toBe(499);
  await scope.close();
});

test("an unmapped error reaches onError with the request span failed and no http request log", async () => {
  const logs: Observe.Log[] = [];
  const boom = operation({
    label: "boom",
    run: () => {
      throw new Error("kaboom");
    },
  });
  const { extension: web } = hono([route.get("/boom", boom)]);
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
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
  expect(logs.filter((entry) => entry.message === "http request")).toEqual([]);
  await scope.close();
});

test("onError answers first: a parse failure becomes 418 while MissingTag keeps 500", async () => {
  const logs: Observe.Log[] = [];
  const readSecret = operation({
    label: "readSecret",
    depends: { secret: secret.required },
    run: ({ secret }) => secret,
  });
  const { extension: web } = hono(
    [
      route.get("/users/:id", getUser, { input: (c) => c.req.param("id") }),
      route.get("/secret", readSecret),
    ],
    {
      onError: (e, c) =>
        isCoreError(e, "DataValidationFailed") ? c.text("teapot", 418) : undefined,
    },
  );
  const scope = createScope({
    tags: [tenant("acme")],
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const app = scope.resolve(web);
  const teapot = await app.request("/users/abc");
  expect(teapot.status).toBe(418);
  const head = scope.spans().find((s) => s.name === "GET /users/:id");
  expect(head?.status).toBe("ok");
  expect(head?.attributes.status).toBe(418);
  expect(
    logs
      .filter((entry) => entry.message === "http request")
      .map((entry) => entry.attributes.status),
  ).toEqual([418]);
  const fallback = await app.request("/secret");
  expect(fallback.status).toBe(500);
  const secretHead = scope.spans().find((s) => s.name === "GET /secret");
  expect(secretHead?.status).toBe("ok");
  expect(secretHead?.attributes.status).toBe(500);
  expect(
    logs
      .filter((entry) => entry.message === "http request")
      .map((entry) => entry.attributes.status),
  ).toEqual([418, 500]);
  await scope.close();
});

test("onError recovers a panic from the operation and the request session closes success", async () => {
  const { app, ends, scope } = await serveRecovering(() => {
    throw new Error("kaboom");
  });
  const res = await app.request("/fail");
  expect(res.status).toBe(503);
  for (let i = 0; i < 50 && ends.length === 0; i++) await Promise.resolve();
  expect(ends).toEqual(["success"]);
  await scope.close();
});

test("onError recovers a raised error from the operation and the request session closes success", async () => {
  const { app, ends, scope } = await serveRecovering(({ raise }) =>
    raise("Busy", { retryAfter: 1 }),
  );
  const res = await app.request("/fail");
  expect(res.status).toBe(503);
  for (let i = 0; i < 50 && ends.length === 0; i++) await Promise.resolve();
  expect(ends).toEqual(["success"]);
  await scope.close();
});

test("an operation that finishes after a client abort answers its value and logs 200", async () => {
  const logs: Observe.Log[] = [];
  let release: (value: string) => void = () => undefined;
  const late = operation({
    label: "late",
    run: () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  });
  const { extension: web } = hono([route.get("/late", late)]);
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    extensions: [web],
  });
  await scope.ready;
  const ac = new AbortController();
  const pending = scope.resolve(web).request("/late", { signal: ac.signal });
  ac.abort();
  release("done");
  const res = await pending;
  expect(await res.json()).toBe("done");
  expect(
    logs
      .filter((entry) => entry.message === "http request")
      .map((entry) => entry.attributes.status),
  ).toEqual([200]);
  await scope.close();
});
