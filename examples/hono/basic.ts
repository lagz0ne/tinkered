import { createScope, namespace, operation, resource, tag, type Scope } from "@tinker/core";
import { emit, hono, route, stream } from "@tinker/hono";
import { z } from "zod";

export const tenant = tag<string>({ label: "tenant" });
export const database = tag<string>({ label: "database" });
const alpha = namespace({ tags: [database("alpha-db")] });
const beta = namespace({ tags: [database("beta-db")] });
const tenants = new Map<string, typeof alpha>();
tenants.set("alpha", alpha);
tenants.set("beta", beta);
const connection = resource({
  label: "connection",
  target: "namespace",
  depends: { database },
  factory: ({ database }) => ({ database }),
});
const readDatabase = operation({
  label: "readDatabase",
  depends: { connection },
  run: ({ connection }) => connection.database,
});

const greet = operation({
  label: "greet",
  input: z.string(),
  depends: { tenant },
  run: ({ tenant }, ctx) => `hello ${ctx.input} from ${tenant}`,
});

const health = operation({ label: "health", run: () => "ok" });

const ticks = operation({ label: "ticks", run: () => ["a", "b"] });

const tickBody = operation({
  label: "tickBody",
  input: z.array(z.string()),
  depends: { emit: emit.required },
  run: ({ emit }, { input }) => {
    for (const t of input) emit(t);
  },
});

/** Each root gets its own app from the same declared graph. */
export const { extension: web } = hono(
  [
    route.get("/greet/:name", greet, { input: (c) => c.req.param("name") }),
    route.get("/health", health),
    route.get("/database", readDatabase),
    route.get("/ticks", ticks, {
      respond: (ts, c) => stream(c, tickBody, { input: ts }),
    }),
  ],
  {
    ns: (c) => tenants.get(c.req.header("x-tenant") ?? ""),
    tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  },
);

/** Requests run in memory; their sessions and the root all finish before this tour returns. */
export async function tour(): Promise<string> {
  const stop = new AbortController();
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
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  return output;
}
