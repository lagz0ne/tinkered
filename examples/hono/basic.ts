import { createScope, operation, tag } from "@tinker/core";
import { hono, route, stream } from "@tinker/hono";
import { z } from "zod";

/** A cast-free tour of the driver: a scope at the entrypoint, one session per request,
 * flat rows handed to the extension and mounted eagerly at boot. The tour returns a string. */
export async function tour(): Promise<string> {
  const tenant = tag<string>({ label: "tenant" });

  const greet = operation({
    label: "greet",
    input: z.string(),
    depends: { tenant },
    run: ({ tenant }, ctx) => `hello ${ctx.input} from ${tenant}`,
  });

  const health = operation({ label: "health", run: () => "ok" });

  const ticks = operation({ label: "ticks", run: () => ["a", "b"] });

  const web = hono({
    routes: [
      route.get("/greet/:name", greet, { input: (c) => c.req.param("name") }),
      route.get("/health", health),
      route.get("/ticks", ticks, {
        respond: (ts, c) =>
          stream(c, (emit) => {
            for (const t of ts) emit(t);
            return Promise.resolve();
          }),
      }),
    ],
    tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  });

  const scope = createScope({ tags: [tenant("acme")], extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);

  const scoped = await app.request("/greet/ada", { headers: { "x-tenant": "beta" } });
  const fallback = await app.request("/greet/ada");
  const ping = await app.request("/health");
  const body = await (await app.request("/ticks")).text();
  await scope.close();
  return `${scoped.status} ${fallback.status} ${ping.status} ${body}`;
}
