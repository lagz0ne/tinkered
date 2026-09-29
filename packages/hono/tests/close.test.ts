import { expect, test } from "vite-plus/test";
import { createScope, extension, operation, resource, type Observe } from "@tinker/core";
import { HTTPException } from "hono/http-exception";
import { errorResponses, hono, route, stream } from "../src/index.ts";

const ready = operation({ label: "ready", run: () => "ok" });

test("a failed session hook replaces the built answer with 500 and one failure line", async () => {
  const logs: Observe.Log[] = [];
  const checkClose = extension({
    label: "checkClose",
    session: async (_session, next) => {
      await next();
      return { status: "failed", error: new Error("close failed") };
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

test("a synchronous stream error closes its request session failed", async () => {
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
    await expect(response.text()).rejects.toBe(failure);
    await scope.close();
    expect(ends).toEqual(["failed"]);
  } finally {
    await scope.close();
  }
});
