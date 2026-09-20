# @tinker/hono

A Hono server as a **session-level driver** (ADR 0039, 0040): the entrypoint owns the scope,
`tinker(scope)` opens one session per request, routes are scope config mounted eagerly at
boot (ADR 0042).

```ts
// main.ts (the entrypoint owns the scope and its close)
import { serve } from "@hono/node-server";
import { createScope } from "@tinker/core";
import { honoApp } from "@tinker/hono";
import { store } from "./store.ts";
import { routeBindings, tenant } from "./routes.ts";

const scope = createScope({ tags: [...routeBindings, tenant("public")] });
await scope.resolve(store.db); // warm-up: the read verb is the warm-up
const app = await honoApp(scope, {
  tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")], // request-derived bindings
});
serve({ fetch: app.fetch });
process.on("SIGTERM", async () => {
  await scope.close({ graceful: true }); // waits for in-flight requests
  process.exit(0);
});
```

```ts
// routes.ts (bindings: verb plus path, a loader, the request shape — no scope here)
import { operation, tag } from "@tinker/core";
import { request, route } from "@tinker/hono";

export const tenant = tag<string>({ label: "tenant" });

const getUser = operation({
  label: "getUser",
  input: parseId, // the edge: "42" -> 42, or DataValidationFailed -> 400
  depends: { users, tenant, req: request }, // `request` = the web Request, for the rare op that needs headers
  run: ({ users, tenant, req }, { input, signal }) =>
    users.find(tenant, input, { signal, lang: req.headers.get("accept-language") }),
});

export const routeBindings = [
  route.get("/users/:id", () => import("./getUser.ts").then((m) => m.getUser), {
    input: (c) => c.req.param("id"),
  }),
  route.get("/health", () => import("./health.ts").then((m) => m.health)),
];
```

```ts
// a test is an entrypoint: bind routes on the scope, mount eagerly, drive via app.request
const scope = createScope({ tags: [...routeBindings, tenant("acme")] });
const app = await honoApp(scope);
const res = await app.request("/users/42");
expect(await res.json()).toEqual({ id: 42 });
```

`honoApp(scope)` imports every route at mount — a rejecting loader rejects `honoApp`
itself, so bad config fails at boot, never on a request.

## Hand mounting

`tinker` plus `handle` stay public for routes mounted by hand: `new Hono().use(tinker(scope))`
opens the session per request, `handle(op, { input?, respond? })` answers one endpoint. `honoApp`
composes the two — it adds no request logic of its own.

The `input` callback may return a promise: `handle` awaits it, then parses the value
through the operation's `input`. Pass a JSON body read straight through — a rejected
body read answers 400 like a parse failure: the request edge could not read what the
client sent.

```ts
route.post("/users", () => createUser, {
  input: (c) => c.req.json(),
  respond: (user, c) => c.json(user, 201),
});
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

If a test or shutdown leaves a stream open, use plain `await scope.close()` to force
shutdown. The writer must respond to `ctx.signal` so it can settle. A graceful close waits
for the body to end and can wait forever for a live stream; choose forced close from the
start, since a later call cannot upgrade an in-progress graceful close.

## Errors

| failure                                                                      | status                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| the operation's `parse` threw (`DataValidationFailed`, raw error as `cause`) | 400                                       |
| the async body read failed (`InputRejected`, raw error as `cause`)           | 400                                       |
| request cancelled (abort)                                                    | 499 (logged, then Hono rejects as before) |
| `MissingTag` / `NoSession`                                                   | 500                                       |
| anything else                                                                | rethrown to Hono's `onError`, no log line |

`tinker(scope, { onError: (e, c) => Response | undefined })` answers first; `undefined`
falls through to the table. A mapped failure settles the request span `ok`.
