import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { database, tenant, web } from "./index.ts";

test("the routes select tenant databases and send the full stream", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: [tenant("acme"), database("public-db")],
    extensions: [web],
  });
  try {
    await scope.ready;
    const app = scope.resolve(web);
    const ping = await app.request("/health");
    const alphaDb = await app.request("/database", { headers: { "x-tenant": "alpha" } });
    const betaDb = await app.request("/database", { headers: { "x-tenant": "beta" } });
    const unknownDb = await app.request("/database", { headers: { "x-tenant": "unknown" } });
    expect(ping.status).toBe(200);
    expect(await alphaDb.json()).toBe("alpha-db");
    expect(await betaDb.json()).toBe("beta-db");
    expect(await unknownDb.json()).toBe("public-db");
    expect(await (await app.request("/ticks")).text()).toBe("ab");
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test("a greeting uses the tenant from the request", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: tenant("acme"),
    extensions: [web],
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/greet/ada", {
      headers: { "x-tenant": "beta" },
    });
    expect(await response.json()).toBe("hello ada from beta");
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test("a greeting with no tenant uses public", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: tenant("acme"),
    extensions: [web],
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/greet/ada");
    expect(await response.json()).toBe("hello ada from public");
  } finally {
    stop.abort();
    await scope.closed;
  }
});
