# 0140 The protocol lives in each backend

Date: 2026-11-11. Status: accepted as the direction
(Duke, 05:11 to 05:16 UTC); not built.
Changes: where the wire protocol lives (today
`rpc-protocol.ts` in Core).
Governs: the execution id, and every wire change
after this.

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
- 05:16: "\"watch\" is the sense of instant reaction.
  We should be able to do that even with http by
  polling, so, that's how we want to enforce the
  interface".

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
- **SignalR and Socket.IO.** One interface over
  WebSocket, then SSE, then long polling.
- **Kubernetes watch, Consul blocking queries.** A
  long poll the server holds until a change, with the
  last version seen.

## The direction

```text
userland   rpc(...), remoteData(...)
              shape, meaning, the cache
Core SPI   Remote { call, watch }
           Service { addresses, answer, stream }
backend    ws, sse, http, memory
              envelope, codec, frames, ids
```

- Core keeps the meaning: the fault kinds, what
  `call` and `watch` promise, a part's state, and
  when to ask again (0139).
- Each backend owns its wire.
- `watch` is required (today it is optional). It is
  "you will be told of a change". How soon is the
  backend's: plain HTTP polls, on a time or as a
  long poll. Core has one path and no fallback.
- One SPI test kit that every backend runs keeps the
  backends from drifting.
- Core never asks again by itself after a fault. A
  broken link is the backend's to heal; any other
  fault is an answer (ADR 0139, decision 4).
- No formal spec file, and no version at connect:
  "we are the only one developing and building".
  "Each side alone" means our library on both sides,
  at two versions.

## The execution id, at this level

Duke, 04:19: "If you are the trigger, then you'll be
able to observe the executionId and you can resolve
the waiting Promise ... other client will just
receive the update event ... they can just ignore
and proceed". 04:22: he picked "at the protocol
level".

With this record that becomes:

- Core gives each run an id, and lets a run wait
  until a change that carries its id is in its own
  cache.
- Each backend carries the id its own way: a field
  in a ws frame, an `Idempotency-Key` header on HTTP.
- The id is on every fault, as the ref. It works
  with tracing off.

```ts
await move.runAsync({ input });
// resolved: the card on this client shows the move
```

## Open

- **What the id promises.** Read your write and the
  ref (above), or also a safe retry: the server
  keeps recent replies and answers a repeat from
  them. The lead's pick: not the safe retry now.
  TanStack does not retry a mutation by default,
  and rpc's `retry` is off by default too. A backend
  can add it later, as HTTP does with
  `Idempotency-Key`. Duke's to say.

  Duke, 07:02: tell the server's answer from a
  local fault first, "way way before retry". So no
  safe retry now; ADR 0141 takes the split.

- An old page against a new server: each backend
  says what it does (carry on, or close and reload).

## Next, after ADR 0139's list

1. The SPI test kit, run on `memory` and `ws` as
   they are. Built 2026-11-14. It stays in this
   repo (Duke, 15:47, picked "Repo only"):
   `packages/core/tests/kit/backend.ts`. Cases: a
   call and its reply; each server exit (`invalid`,
   `refused`, `failed`, `missing`); a write reaches
   two clients; a keyed part asked again on
   `invalidate`; a server close under a watch is
   `link`; a duplicate address fails the start.
   Not in it yet: a throw in `send` or `open`, which
   needs a backend that can be made to throw.
2. `watch` required; the wire code moves from
   `rpc-protocol.ts` into each backend.
3. The execution id, on the SPI.
