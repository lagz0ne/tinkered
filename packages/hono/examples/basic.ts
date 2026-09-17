import { Hono } from "hono";
import { createScope, operation, tag } from "@tinker/core";
import { handle, tinker } from "../src/index.ts";

/** A cast-free tour of the driver: a scope at the entrypoint, one session per request,
 * routes made of declarations. The tour returns a string with every type inferred. */
export async function tour(): Promise<string> {
  const tenant = tag<string>({ label: "tenant" });

  const parseName = (raw: unknown): string => {
    if (typeof raw !== "string") throw new Error("bad name");
    return raw;
  };

  const greet = operation({
    label: "greet",
    input: parseName,
    depends: { tenant },
    run: ({ tenant }, ctx) => `hello ${ctx.input} from ${tenant}`,
  });

  const health = operation({ label: "health", run: () => "ok" });

  const routes = new Hono()
    .get("/greet/:name", handle(greet, { input: (c) => c.req.param("name") }))
    .get("/health", handle(health));

  const scope = createScope({ tags: [tenant("acme")] });
  const app = new Hono()
    .use(tinker(scope, { tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")] }))
    .route("/", routes);

  const scoped = await app.request("/greet/ada", { headers: { "x-tenant": "beta" } });
  const fallback = await app.request("/greet/ada");
  const ping = await app.request("/health");
  await scope.close();
  return `${scoped.status} ${fallback.status} ${ping.status}`;
}
