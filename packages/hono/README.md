# @tinker/hono

A Hono server as a **session-level driver** (ADR 0039, 0040): the entrypoint owns the scope,
`tinker(scope)` opens one session per request, routes are declarations that never see a handle.

```ts
// main.ts (the entrypoint owns the scope and its close)
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createScope, tag } from "@tinker/core";
import { tinker } from "@tinker/hono";
import { routes, tenant } from "./routes.ts";

const scope = createScope({ tags: [tenant("public")] });
const app = new Hono()
  .use(tinker(scope, { tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")] })) // request-derived bindings
  .route("/", routes);
serve({ fetch: app.fetch });
process.on("SIGTERM", async () => {
  await scope.close({ graceful: true }); // waits for in-flight requests
  process.exit(0);
});
```

```ts
// routes.ts (declarations: input off the request, respond back to it — no scope here)
import { Hono } from "hono";
import { operation, tag } from "@tinker/core";
import { handle, request } from "@tinker/hono";

export const tenant = tag<string>({ label: "tenant" });

const getUser = operation({
  label: "getUser",
  input: parseId, // the edge: "42" -> 42, or DataValidationFailed -> 400
  depends: { users, tenant, req: request }, // `request` = the web Request, for the rare op that needs headers
  run: ({ users, tenant, req }, { input, signal }) =>
    users.find(tenant, input, { signal, lang: req.headers.get("accept-language") }),
});

export const routes = new Hono()
  .get("/users/:id", handle(getUser, { input: (c) => c.req.param("id") }))
  .get("/health", handle(health));
```

```ts
// a test is an entrypoint: mount the middleware plus routes, drive via app.request
const scope = createScope({ tags: [tenant("acme")] });
const app = new Hono().use(tinker(scope)).route("/", routes);
const res = await app.request("/users/42");
expect(await res.json()).toEqual({ id: 42 });
```

Each request runs as an inline operation (`"GET /users/:id"`) whose one dependency is the
route's operation — so core's spans, one `http request` log line, clock, and signal come for
free. The session closes gracefully (commit) after the handler; forced (rollback) on client
abort; a `stream` route closes when the body ends. Without `tinker` upstream, `handle`
raises `NoSession`.

## Streaming

A route that streams answers with `stream(c, write)`: the request session stays open until
the body finishes or the client cancels, then closes (every other response closes after
`next()`). The writer runs as its own inline operation (`"GET /path body"`), so `ctx.signal`,
`ctx.clock`, `ctx.log`, and its span are all available while the request span has ended.

```ts
.get(
  "/ticks",
  handle(ticks, {
    respond: (ts, c) =>
      stream(c, async (emit, { clock, signal }) => {
        for (const t of ts) {
          await emit(`${t}\n`);
          await clock.sleep(1000, signal);
        }
      }),
  }),
);
```

## Errors

| failure                                                                      | status                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| the operation's `parse` threw (`DataValidationFailed`, raw error as `cause`) | 400                                       |
| request cancelled (abort)                                                    | 499 (logged, then Hono rejects as before) |
| `MissingTag` / `NoSession`                                                   | 500                                       |
| anything else                                                                | rethrown to Hono's `onError`, no log line |

`tinker(scope, { onError: (e, c) => Response | undefined })` answers first; `undefined`
falls through to the table. A mapped failure settles the request span `ok`.
