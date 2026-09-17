import { Hono } from "hono";
import { createScope, operation, tag } from "@tinker/core";
import { handle, stream, tinker } from "../src/index.ts";

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

  const ticks = operation({ label: "ticks", run: () => ["a", "b"] });

  const routes = new Hono()
    .get("/greet/:name", handle(greet, { input: (c) => c.req.param("name") }))
    .get("/health", handle(health))
    .get(
      "/ticks",
      handle(ticks, {
        respond: (ts, c) =>
          stream(c, async (emit) => {
            for (const t of ts) await emit(t);
          }),
      }),
    );

  const scope = createScope({ tags: [tenant("acme")] });
  const app = new Hono()
    .use(tinker(scope, { tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")] }))
    .route("/", routes);

  const scoped = await app.request("/greet/ada", { headers: { "x-tenant": "beta" } });
  const fallback = await app.request("/greet/ada");
  const ping = await app.request("/health");
  const body = await (await app.request("/ticks")).text();
  await scope.close();
  return `${scoped.status} ${fallback.status} ${ping.status} ${body}`;
}
