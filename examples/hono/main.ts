import { createScope, type Scope } from "@tinker/core";
import { database, tenant, web } from "./basic.ts";

if (import.meta.main) {
  const stop = new AbortController();
  const requestStop = () => stop.abort();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  const scope = createScope({
    signal: stop.signal,
    tags: [tenant("acme"), database("public-db")],
    extensions: [web],
  });
  let output: string;
  let end: Scope.Result;
  try {
    await scope.ready;
    const app = scope.resolve(web);

    const scoped = await app.request("/greet/ada", { headers: { "x-tenant": "beta" } });
    const fallback = await app.request("/greet/ada");
    const ping = await app.request("/health");
    const alphaDb = await app.request("/database", { headers: { "x-tenant": "alpha" } });
    const betaDb = await app.request("/database", { headers: { "x-tenant": "beta" } });
    const unknownDb = await app.request("/database", { headers: { "x-tenant": "unknown" } });
    const body = await (await app.request("/ticks")).text();
    output = [
      scoped.status,
      fallback.status,
      ping.status,
      await alphaDb.json(),
      await betaDb.json(),
      await unknownDb.json(),
      body,
    ].join(" ");
  } finally {
    stop.abort();
    end = await scope.closed;
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  process.stdout.write(`${output}\n`);
}
