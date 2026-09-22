# @tinker/hono

A Hono server as an **extension the scope owns** (ADR 0060): the entrypoint
calls `hono(routes)` and installs the returned extension; the extension's
`start` pulls the scope, mounts the routes, and opens one session per
request. Each request runs the route's operation as an inline op (span, one
log line, error map) and closes graceful — a `stream` row keeps the session
open until the body ends.

```ts
// main.ts (the entrypoint owns the scope and its close)
import { serve } from "@hono/node-server";
import { createScope } from "@tinker/core";
import { hono } from "@tinker/hono";
import { store } from "./store.ts";
import { issueRoutes, tenant } from "./routes.ts";

const { extension: web } = hono(issueRoutes, {
  tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")],
  serve: (app) => serve({ fetch: app.fetch }),
});
const scope = createScope({ tags: [tenant("public")], extensions: [web] });
await scope.ready; // every row's loader ran once; a rejection fails boot
await scope.resolve(store.db); // warm-up: the read verb is the warm-up
process.on("SIGTERM", async () => {
  await scope.close({ graceful: true }); // waits for requests, stops serve
  process.exit(0);
});
```

```ts
// routes.ts (rows: verb plus path, a loader, the request shape — no scope here)
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

export const issueRoutes = [
  route.get("/users/:id", () => import("./getUser.ts").then((m) => m.getUser), {
    input: (c) => c.req.param("id"),
  }),
  route.get("/health", () => import("./health.ts").then((m) => m.health)),
];
```

```ts
// a test is an entrypoint: one extension with one row, presets, drive via app.request
const { extension: web } = hono([
  route.get("/users/:id", () => getUser, { input: (c) => c.req.param("id") }),
]);
const scope = createScope({ tags: [tenant("acme")], extensions: [web] });
await scope.ready;
const res = await scope.resolve(web).request("/users/42");
expect(await res.json()).toEqual({ id: 42 });
```

Two `hono()` calls on one scope are two apps (two servers, one close):
store each returned extension once (`const { extension: web } = hono(...)`),
install it, resolve it — a second call is a different identity. Each
`serve` bind stops on `scope.close()` through the extension onion, so one
close reaps both listeners.

## Hand mounting

`mount` stays for routes that need `stream` directly and cannot be rows yet:
`hono(rows, { mount: (app) => { … } })` runs after the rows, inside the same
session middleware, so `stream` sees the request session.

The `input` callback may return a promise: the endpoint awaits it, then parses
the value through the operation's `input`. Pass a JSON body read straight
through — a rejected body read answers 400 like a parse failure: the request
edge could not read what the client sent.

```ts
route.post("/users", () => createUser, {
  input: (c) => c.req.json(),
  respond: (user, c) => c.json(user, 201),
});
```

Each request runs as an inline operation (`"GET /users/:id"`) whose one dependency is the
route's operation — so core's spans, one `http request` log line, clock, and signal come for
free. The session closes gracefully (commit) after the handler; forced (rollback) on client
abort; a `stream` route closes when the body ends. Outside the extension's
middleware, `stream` raises `NoSession`.

`emit` is synchronous, so a `Sync.Transport.send` or any `watch` callback may call it directly; a throw means the client went away (ADR 0021: SSE is an adapter over watched cells).

## Streaming

A route that streams answers with `stream(c, write)`: the request session stays open until
the body finishes or the client cancels, then closes (every other response closes after
`next()`). The writer runs as its own inline operation (`"GET /path body"`), so `ctx.signal`,
`ctx.clock`, `ctx.log`, and its span are all available while the request span has ended.

```ts
route.get("/ticks", () => ticks, {
  respond: (ts, c) =>
    stream(c, async (emit, { clock, signal }) => {
      for (const t of ts) {
        emit(`${t}\n`);
        await clock.sleep(1000, signal);
      }
    }),
});
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

`hono(routes, { onError: (e, c) => Response | undefined })` answers first; `undefined`
falls through to the table. A mapped failure settles the request span `ok`.
