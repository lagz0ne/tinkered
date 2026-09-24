# 0060 An integration is an extension the scope owns, not a wrapper that owns the scope

Date: 2026-09-22. Status: accepted (2026-09-24, tags `http/t07`, `hono/ext`). Builds on: 0051 (the session onion), 0056 (process is tags,
routing is outside the scope), the extension model. Pairs with 0059 (namespace) as the other half of
"no wrapper again".

## Context

A wrapper takes the scope: `hono(scope, wiring)`, `shell(scope)`. The server owns the scope, so its
lifecycle drives the scope's, and a second server cannot exist -- two things cannot each own one
scope. The integration also dictates the shape: you speak the wrapper's vocabulary, not the target's.

An extension is the inverse. Its `start(scope, ctx, next)` receives the scope handle at boot -- the
integration reaches back for the scope (pull), the scope is not handed in (push). The scope stands
alone as the one root; each integration joins as an extension beside `clock`, beside any capability.

**The analogy** is a Unix daemon under an init system. The daemon does not own the machine; the init
owns the daemon, hands it a socket, and reaps it on shutdown. `createScope({ extensions })` is init;
`start`'s `next()` onion binds the listener after inner extensions are ready and `ctx.defer` stops it
on `scope.close()`. Systemd runs many daemons on one machine; one scope runs many integrations.

## Decision

1. **An integration bridges through an extension; it never takes the scope.** The server, the CLI, the
   MCP host is authored as a value that carries a route table (or a command table, or a tool set) plus
   a bridge extension. `start` pulls the scope, binds the target (a port, `argv`, a stdio channel),
   and each inbound event opens a session and runs the matched operation. The integration speaks its
   target's language (routes, commands, tools) and translates to operations; it does not enforce a
   lifecycle -- the extension onion does.
2. **The scope is the one root; integrations compose as a list.** `createScope({ extensions: [clock,
appServer, adminServer] })`. Because the scope owns the extensions rather than the reverse, a
   single process runs two servers on two ports, an app server beside an admin server, or several MCP
   servers -- each its own bridge, all sharing one scope. A probe ran two servers on one scope: each
   its own routes, shared state visible to both, `scope.close()` tearing down both through the onion.
3. **Shared state is a scope-target resource; request state is a session cell.** Cell writes flow down
   a layer, never up (a per-request session's cell write vanishes on close), so a value both servers
   accumulate -- an audit log, a connection pool -- is a `target: "scope"` resource that requests
   mutate; per-request state is a cell or tag on the request's session, isolated by construction. A
   probe caught the mistake: an audit log kept as a cell read empty until it became a scope resource.
4. **Lifecycle is the extension protocol, not hand-work.** `start` returns after `next()` so listeners
   bind inside-out; `ctx.defer` registers teardown; `close` unwinds it. The integration writes none of
   this -- it binds in `start`, defers its stop, and the onion does the ordering (ADR 0051).

## As built

- hono, mcp, and sync are extensions the scope owns; process builds one root per command (ADR 0056), not a bridge extension.

## Consequences

- `@tinker/hono` flips from `hono(scope, wiring)` (takes scope) to `hono(routes)` (returns an
  extension). The route table, match loop, and `answerRoute` are unchanged; one signature moves. The
  same shape gives express and fastify adapters, and `@tinker/process` a CLI bridge (argv in, exit
  code out) that no longer needs `main(scope)` to own the run.
- Dual servers, admin ports, and many MCP servers in one process become ordinary, not special.
- With 0059, every integration -- http client, llm, agent, server, CLI -- is either a declared unit or
  an extension the scope owns. Nothing is a wrapper that owns the scope. That is "no wrapper again"
  stated in full.

## Alternatives rejected

- **Keep `hono(scope)`** -- the wrapper owns the scope, so a second server is impossible and the
  integration dictates the shape. The probe showed the extension form runs two servers on one scope.
- **A shared cell for cross-request state** -- writes flow down, so per-request sessions never
  accumulate into it; the scope-target resource is the one primitive that shares (proven).
- **A bespoke multi-server host** -- a new concept for something the extension list already is; N
  bridges on one scope needs no new surface.
