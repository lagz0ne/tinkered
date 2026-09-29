# 0077 Glue lives in its home package; sync ships the SSE transport

Date: 2026-09-29. Status: accepted. Replaces in part: 0048 (the transport is userland's), 0074 §1
(the stack holds the sync wire). Research: `docs/roadmap/stack-v1/RESEARCH.md`, round 3.

## Context

ADR 0048 left the wire to userland and shipped only `memoryPair()`. The same SSE wire is now
written twice: `examples/sync/hono.ts`, and the issue tracker's `src/server/sync.ts` with its
browser half in `src/client/connection.ts`. ADR 0074 would put a third copy in the stack. A sync
user who skips the stack would still write their own.

**The precedent is the MCP SDK,** which 0048 already copied for its `Transport`. The SDK ships
its stdio and HTTP transports next to its in-memory pair, and any object of the same shape still
plugs in.

## Decision

1. **Glue that belongs to one package lives in that package.** The stack keeps only what spans
   packages: the server start and shutdown, the log and trace sink, the browser boot.
2. **`@tinker/sync/sse` ships the SSE transport:** SSE down and POST up, both halves.
3. **The protocol and the plug do not change.** `Sync.Message` stays `register` and `snapshot`.
   `Sync.Transport` stays `{ send, onMessage, onClose, close }`. `memoryPair()` stays the test
   seam. A WebSocket or NATS transport still plugs in.
4. **The server half takes a plain `(chunk) => void` writer,** the shape of Hono's `emit`. So
   `@tinker/sync` does not import `@tinker/hono`.
5. **The stack uses SSE by default.**

## Consequences

- The example and the issue tracker drop their own SSE code for the shipped one.
- Other glue (the error answer, migrations) is placed by the same rule when its ticket lands.
