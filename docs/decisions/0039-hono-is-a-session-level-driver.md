# 0039 Hono is a session-level driver: a middleware opens the request session, routes are declarations

Date: 2026-09-17. Status: accepted. Refines: 0034 (tiers: driver), 0030/0031 (the React adapter's
ownership rules), 0038 (tags at the session level), 0028 (close modes).

## Context

The first **driver** (ADR 0034: owns work → sessions) is the Hono server integration. Two
principles shape it. The **scope is created and closed at one entrypoint** (`main`, or a test),
never inside a library, and never passed through userland: handlers declare operations, they do
not carry a handle. And a **request is a session** — Effect's `HttpServer` runs each request in
its own fiber with request-scoped context; ours opens a session bound with request-derived tags
and closes it when the response is produced.

The React adapter already draws these lines (ADR 0030/0031): `ScopeProvider` receives or creates
the scope at the app root, `SessionProvider` opens sessions, and components never receive the
handle. Hono gets the same shape with Hono's own vocabulary: a middleware and route handlers.

## Decision

`@tinker/hono` (`packages/hono`, `hono` as a peer dependency) ships three things and stays at
the session level. It never creates a scope.

```text
main.ts (entrypoint)   scope = createScope(opts); app.use(tinker(scope, { tags? })); …; scope.close({ graceful })
tinker(scope, opts?)   middleware: one session per request, bound with [request(raw), ...opts.tags(c)];
                       client abort (raw.signal) → forced close; after next() → close (forced)
handle(op, opts?)      a Hono handler: runs `op` in the request session with rawInput = opts.input(c),
                       answers opts.respond(value, c) (default c.json(value)); no session → NoSession
request                a tag carrying the web Request for the rare operation that needs headers
```

- **The middleware is the only place the scope is passed.** It receives the entrypoint's handle
  and opens sessions; it leaves the session on the Hono context under a module-private key that
  `handle` reads. Nothing public exposes the session handle to userland.
- **Routes are declarations.** `handle(op, { input?, respond? })` names the two edges a route has:
  `input: (c) => unknown` reads the raw input off the request (parsed by the operation's own
  `input` parse, ADR 0006 — the edge is the operation's), `respond: (value, c) => Response`
  answers (default `c.json(value)`). `input` is required at the type level when the operation has
  an input; a void operation needs neither. An operation throwing reaches Hono's `onError`
  unchanged — no status mapping in v1.
- **Request-derived tags** come from one slot, `tags: (c) => Tag.Binding[]`, bound on the
  session (so every operation, subflow, and session-target resource in the request sees them —
  ADR 0038's reach) beside the built-in `request(raw)` binding.
- **Lifetime = ADR 0028.** A client abort force-closes the session: in-flight operations settle
  `cancelled`. After the handler returns, the session closes (forced; v1 has no work outliving
  the response — streaming bodies are a later ticket). `scope.close({ graceful: true })` at the
  entrypoint waits for in-flight request sessions; forced cancels them.
- **Tests are entrypoints.** A test builds `createScope({ presets, tags })`, mounts
  `tinker(scope)` and the routes on a `Hono`, and calls Hono's `app.request(...)`. No server, no
  mocks; the edges are preset or bound (a fake `backend` for outbound http).
- **No spans from the driver in v1.** The operation's span is the request's; a request id travels
  as a tag. A driver-opened span could not parent the operation's span without a core primitive
  (a separate decision).

```ts
export declare namespace HonoScope {
  type Options = { readonly tags?: (c: Context) => readonly Tag.Binding<unknown>[] };
  type Route<I, T> = {
    readonly input?: (c: Context) => unknown; // required when I is not void
    readonly respond?: (value: Awaited<T>, c: Context) => Response | Promise<Response>;
  };
}
export const request: Tag.Handle<Request>;
export function tinker(scope: Scope.Handle, options?: HonoScope.Options): MiddlewareHandler;
export function handle<T, I>(op: Operation.Handle<T, I>, route?: HonoScope.Route<I, T>): Handler;
// errors.ts: NoSession { label }  — handle() used without tinker() upstream
```

## Consequences

- Userland never holds a scope or session handle; the entrypoint holds the scope, the middleware
  holds the session. Same rule as React.
- Composing with a plain Hono app is free: `tinker` is a normal middleware and `handle` a normal
  handler, so cors/logger/static middleware and non-tinker routes mix in.
- A route's input validation lives in the operation (`input: parse`), not in the route: the same
  operation serves a CLI or a job unchanged.

## Alternatives rejected

- **A driver that creates its own scope** (`honoApp({ routes }).create(scopeOptions)`) — moves scope
  ownership out of the entrypoint; two drivers in one process could not share a scope; tests would
  configure through a wrapper instead of `createScope`.
- **Exposing the session as `c.var.scope`** and letting handlers call `run` — a handle in userland;
  every route repeats `c.json(await c.var.scope.run(op, { rawInput }))`.
- **A `context` tag with Hono's `Context`** — ties every operation to the framework; the raw
  `Request` plus parsed `input` covers the need.
