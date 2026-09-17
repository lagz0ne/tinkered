# 0040 A server request is an inline operation: spans, one log line, error mapping, streaming lifetime

Date: 2026-09-17. Status: accepted. Refines: 0039 (Hono driver), 0037 (inline operations),
0038 (session per tagged call), 0009 (observation is behaviour-neutral), 0028 (close modes).

## Context

A first-class integration must use core's observation and logging, not sit beside them. ADR 0039
deferred the per-request span because a driver has no ctx at middleware level. Effect's server has
three behaviours ours lacked: a request span every handler span nests under (`HttpApp.toHandled`
wraps each request in a tracer span), failures mapped to responses inside the request
(`ServerError.causeResponse`), and a request scope that outlives the response when the body
streams (`unsafeEjectStreamScope`). All three matter for a server.

The missing ctx is solved by an existing primitive: **the request is an inline operation** (ADR 0037) whose one dependency is the route's operation. The route op is then a subflow (ADR 0020),
its span nests under the request span, and `ctx.log`, `ctx.clock`, `ctx.signal`, and `ctx.obs`
are simply the request op's ctx.

## Decision

```text
handle(op, { input?, respond? })  →  in the request session:
session.run({ label: "GET /users/:id", depends: { op }, run })
  ├── span  "GET /users/:id"  kind operation; attributes method, route, path, status
  ├── value = op.run({ rawInput: input(c) })          subflow → its span nests under the request span
  ├── response = respond(value, c)                    default c.json(value)
  ├── ctx.log("http request", { method, route, path, status, ms })   ms from ctx.clock; one line
  └── return response                                 the inline op delivers the Response
```

1. **Observation + logging.** The request span is the inline op's span (label = method + route
   pattern; attributes `method`, `route`, `path`, then `status` once known). Exactly one log line
   per request, written inside the run, carrying that span. With observation off nothing is
   recorded and no attribute is written (`ctx.obs.span` is undefined). Behaviour-neutral (ADR
   0009): the Response object is the one `respond` made.
2. **Error mapping, inside the request op** (Effect's `causeResponse` shape) with a fixed default
   and one slot: `tinker(scope, { onError?: (error, c) => Response | undefined })` runs first
   and may answer; otherwise the default map answers: the operation's `parse` failure
   (`DataValidationFailed`) → **400**; the request's own cancellation (`cancelled` — client abort or
   forced close) → **499** client closed request; `MissingTag` / `NoSession` → **500**; anything
   else rethrows to Hono's `onError`. A mapped failure is a HANDLED request: the request span
   settles `ok` with the mapped `status` attribute and the log line carries it (Effect's shape —
   `toHandled` succeeds once a response exists); the operation's own span settled `failed`
   already, so the failure is still visible where it happened. Only an unmapped error leaves the
   request span `failed`.
3. **Streaming lifetime, explicit.** A route that streams uses `stream(c, (write) => …)` from
   `@tinker/hono`: it builds the streaming Response and keeps the request session open until the
   body finishes or the client cancels, then closes it. Every other response closes the session
   right after `next()` (ADR 0039). No generic body sniffing: `c.json` bodies are streams too, and
   a session that outlives its request is a decision the route makes in the open.

## Consequences

- The driver uses core's spans, log, clock, and signal through an ordinary ctx; nothing new in
  core. One inline handle + one session per request is the cost (ADR 0037/0038 budgets).
- `tinker` alone (routes not made with `handle`) still opens the session but records no span; a
  plain Hono handler is outside the graph by choice.
- Status codes in the default map are facts about the failure, not policy; policy goes in
  `onError`.
- Tickets: hono/t01 (session + `handle` as an inline op with span + log), hono/t02 (error
  mapping + `onError`), hono/t03 (`stream`), hono/t04 (validation milestone).

## Alternatives rejected

- **A core primitive for driver-opened spans** — unnecessary once the request is an inline op.
- **Mapping errors in Hono's `onError` only** — the request span would settle without its status
  and the log line would miss it.
- **Sniffing streaming bodies after `next()`** — taxes every response and guesses.
