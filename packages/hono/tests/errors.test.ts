import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import { createScope, makeTestClock, operation, tag, type Observe } from "@tinker/core";
import { handle, tinker } from "../src/index.ts";

const tenant = tag<string>({ label: "tenant" });
const secret = tag<string>({ label: "secret" });

class BadId extends Error {}

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (Number.isNaN(id)) throw new BadId();
  return id;
}

const getUser = operation({
  label: "getUser",
  input: parseId,
  depends: { tenant },
  run: ({ tenant }, ctx) => ({ id: ctx.input, tenant }),
});

test("a parse failure answers 400 with the request span ok and the op span failed", async () => {
  const logs: Observe.Log[] = [];
  const scope = createScope({
    tags: [tenant("acme")],
    observe: { history: 20, log: (entry) => logs.push(entry) },
  });
  const app = new Hono()
    .use(tinker(scope))
    .get("/users/:id", handle(getUser, { input: (c) => c.req.param("id") }));
  const res = await app.request("/users/abc");
  expect(res.status).toBe(400);
  const head = scope.spans().find((s) => s.name === "GET /users/:id");
  expect(head?.status).toBe("ok");
  expect(head?.attributes.status).toBe(400);
  const leaf = scope.spans().find((s) => s.name === "getUser");
  expect(leaf?.parentId).toBe(head?.id);
  expect(leaf?.status).toBe("failed");
  expect(logs.length).toBe(1);
  expect(logs[0].attributes.status).toBe(400);
  await scope.close();
});

test("a missing required tag answers 500 with the request span ok", async () => {
  const logs: Observe.Log[] = [];
  const readSecret = operation({
    label: "readSecret",
    depends: { secret: secret.required },
    run: ({ secret }) => secret,
  });
  const scope = createScope({ observe: { history: 20, log: (entry) => logs.push(entry) } });
  const app = new Hono().use(tinker(scope)).get("/secret", handle(readSecret));
  const res = await app.request("/secret");
  expect(res.status).toBe(500);
  const head = scope.spans().find((s) => s.name === "GET /secret");
  expect(head?.status).toBe("ok");
  expect(head?.attributes.status).toBe(500);
  expect(logs.length).toBe(1);
  expect(logs[0].attributes.status).toBe(500);
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
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    observe: { history: 20, log: (entry) => logs.push(entry) },
  });
  const app = new Hono().use(tinker(scope)).get("/slow", handle(slow));
  const ac = new AbortController();
  const pending = app.request("/slow", { signal: ac.signal });
  ac.abort();
  const settled = await Promise.allSettled([pending]);
  expect(ends).toEqual(["cancelled"]);
  expect(settled[0].status).toBe("rejected");
  expect(logs.length).toBe(1);
  expect(logs[0].message).toBe("http request");
  expect(logs[0].attributes.status).toBe(499);
  await scope.close();
});

test("an unmapped error reaches onError with the request span failed and no log line", async () => {
  const logs: Observe.Log[] = [];
  const boom = operation({
    label: "boom",
    run: () => {
      throw new Error("kaboom");
    },
  });
  const scope = createScope({ observe: { history: 20, log: (entry) => logs.push(entry) } });
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
  expect(logs.length).toBe(0);
  await scope.close();
});

test("onError answers first: a parse failure becomes 418 while MissingTag keeps 500", async () => {
  const logs: Observe.Log[] = [];
  const readSecret = operation({
    label: "readSecret",
    depends: { secret: secret.required },
    run: ({ secret }) => secret,
  });
  const scope = createScope({
    tags: [tenant("acme")],
    observe: { history: 20, log: (entry) => logs.push(entry) },
  });
  const app = new Hono()
    .use(
      tinker(scope, {
        onError: (e, c) => (e instanceof BadId ? c.text("teapot", 418) : undefined),
      }),
    )
    .get("/users/:id", handle(getUser, { input: (c) => c.req.param("id") }))
    .get("/secret", handle(readSecret));
  const teapot = await app.request("/users/abc");
  expect(teapot.status).toBe(418);
  const head = scope.spans().find((s) => s.name === "GET /users/:id");
  expect(head?.status).toBe("ok");
  expect(head?.attributes.status).toBe(418);
  expect(logs.length).toBe(1);
  expect(logs[0].attributes.status).toBe(418);
  const fallback = await app.request("/secret");
  expect(fallback.status).toBe(500);
  const secretHead = scope.spans().find((s) => s.name === "GET /secret");
  expect(secretHead?.status).toBe("ok");
  expect(secretHead?.attributes.status).toBe(500);
  expect(logs.length).toBe(2);
  expect(logs[1].attributes.status).toBe(500);
  await scope.close();
});
