# 0165 Settled is the twin of ready

Date: 2026-11-21. Status: accepted (Duke,
2026-11-21 08:26 UTC).
Amends: ADR 0134 decision 2 (which cause `ready`
reports).
Fixes: bug 3 in
[scope-life](../states/scope-life/README.md)
(card `core/stop-signal-then-later-event`).

## Precedent

- Core's own `run` and `settle`: `run` throws,
  `settle` gives a union of the outcomes.
- Zod: `parse` throws, `safeParse` gives
  `{ success, data }` or `{ success, error }`.
- `Promise.allSettled`: each result is a union,
  and the promise never rejects.
- Core's `closed` already never rejects
  (ADR 0085).

Tinker keeps the same pair for a start:
`ready` throws, `settled` gives the union.

## Context

A start can end several ways at once:

- the stop signal fires;
- a start hook throws;
- the start times out;
- the app calls `close()`.

ADR 0134 d2 does not say which cause `ready`
reports when two come.
Today the last event wins (bug 3).
So a stop signal, then a hook's throw, rejects
`ready` with the throw, and `closed` is `failed`,
not `cancelled`.

A caller that wants the outcome, not a throw,
has no tool for it.
`scope.settled()` is taken: it waits until the
scope's in-flight work ends.

## Decision

1. **`settled` is a promise, the twin of `ready`.**
   - `scope.settled` is a property, as `ready` is.
   - It never rejects.
   - It resolves to one of:
     - `{ status: "success", handle }`;
     - `{ status: "cancelled", reason }`;
     - `{ status: "failed", error }`.
   - `handle` is what `ready` resolves to.
2. **The first cause wins.**
   - The first event that ends the start is its
     cause: a stop signal, a start hook's throw,
     a start timeout, or a `close()`.
   - `ready` rejects with that cause.
     `settled` names the same cause.
   - A later error is dropped.
     There is no list of causes.
   - This amends ADR 0134 d2. Its "a start error
     that comes first still wins" now holds for
     every cause, in both orders.
   - `closed` names the same first cause
     (Duke, 2026-11-21 14:58 UTC).
     A `close()` first, then a start error:
     `settled` and `closed` are both `cancelled`.
     A graceful close stays `success` (ADR 0028).
     The later error is not in `teardownErrors`:
     it is a start error, not a cleanup throw
     (ADR 0027), and a later error is dropped.
3. **The old `settled()` is now `idle()`.**
   - `handle.idle()` waits until the scope's
     in-flight work ends, as `settled()` did.
   - Same behavior, new name.
   - Core's tests, skills and docs use the new name.

## Chart

The [scope-life](../states/scope-life/README.md)
spec on main: each red state is bug 3,
a stop signal and then a later event that wins.

```mermaid
---
title: "A root with a stop signal and two capsules that listen after next()"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: starting
    lg1: open
    lg2: closing
    lg3: closed
    lg4: Breaks FirstCauseRejectsReady or LaterErrorDropped or SettledNamesFirstCause or SignalClosedCancelled or SignalForcesClose
    lg5: Path to the FirstCauseRejectsReady or LaterErrorDropped or SettledNamesFirstCause or SignalClosedCancelled or SignalForcesClose bug
  }
  class lg0 blue
  class lg1 teal
  class lg2 yellow
  class lg3 tan
  class lg4 breaks
  class lg5 bugPath
  s0: Not started
  s1: Not started, signal already aborted
  s2: Starting
  s3: Closing, forced
  s4: Closing, graceful
  s5: Stop signal fired, a start hook still runs
  s6: Ready, both ports open
  s7: Closed: cancelled
  s8: Closed: success
  s9: Closed: failed
  s10: Closed: cancelled, ready rejected with the closing reason, after the stop signal
  s11: Closed: success, ready rejected with the closing reason, after the stop signal
  s12: Closed: failed, ready rejected with the start error, after the stop signal
  s13: Closed: failed, ready rejected with StartTimeout, after the stop signal
  s14: Closed: failed, ready rejected with the closing reason, after the stop signal
  [*] --> s0
  [*] --> s1
  s0 --> s2: the scope starts
  s1 --> s3: the scope starts, no hook runs
  s2 --> s3: the app calls close() or a start hook throws or the start times out
  s2 --> s4: the app calls close({ graceful })
  s2 --> s5: the stop signal fires
  s2 --> s6: capsule 2 calls next(), both listen
  s5 --> s3: the app calls close() or the start times out or a hook calls next(), it rejects or a start hook throws
  s5 --> s4: the app calls close({ graceful })
  s3 --> s7: the close hooks ran, the scope closes
  s4 --> s4: a close hook runs
  s3 --> s3: a close hook runs
  s6 --> s3: the app calls close()
  s6 --> s4: the app calls close({ graceful }) or the stop signal fires
  s4 --> s8: the close hooks ran, the scope closes
  s3 --> s9: the close hooks ran, the scope closes
  s4 --> s9: the close hooks ran, the scope closes
  s3 --> s10: the close hooks ran, the scope closes
  s4 --> s11: the close hooks ran, the scope closes
  s3 --> s13: the close hooks ran, the scope closes
  s3 --> s12: the close hooks ran, the scope closes
  s3 --> s14: the close hooks ran, the scope closes
  s4 --> s14: the close hooks ran, the scope closes
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 blue
  class s0 bugPath
  class s1 blue
  class s2 blue
  class s2 bugPath
  class s3 yellow
  class s3 bugPath
  class s4 yellow
  class s4 bugPath
  class s5 blue
  class s5 bugPath
  class s6 teal
  class s7 tan
  class s8 tan
  class s9 tan
  class s10 tan
  class s10 breaks
  class s11 tan
  class s11 breaks
  class s11 bugPath
  class s12 tan
  class s12 breaks
  class s12 bugPath
  class s13 tan
  class s13 breaks
  class s14 tan
  class s14 breaks
```

