# 0104 A layer tells its resources when closing begins

Date: 2026-10-05. Status: accepted (lead, from four Core feedback rows; the user asked for the card).
Refines: 0028, 0085, 0100. Card: `core/close-hook-scope`.

## Context

A graceful close waits for running work, then runs resource cleanup.
A resource that owns a wait with no end — an outgoing HTTP request,
a NATS subscription, a sync stream — cannot end that wait, because its
`ctx.defer` and `ctx.signal` only fire after the drain. So the close hangs.

Four callers worked around it:

- sync/subscribe keeps its own `closing` flag set from a close hook;
- stack/t07 (NATS) replaced Core's `scope.close` on its handle;
- `trial/services-http` aborts from a close hook before `event.next()`;
- `start/http-graceful` stops HTTP through scaffold stop tags, and still
  waits when a graceful close is called directly with no stop signal.

## Precedent

Go's `http.Server.Shutdown`: it stops accepting work, runs the functions
registered with `RegisterOnShutdown`, then waits for active connections.
The registered functions end what the wait cannot end on its own
(hijacked and upgraded connections).

Where we are simpler: one read-only signal, not a callback list.

## Decision

Each layer (root scope or session) has a closing signal.
It aborts the moment that layer begins to close, graceful or forced,
before Core waits for running work.
A child layer's closing signal also aborts when its parent's does.

- Resource factories read it as `ctx.closing`.
- Extension hooks read it as `event.closing`; the `close` hook event also
  carries the layer (`event.scope`), as the card asks.
- `ctx.signal` and `ctx.defer` keep their meaning: they fire at cleanup,
  after the drain. A database pool stays usable while running work drains.

```ts
const http = resource({
  depends: { send: httpBackend },
  factory: ({ send }, { closing, defer }) => {
    const inFlight = new Set<AbortController>();
    const stopAll = () => inFlight.forEach((c) => c.abort());
    closing.addEventListener("abort", stopAll, { once: true });
    defer(() => closing.removeEventListener("abort", stopAll));
    return {/* send with AbortSignal.any([...]) */};
  },
});
```

Also from ADR 0085: a root's close hooks run once, cannot skip cleanup or
replace its outcome, and a hook's throw becomes a teardown error that
`closed` counts.

## Consequences

- The four workarounds can go; each is a follow-up in its own package.
- Graceful close keeps POSIX meaning: work finishes, but waits a resource
  owns can be ended early by that resource.
- One more signal per layer; created on first read, so layers that never
  read it pay nothing.
