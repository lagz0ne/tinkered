import { namespace, operation, resource, tag } from "@tinker/core";
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