After the fix, every event after the stop signal
leads to the forced close, and no red state is left:

```mermaid
---
title: "A root with a stop signal and two capsules that listen after next()"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: starting
    lg1: open
    lg2: closing
    lg3: closed
  }
  class lg0 blue
  class lg1 teal
  class lg2 yellow
  class lg3 tan
  s0: Not started
  s1: Not started, signal already aborted
  s2: Starting
  s3: Closing, forced
  s4: Closing, graceful
  s5: Stop signal fired, a start hook still runs
  s6: Ready, both ports open
  s7: Closed: cancelled
  s8: Closed: success
  s9: Closed: failed
  [*] --> s0
  [*] --> s1
  s0 --> s2: the scope starts
  s1 --> s3: the scope starts, no hook runs
  s2 --> s3: the app calls close() or a start hook throws or the start times out
  s2 --> s4: the app calls close({ graceful })
  s2 --> s5: the stop signal fires
  s2 --> s6: capsule 2 calls next(), both listen
  s5 --> s3: the start times out or the app calls close() or a hook calls next(), it rejects or a start hook throws
  s3 --> s7: the close hooks ran, the scope closes
  s6 --> s3: the app calls close()
  s6 --> s4: the app calls close({ graceful }) or the stop signal fires
  s4 --> s8: the close hooks ran, the scope closes
  s3 --> s9: the close hooks ran, the scope closes
  s4 --> s9: the close hooks ran, the scope closes
  class s0 blue
  class s1 blue
  class s2 blue
  class s3 yellow
  class s4 yellow
  class s5 blue
  class s6 teal
  class s7 tan
  class s8 tan
  class s9 tan
```

The amend to d2 (`closed` names the first cause),
on main before its fix.
Orange: `Closed: failed` breaks
ClosedFollowsFirstCause in some cases.
The path: the scope starts,
the app calls `close()`,
the close hooks run,
a start hook throws,
and the scope closes `failed`.

```mermaid
---
title: "A root with a stop signal and two capsules that listen after next()"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: starting
    lg1: open
    lg2: closing
    lg3: closed
    lg4: Breaks ClosedFollowsFirstCause in some cases
    lg5: Path to the ClosedFollowsFirstCause bug
  }
  class lg0 blue
  class lg1 teal
  class lg2 yellow
  class lg3 tan
  class lg4 mayBreak
  class lg5 bugPath
  s0: Not started
  s1: Not started, signal already aborted
  s2: Starting
  s3: Closing, forced
  s4: Closing, graceful
  s5: Stop signal fired, a start hook still runs
  s6: Ready, both ports open
  s7: Closed: cancelled
  s8: Closed: success
  s9: Closed: failed
  [*] --> s0
  [*] --> s1
  s0 --> s2: the scope starts
  s1 --> s3: the scope starts, no hook runs
  s2 --> s3: the app calls close() or a start hook throws or the start times out
  s2 --> s4: the app calls close({ graceful })
  s2 --> s5: the stop signal fires
  s3 --> s3: a close hook runs or a start hook throws
  s2 --> s6: capsule 2 calls next(), both listen
  s5 --> s3: the start times out or the app calls close() or a hook calls next(), it rejects or a start hook throws
  s3 --> s7: the close hooks ran, the scope closes
  s6 --> s3: the app calls close()
  s6 --> s4: the app calls close({ graceful }) or the stop signal fires
  s4 --> s8: the close hooks ran, the scope closes
  s3 --> s9: the close hooks ran, the scope closes
  s4 --> s9: the close hooks ran, the scope closes
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 blue
  class s0 bugPath
  class s1 blue
  class s2 blue
  class s2 bugPath
  class s3 yellow
  class s3 bugPath
  class s4 yellow
  class s5 blue
  class s6 teal
  class s7 tan
  class s8 tan
  class s9 tan
  class s9 mayBreak
  class s9 bugPath
```

## Results

- Bug 3's path test moves into Core's tests, red
  on main first, and passes after the fix.
- A minor version: the API changes.
- Apps that call `.settled()` rename it to
  `.idle()` (Hedl: its test uses).
