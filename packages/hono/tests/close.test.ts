import { expect, test } from "vite-plus/test";
import {
  createScope,
  extension,
  makeTestClock,
  operation,
  resource,
  type Observe,
} from "@tinker/core";
import { HTTPException } from "hono/http-exception";
import { emit, errorResponses, hono, route, stream } from "../src/index.ts";

const ready = operation({ label: "ready", run: () => "ok" });

test("a failed session hook replaces the built answer with 500 and one failure line", async () => {
  const logs: Observe.Log[] = [];
  const checkClose = extension({
    label: "checkClose",
    hooks: {
      session: async (event) => {
        await event.next();
        return { status: "failed", error: new Error("close failed") };
      },
    },
  });
  const { extension: web } = hono([route.get("/ready", ready)]);
  const scope = createScope({
    extensions: [web, checkClose],
    observe: { log: (entry) => logs.push(entry) },
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/ready");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("internal");
    expect(logs.filter((entry) => entry.message === "request failed")).toMatchObject([
      { attributes: { method: "GET", path: "/ready" } },
    ]);
  } finally {
    await scope.close();
  }
});

test("a teardown error replaces a mapped answer with 500 and one failure line", async () => {
  const logs: Observe.Log[] = [];
  const cleanup = resource({
    label: "cleanup",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw new HTTPException(418);
      });
    },
  });
  const fail = operation({
    label: "fail",
    depends: { cleanup },
    run: (_deps, { raise }) => raise("Conflict", {}),
  });
  const { extension: web } = hono([route.get("/fail", fail)], {
    onError: errorResponses({ Conflict: 409 }),
  });
  const scope = createScope({
    extensions: [web],
    observe: { log: (entry) => logs.push(entry) },
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/fail");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("internal");
    expect(logs.filter((entry) => entry.message === "request failed")).toMatchObject([
      { attributes: { method: "GET", path: "/fail" } },
    ]);
  } finally {
    await scope.close();
  }
});

test("a synchronous stream error keeps its 500 and closes its request session failed", async () => {
  const ends: string[] = [];
  const failure = new Error("writer failed");
  const lifetime = resource({
    label: "lifetime",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((end) => {
        ends.push(end.status);
      });
    },
  });
  const start = operation({ label: "start", depends: { lifetime }, run: () => undefined });
  const fail = operation({
    label: "fail",
    run: () => {
      throw failure;
    },
  });
  const { extension: web } = hono([
    route.get("/stream", start, { respond: (_value, c) => stream(c, fail) }),
  ]);
  const scope = createScope({ extensions: [web] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/stream");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("internal");
    expect(ends).toEqual(["failed"]);
  } finally {
    await scope.close();
  }
});

test("a request after scope close reaches Hono's error handler", async () => {
  const { extension: web } = hono([route.get("/ready", ready)]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  await scope.close({ graceful: true });
  const response = await app.request("/ready");
  expect(response.status).toBe(500);
  expect(await response.text()).toBe("internal");
});

test("a stream body can answer a forced shutdown with a final chunk", async () => {
  const body = operation({
    label: "body",
    depends: { emit: emit.required },
    run: async ({ emit }, { clock, signal }) => {
      emit("ready");
      try {
        await clock.sleep(10_000, signal);
      } catch (error: unknown) {
        if (error !== signal.reason) throw error;
        emit("cancelled");
      }
    },
  });
  const { extension: web } = hono([
    route.get("/stream", ready, { respond: (_value, c) => stream(c, body) }),
  ]);
  const scope = createScope({ clock: makeTestClock({ now: 0 }), extensions: [web] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/stream");
    const [text] = await Promise.all([response.text(), scope.close()]);
    expect(text).toBe("readycancelled");
  } finally {
    await scope.close();
  }
});

test("cleanup failure on reader cancellation logs one request failure", async () => {
  const logs: Observe.Log[] = [];
  const cleanupFailure = new Error("cleanup failed");
  const cleanup = resource({
    label: "cleanup",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw cleanupFailure;
      });
    },
  });
  const start = operation({ label: "start", depends: { cleanup }, run: () => undefined });
  const held = operation({
    label: "held",
    depends: { emit: emit.required },
    run: async ({ emit }, { clock, signal }) => {
      emit("ready");
      await clock.sleep(10_000, signal);
    },
  });
  const { extension: web } = hono([
    route.get("/stream", start, { respond: (_value, c) => stream(c, held) }),
  ]);
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    extensions: [web],
    observe: { log: (entry) => logs.push(entry) },
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/stream");
    if (!response.body) throw new Error("no body");
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    expect(logs.filter((entry) => entry.message === "request failed")).toMatchObject([
      {
        attributes: {
          kind: "RequestCloseFailed",
          payload: { result: { status: "cancelled", teardownErrors: [cleanupFailure] } },
        },
      },
    ]);
  } finally {
    await scope.close();
  }
});

test("cleanup failure after a writer error logs once and keeps the reader error", async () => {
  const logs: Observe.Log[] = [];
  const writerFailure = new Error("writer failed");
  const cleanupFailure = new Error("cleanup failed");
  const cleanup = resource({
    label: "cleanup",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw cleanupFailure;
      });
    },
  });
  const start = operation({ label: "start", depends: { cleanup }, run: () => undefined });
  const broken = operation({
    label: "broken",
    run: async (_deps, { clock }) => {
      await clock.sleep(10);
      throw writerFailure;
    },
  });
  const { extension: web } = hono([
    route.get("/stream", start, { respond: (_value, c) => stream(c, broken) }),
  ]);
  const clock = makeTestClock({ now: 0 });
  const scope = createScope({
    clock,
    extensions: [web],
    observe: { log: (entry) => logs.push(entry) },
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/stream");
    const text = response.text();
    clock.advance(10);
    await expect(text).rejects.toBe(writerFailure);
    await expect
      .poll(() => logs.filter((entry) => entry.message === "request failed"))
      .toMatchObject([
        {
          attributes: {
            kind: "RequestCloseFailed",
            payload: { result: { status: "failed", teardownErrors: [cleanupFailure] } },
          },
        },
      ]);
  } finally {
    await scope.close();
  }
});
