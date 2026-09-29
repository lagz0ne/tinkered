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
install it, resolve it — a second call is a different identity.

A root extension that reads a server in `start` goes before it:
`[warmOne, one, warmTwo, two]`.
Here `warmOne` is a root extension that reads `one` in `start`.
Pass `name` in the wiring to label the extension `hono:<name>`.
A root listed after `two` then fails `ready` with
`NotResolved {"label":"hono:two"}`.

Two servers on one scope:

- Both share a `target: "scope"` resource: a write through one
  is the other's next read.
- Each request opens its own session: a cell written through one
  server stays out of the other.
- A path mounted on both servers answers from the server that
  got the request.
- A second close runs neither server's stop again.

Each `serve` bind stops on `scope.close()` through the extension onion, so one
close reaps both listeners.
A bind returning a closer object calls `close` on scope close.
Without a `serve` bind, the scope still closes successfully.

## Hand mounting

`mount` stays for routes that need `stream` directly and cannot be rows yet:
`hono(rows, { mount: (app) => { … } })` runs after the rows, inside the same
session middleware, so `stream` sees the request session.

An app built from flat rows answers two verbs.
Routes take nested lists and false: every reachable row is mounted.
Every loader runs once at start and none runs at request time.
Input is required at the type level when the operation takes one.
A void op answers its value as JSON by default, or as text with `respond`.
A request-derived tag shadows the scope binding and the op sees the request URL.

A rejected body read tells `onError` which operation and cause failed.
A `null` input reaches the operation without a body-read error.

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

A `route.put` row answers PUT requests, not GET requests.
A `route.patch` row answers PATCH requests, not GET requests.
A `route.delete` row answers DELETE requests, not GET requests.

Each request runs as an inline operation (`"GET /users/:id"`) whose one dependency is the
route's operation — so core's spans, clock, and signal come for free.
Hono writes one `http request` line with method, route, path, and status when it answers.
Core writes a separate step line with the operation's label, `ms`, and outcome when its span closes.
An unmapped error writes no `http request` line, but core still logs the failed step.
A throwing route op settles the request span failed and reaches Hono's `onError`.
With observation off no span is recorded and the request still answers.
The request session closes before its answer leaves (ADR 0084).
A successful route commits before the caller receives the answer.
A plain row on the same app still commits right after the handler.
A route that raises any error rolls back, including a mapped 4xx.
Client abort force-closes the session and rolls back.
A `stream` route closes when the body ends. Outside the extension's
middleware, `stream` raises `NoSession`.
An already-aborted request closes cancelled without running its route.
It answers 499.

`emit` is synchronous, so a `Sync.Transport.send` or any `watch` callback may call it directly; a throw means the client went away (ADR 0021: SSE is an adapter over watched cells).

## Streaming

A route answers with `stream(c, op, call?)`.
The body is a declared operation, not a callback.
It reads `emit` with `depends: { emit: emit.required }`.
The call may carry `input` and `tags` as usual.
The stream binds `emit` for this run.
The body yields each chunk as the clock advances, then ends.
`emit` sends byte chunks unchanged to the reader.
A stream call's `ns` picks the body run's namespace bindings.
The body runs in its own child session, as a tagged call does (ADR 0038).
A session-target resource the body reads is a new instance.
It is not the instance the route operation read.
Both sessions end when the request ends.
The body has its own span named by its label.
Its signal, clock, and log remain available after the request span ends.
The session closes when the body finishes or the client cancels.
A synchronous stream body failure releases the body and request resources.
A session resource's defer runs only after the last chunk was read.
Cancelling the reader mid-body force-closes the session and stops the writer.
A body may settle a failing subflow and still finish its stream without a reader error.
An explicit content-type, such as `text/event-stream`, stays unchanged.
Without one, `stream` sets `text/plain; charset=UTF-8`.

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

- An operation's parse failure (`DataValidationFailed`): 400.
- A rejected body read (`InputRejected`): 400.
- A client abort: logs 499, then Hono rejects as before.
- A `MissingTag` or `NoSession`: 500.
- Anything else reaches Hono's last error handler.
  It answers `internal`, status 500, and writes one
  `request failed` line through the scope's observe sink.
  `mount` may replace this handler with `app.onError`.

A missing required tag answers `internal` in the response body.
A missing required tag answers 500 with the request span ok.
The request session commits on success and rolls back on abort or a raised error.

`hono(routes, { onError: (e, c) => Response | undefined })` answers first; `undefined`
falls through to the table. A mapped failure settles the request span `ok`.
`onError` answers first: a parse failure becomes 418 while `MissingTag` keeps 500.

The route runs its operation through `settle`.
A failure `onError` answers, a panic included, closes the request session `failed`.
An operation that finishes after a client abort still answers its value and logs 200.

### Error tables

`errorResponses(table)` builds an `onError` hook.
Each key is a managed error's `kind`.
It accepts both package registry errors and `ctx.raise`.
The payload types belong to the app's error registry.
Unlisted kinds fall through to the default handling.

```ts
import { errorResponses, hono } from "@tinker/hono";

type Failures = {
  IssueNotFound: { id: string };
  IssueConflict: { id: string; revision: number };
  BadInput: { reason: string };
};

const { extension: web } = hono(issueRoutes, {
  onError: errorResponses<Failures>({
    IssueNotFound: 404,
    IssueConflict: {
      status: 409,
      body: (payload) => ({
        message: "reload",
        id: payload.id,
        revision: payload.revision,
      }),
    },
    BadInput: {
      status: 400,
      body: (payload) => payload.reason,
    },
  }),
});
```

- A status-only error row answers a raised kind with an empty body.
- An error body builder reads a registry payload and answers JSON.
- An error table can answer a core parse error with text from its payload.
  A string body has `text/plain; charset=UTF-8`.
  Any other JSON value has `application/json`.
- An unlisted managed error answers 500 and writes one
  `request failed` line to the scope sink.
  The line includes the method, path, error name, message,
  kind, payload, and stack when present.
- A hand-mounted panic answers 500 and logs its cause through the scope sink.
  Error causes keep their details; other causes become text.
- An `HTTPException` keeps its status, body, and headers
  without a `request failed` line.

### Commit and rollback

- A failed commit answers 500, logs one line, and saves nothing.
  Any teardown error or unexpected failed close replaces the built answer
  with `internal` and writes one `request failed` line through the scope sink.
- A save followed by a mapped 409 rolls back and keeps the mapped answer.
- A save followed by an unmapped error answers 500 and rolls back.
- A successful save commits before its answer arrives.
  Its status, body, and headers stay unchanged.
- A stream whose commit fails errors its body and logs one line.
  Its headers have already left, so its status stays unchanged.
  The reader sees the close failure before the stream can finish cleanly.
  Its `RequestCloseFailed` error carries the close result in `payload.result`.

- A failed session hook replaces the built answer with 500 and one failure line.
- A teardown error replaces a mapped answer with 500 and one failure line.
  Even an `HTTPException` in teardown counts as a close failure.
- A synchronous stream error keeps its 500 and closes its request session failed.

A request after scope close reaches Hono's error handler.
This lets a late browser reconnect finish while the server stops.

A stream body can answer a forced shutdown with a final chunk.
A cancelled close without teardown errors keeps that final body.

## Trace ids

- A valid traceparent joins the request spans to the remote parent.
- A malformed or absent traceparent starts a new trace and still answers.
- A future traceparent version keeps its known ids and sampled bit.

The header reader follows [W3C Trace Context](https://www.w3.org/TR/trace-context/).
Unknown flag bits and future fields are ignored.
This driver does not carry `tracestate`.
