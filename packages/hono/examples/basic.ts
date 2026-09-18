import { createScope, operation, tag } from "@tinker/core";
import { honoApp, route, stream } from "../src/index.ts";

/** A cast-free tour of the driver: a scope at the entrypoint, one session per request,
 * routes bound on the scope and mounted eagerly at boot. The tour returns a string. */
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

  const routeBindings = [
    route.get("/greet/:name", () => greet, { input: (c) => c.req.param("name") }),
    route.get("/health", () => health),
    route.get("/ticks", () => ticks, {
      respond: (ts, c) =>
        stream(c, async (emit) => {
          for (const t of ts) await emit(t);
        }),
    }),
  ];

  const scope = createScope({ tags: [...routeBindings, tenant("acme")] });
  const app = await honoApp(scope, {
    tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  });

  const scoped = await app.request("/greet/ada", { headers: { "x-tenant": "beta" } });
  const fallback = await app.request("/greet/ada");
  const ping = await app.request("/health");
  const body = await (await app.request("/ticks")).text();
  await scope.close();
  return `${scoped.status} ${fallback.status} ${ping.status} ${body}`;
}
