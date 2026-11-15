# 0154 Core keeps the meaning, the backend keeps the bytes

Date: 2026-11-15. Status: accepted by the lead,
under ADR 0140 (Duke, 07:28: "Give me the
thread", to build its steps 2 and 3).
Builds: ADR 0140 steps 2 and 3.
Keeps: ADR 0141 (exits, no safe retry), ADR 0147
(the id ends at the reply), ADR 0153.

## What the user said

- Duke, 2026-11-11 05:11: "The SPI is at the
  core, so, the shape of rpc and remoteData coming
  from core, but it should be helping supporting
  those thing out".
- 05:12: "Protocol should be on those, not on the
  shape of API".
- 05:16: "watch" is "the sense of instant
  reaction ... that's how we want to enforce the
  interface".

## Context

Core's `protocol` resource reads and writes text:

- `callOver` encodes the value, runs the
  backend's `send` with text, decodes the reply.
- `serveText` decodes the text, routes it, and
  encodes the reply.
- So every backend must carry Core's JSON
  envelope as text. An HTTP backend could not use
  a status code, and SSE could not use its own
  frames.

Core with rpc was 35071 B gzip, 1 B under the cap.

## Precedent

- **tRPC links.** One router shape. `wsLink` and
  `httpBatchLink` each own the transformer use
  and the frame.
- **JDBC.** `java.sql` keeps the meaning
  (`SQLException`, its SQL state). Each driver
  keeps its own bytes.
- **OkHttp.** The `Authenticator` (our `renew`)
  sits above the socket, so every connection
  gets the same rule.

## Decision

1. **The SPI is values.** A backend's client
   gives two ops with the shapes of `Call` and
   `Watch`: a value out, a `Reply` back. Core
   never sees text.
2. **Core keeps the meaning.** Its `protocol`
   resource keeps:
   - the route table (ADR 0153);
   - `meta`, and one `renew` at a time;
   - a throw is a bug: `failed` (ADR 0141);
   - an exit is a fault: `lost`;
   - `answer` and `stream` on the server.
3. **The backend keeps the bytes.** The codec,
   the text envelope, the frames and the ids
   leave Core. `ws` in `@tinkered/bun` and
   `memory` each keep their own.
4. **`memory` keeps a codec.** It still turns
   each value to text and back, so a test sees
   what the wire does (a `BigInt`, a `Date`).
5. **`watch` is required.** An rpc `remote` has
   `call` and `watch`. Both backends had both.
6. **The execution id is a field.** `callInput`
   gets `execution`, out of `meta`. A hook's
   `meta` no longer holds it.
7. **Each backend carries the id its own way.**
   `ws` sends it as `m.execution`, as before, so
   the bytes do not change: an open page and a
   new server still agree. `memory` passes it.

```text
rpc, remoteData   values, the cache
Core protocol     routes, meta, renew,
                  faults, answer, stream
backend           codec, envelope, frames
```

## Why not the other lines

- **Core keeps types only.** Each backend writes
  routes and renew again. They would drift; Duke
  asked Core to help.
- **A text package beside Core.** `memory` lives
  in Core's testing entry and cannot import it.
  One text backend today; a second (SSE) can
  share code when it comes.

## Cost

- The codec steps are in two places: `memory`
  and `ws`. About 30 lines each. The backend kit
  runs on both, so they do not drift.
- `@tinkered/bun` needs the new Core: one
  release of both.

## Proof

- `packages/core/tests/kit/backend.ts` on
  `memory` and `ws`.
- `packages/core/tests/execution-id.test.ts`,
  `packages/bun/tests/execution-id.test.ts`.
