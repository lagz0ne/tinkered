# 0066 A subflow failure belongs to its caller

Date: 2026-09-24. Status: accepted; its receipt tracking is superseded by 0067. Refines: 0017 (failure bubbles inside-out).

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
(ADR 0038, a child session) rejects with the inner error. `@tinker/hono` works around it by
running a stream body as an untagged run on a child session it builds itself. Found by the
nw/hono-stream review.

## Decision

Errors work as in Go (user, 2026-09-24): an error someone receives is a value its receiver
controls; an error nobody receives is a panic. The library must know which one each failure is,
and it records where every failure happened, because observation needs the location either way.

- **Received:** the subflow's result is awaited, or gets a rejection handler (`.catch`, or
  `.then` with a second argument). The error is the receiver's value. If the receiver handles it
  and returns, the layer does not fail and a tagged run resolves. `.finally(f)` and `.then(f)`
  with no rejection handler do not receive the error: they pass it to the promise they return,
  and that promise is tracked the same way.
- **Not received (a panic):** a subflow failure nobody received by the next timer turn after it
  settles fails the layer, like Node's unhandled-rejection rule. This holds whether the caller is
  still running or has already returned. So `const p = sub.run(); await other; await p` is a
  panic when `p` fails first; start both and use `Promise.all` instead. A handler attached after
  that turn still gets the error, and the layer stays failed. A failure that escapes the layer's
  own run (the top of `scope.run`, a session body, a tagged run) fails the layer, as ADR 0017 says.
- **Always located:** every failed subflow keeps its failure on its own span (status `failed`,
  the error), received or not, so a trace shows where each error happened.
- Cancellation stays as it is: a branded cancel reason on an aborted layer is `cancelled`,
  never `failed`.

The precedent: Go's `error` value vs `panic`, and Node's unhandled-rejection rule for how a
runtime knows a promise's failure was received.

## Consequences

- A received subflow failure no longer fails its session or rejects a tagged run.
- A failure nobody receives always fails the layer; none can vanish silently.
- `@tinker/hono`'s stream body could run as a plain tagged run again (a follow-up).
- The span of the failed subflow still closes `failed`: the trace shows what failed even
  when the caller handled it.
