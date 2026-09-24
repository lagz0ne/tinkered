# 0066 A subflow failure belongs to its caller

Date: 2026-09-24. Status: accepted. Refines: 0017 (failure bubbles inside-out).

## Context

ADR 0017 says a thrown error "from the body (or owned work)" fails the boundary. Core counts
every async operation run on a layer as owned work of that layer: its rejection becomes the
layer's failure (`asPrimary`). A subflow the caller awaits and catches is counted too:

```ts
run: async ({ sub }) => {
  try {
    await sub.run({});
  } catch {}
  return "caught";
};
```

A session running `outer` closes `failed` although `outer` returned. A tagged run
(ADR 0038, a child session) rejects with the inner error. `@tinker/hono` had to add a fake
failure step to the stream body to keep its trace readable. Found by the nw/hono-stream review.

## Decision

A subflow is a function call (the precedent: an exception thrown by a called function goes to
its caller, which may catch it; structured concurrency keeps the same rule for an awaited call).

- A subflow's failure goes to the run that called it. If the caller catches it and returns,
  the layer does not fail.
- A failure that escapes a layer's own run (the top of `scope.run`, a session body, a tagged
  run) fails that layer, as ADR 0017 says.
- Work nobody awaits is still owned work: a subflow that settles failed after its caller has
  already settled, with no one left to receive it, fails the layer.
- Cancellation stays as it is: a branded cancel reason on an aborted layer is `cancelled`,
  never `failed`.

## Consequences

- A caught subflow no longer fails its session or rejects a tagged run.
- `@tinker/hono`'s stream body can drop its workaround.
- The span of the failed subflow still closes `failed`: the trace shows what failed even
  when the caller handled it.
