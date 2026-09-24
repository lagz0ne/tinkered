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

## Request namespaces

- Route = graph: the route picks the operation.
- Session = lifetime: each request gets its own session.
- Namespace = identity: tenant requests share tenant resources.

Pass `ns` in the wiring to choose a namespace from the request.
It can return one namespace, a fallback list, or `undefined`.
With no hook or an `undefined` result, the session uses the default namespace.
Request `tags` still bind to the session beside namespace tags.
A resource with `target: "namespace"` is built once per tenant for the scope's lifetime.
A cell written in one request stays in that request's session.

```ts
import { namespace, resource, tag } from "@tinker/core";

const database = tag<string>({ label: "database" });
const alpha = namespace({ tags: [database("alpha-db")] });
const beta = namespace({ tags: [database("beta-db")] });
const tenants = new Map<string, typeof alpha>();
tenants.set("alpha", alpha);
tenants.set("beta", beta);
const pool = resource({
  label: "pool",
  target: "namespace",
  depends: { database },
  factory: ({ database }) => ({ database }),
});

const { extension: web } = hono([route.get("/database", readDatabase)], {
  ns: (c) => tenants.get(c.req.header("x-tenant") ?? ""),
});
```

Here `readDatabase` is an operation that depends on `pool`.
An unknown tenant uses the default namespace, never another tenant's pool.
Bind `database("public-db")` at the root if the default should answer this route.
See `examples/hono/basic.ts` for a route driven by both tenants and an unknown header.

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
route's operation — so core's spans, clock, and signal come for free.
Hono writes one `http request` line with method, route, path, and status when it answers.
Core writes a separate step line with the operation's label, `ms`, and outcome when its span closes.
An unmapped error writes no `http request` line, but core still logs the failed step.
The session closes gracefully (commit) after the handler; forced (rollback) on client
abort; a `stream` route closes when the body ends. Outside the extension's
middleware, `stream` raises `NoSession`.

`emit` is synchronous, so a `Sync.Transport.send` or any `watch` callback may call it directly; a throw means the client went away (ADR 0021: SSE is an adapter over watched cells).

## Streaming

A route answers with `stream(c, op, call?)`.
The body is a declared operation, not a callback.
It reads `emit` with `depends: { emit: emit.required }`.
The call may carry `input` and `tags` as usual.
The stream binds `emit` for this run.
The body has its own span named by its label.
Its signal, clock, and log remain available after the request span ends.
The session closes when the body finishes or the client cancels.

```ts
import { operation } from "@tinker/core";
import { emit, route, stream } from "@tinker/hono";

const tickBody = operation({
  label: "tickBody",
  input: (raw: unknown) => raw as string[],
  depends: { emit: emit.required },
  run: async ({ emit }, { input, clock, signal }) => {
    for (const t of input) {
      emit(`${t}\n`);
      await clock.sleep(1000, signal);
    }
  },
});

route.get("/ticks", ticks, {
  respond: (ts, c) => stream(c, tickBody, { input: ts }),
});
```

If a test or shutdown leaves a stream open, use plain `await scope.close()` to force
shutdown. The body must respond to `ctx.signal` so it can settle. A graceful close waits
for the body to end and can wait forever for a live stream; choose forced close from the
start, since a later call cannot upgrade an in-progress graceful close.

## Errors

| failure                                                                      | status                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| the operation's `parse` threw (`DataValidationFailed`, raw error as `cause`) | 400                                                  |
| the async body read failed (`InputRejected`, raw error as `cause`)           | 400                                                  |
| request cancelled (abort)                                                    | 499 (logged, then Hono rejects as before)            |
| `MissingTag` / `NoSession`                                                   | 500                                                  |
| anything else                                                                | rethrown to Hono's `onError`, no `http request` line |

`hono(routes, { onError: (e, c) => Response | undefined })` answers first; `undefined`
falls through to the table. A mapped failure settles the request span `ok`.
