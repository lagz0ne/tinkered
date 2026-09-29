# 0082 Dev keeps one process and an edit rebuilds the scope; only dev and tests bind defaults

Date: 2026-09-29. Status: accepted. Builds on: 0028 (close is a shutdown mode), 0060 (an
integration is an extension the scope owns), 0077 (glue lives in its home package), 0081 (a piece
checks its config at `start`). Research: `docs/roadmap/stack-v1/RESEARCH.md`, round 5.

## Context

Restarting the process on each server edit costs about 2 s before migrations. PGlite opens from
disk in 749 ms, and Vite's `createServer` takes 1,258 ms (bench queue, median of 10). Vite's
module runner can re-import the server code in the running process, but it closes nothing the old
code opened.

**The precedent is Rails,** which reloads code in the running process and keeps its database
pool. React Router 8 and TanStack Start also keep one process and re-import server code through
the runner.

Defaults are the other half. ADR 0081 makes a missing key stop boot, yet dev and tests must run
with no config. If a piece picked defaults from `NODE_ENV`, a prod box with `NODE_ENV` unset
would boot and log its mail instead of sending it.

## Decision

1. **`vp run dev` runs one process, the dev host.** It keeps PGlite, `nats-server`, and Vite open
   for the whole session.
2. **An edit rebuilds the scope, not the process.** Vite's runner re-imports the app. The dev
   host closes the old scope gracefully (ADR 0028) and starts a new one with the kept handles. The
   HTTP listener stays; each request goes to the current scope.
3. **A test proves each reload closes the old scope** and leaks nothing, since Vite closes nothing
   for us.
4. **Only the dev host and the test helper bind defaults:** log mail in dev; mock mail and a
   cloned PGlite in tests. Prod gets none, so a missing key always stops boot.
5. **The dev host and the test helper live in the stack.** They span pieces (ADR 0077).

## Consequences

- A piece that owns a long-lived handle (the database, the NATS connection) must also accept one
  handed in, so dev can keep it across scopes. In prod the piece opens its own.
- Each reload ends the tabs' SSE streams. The browser reconnects on its own.
- The dev host stops the old scope the way ADR 0078 does: it aborts the root's `stop` signal and
  awaits the exit code. It never holds the scope.
- ADR 0078's `runServer(env, stop)` has no way to take the kept handles, and in 0078 the serving
  extension opens the port. In dev the listener belongs to the dev host. The dev host ticket
  settles how the root takes both.
