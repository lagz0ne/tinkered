# 0140 The protocol lives in each backend

Date: 2026-11-11. Status: direction from Duke; the
design is not done; not built.
Changes: where the wire protocol lives (today
`rpc-protocol.ts` in Core).
Governs: the execution id (0139 open), and every
wire change after this.

## What the user said

In the issue board thread:

- 05:08: "the goal is the library can be used on
  each side independently ... and the protocol must
  be solid to make sure it works as such for long".
- 05:11: "don't too much worry about that, we are
  the only one developing and building. thing is,
  those protocol can be separated package. The SPI
  is at the core, so, the shape of rpc and
  remoteData coming from core, but it should be
  helping supporting those thing out, what do you
  think?"
- 05:12: "remoteData and rpc should be userland
  interface. The authoring, for example I'll use SSE
  as backend, or websocket as backend, or even pure
  http as backend should be up to the library
  providing such, and those will implement the SPI.
  Protocol should be on those, not on the shape of
  API".

## Context

Today Core holds one protocol that every transport
carries:

- `rpc-protocol.ts`: the envelope, the codec, the
  `traceparent` meta.
- `rpc-wire.ts`: the fault kinds, the `Service`
  shape (`addresses`, `answer`, `stream`).
- `rpc.ts`: the `Remote` shape (`call`, `watch`).
- `@tinker/bun` `ws.ts` and Core `memory.ts` frame
  that one protocol.

## Precedent

- **TanStack Query.** The library owns the cache and
  the query state. The `queryFn` is any fetch: REST,
  GraphQL, or a socket. The protocol is not its own.
- **tRPC links.** One router shape. `httpBatchLink`,
  `wsLink` and `httpSubscriptionLink` (SSE) each own
  their wire.
- **SLF4J and JDBC.** One SPI; each binding or
  driver owns its protocol.

## The direction

```text
userland   rpc(...), remoteData(...)
              shape, meaning, the cache
Core SPI   Remote { call, watch? }
           Service { addresses, answer, stream }
backend    ws, sse, http, memory
              envelope, codec, frames, ids
```

- Core keeps the meaning: the fault kinds, what
  `call` and `watch` promise, a part's state, and
  when to ask again (0139).
- Each backend owns its wire. A backend with no push
  (plain HTTP) is a full backend: it asks again on
  a trigger and after a time (0139 decision 3).
- One SPI test kit that every backend runs keeps the
  backends from drifting.
- No formal spec file: "we are the only one
  developing and building". The case that stays is
  an old page against a new server.

## Open

- Which parts of `rpc-protocol.ts` move to the
  backends, and which stay as the SPI's meaning.
- The execution id at this level: Core gives a run
  its id and lets a run wait for it; each backend
  carries it its own way (a frame field on ws, an
  `Idempotency-Key` header on HTTP).
- The keyed reader with no `watch` is not tested.
