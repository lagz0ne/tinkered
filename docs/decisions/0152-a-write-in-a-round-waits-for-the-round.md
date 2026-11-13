# 0152 A write in a round waits for the round

Date: 2026-11-13. Status: accepted (Duke, 08:54
UTC: "fix the cause in depth"); built on a branch,
not landed.
Adds to: ADR 0150 (derived). Opens the way for an
op in a derived slot (ADR 0151).

## What the user said

Duke, 08:43: "are we afraid of infinitely loop? if
so, we'll need to do that anyway, what can we do
to detect that?"

Duke, 08:45: "think deeper into the issue".

Duke, 08:54: "yeah, fix the cause in depth".

## Context

A write told its watchers at once, inside the
write. A watcher that writes started a second
telling inside the first one.

Six cases on Core 0.21.1 show four problems:

- **Order.** Two watchers; the first writes 2 when
  it hears 1. The second heard `[1, 2]`, then
  `[0, 1]`. Its last message was stale. A test
  pinned this order (`namespaces.test.ts`,
  "does not rob a later watcher").
- **No stop.** A watcher that writes its own cell
  ran 5,056 times. Then the JavaScript stack
  ended it with a `RangeError` that names no cell.
- **Silent.** A derived whose factory runs an op
  that writes its source computed 2,901 times.
  The derived caught the stack error as a fault,
  then an outer frame wrote a value over it. No
  error; the derived held 1, the cell 2,900.
- **Async.** A watcher that awaits, then writes,
  ran 100,000 times in 200 ms. No stack grows.

One case must keep working: a watcher that
corrects a value and stops (a clamp).

## Precedent

- **Svelte's store.** `set` puts each subscriber
  and value in `subscriber_queue`. A `set` made by
  a subscriber joins the queue; the first `set`
  drains it. Order holds.
- **Vue's scheduler.** One job that runs again
  more than 100 times raises "Maximum recursive
  updates exceeded". React stops at 50 nested
  updates.
- **Angular signals.** NG0600: "Writing to signals
  is not allowed in a computed". MobX refuses a
  write in a computed too.
- **The DOM.** A listener that throws does not
  stop the other listeners.

## Decision

1. **A round is the telling of one write.** Its
   watchers hear that write together.
2. **A write made in a round keeps its value at
   once.** A read after it sees the new value.
3. **Its own round waits.** It runs after the
   rounds made before it. So each watcher hears
   the writes in the order they were made.
4. **Every start of a telling is a round:** a
   plain write, a namespaced write, a release, a
   named release, and a derived whose build
   settled.
5. **A chain has a depth.** A round made inside a
   round is one deeper. One watcher that writes
   500 cells makes 500 rounds of depth 1.
6. **Past depth 100, the first write raises
   `UpdateDepth`.** The error has the depth and
   the labels of the last 8 cells, oldest first.
   The cells keep the values they have.

   ```text
   UpdateDepth { depth: 101,
     cells: ["a", "b", "a", "b", ...] }
   ```

7. **A derived's factory may not write a cell.**
   The write raises `WriteInDerived` with both
   labels. The derived holds it as its fault,
   after one compute.

   ```text
   WriteInDerived { derived: "prs.view",
     cell: "prs.rows" }
   ```

8. **A watcher that throws ends its own round
   only.** The rounds that wait still run. Then
   the first error goes to the first write.

## Where ours is simpler

- One queue for every scope. No batch API and no
  scheduler: a round runs when the write is made.
- No tracking of who reads what. The depth is a
  number on the round.

## What it does not do

- **Async loops.** Each turn starts on a new
  stack. Traces show them: one span per run. A
  known way is a hop count in the trace header;
  AWS Lambda stops a loop at 16 hops that way.
- **A write through a resource.** A factory that
  calls a database is not seen. The rule stays:
  a derived has no side effect.
- **Watchers of one round.** When one throws, the
  later watchers of the same round are skipped,
  as before.

## Proof

Branch `claude/project-thread-ph7ce7`.

- `packages/core/tests/rounds.test.ts`: 19 tests.
  10 fail on 0.21.1 and pass here: the order on
  each of the 5 paths, both loops, and the two
  derived writes.
- Core: 79 files, 1,358 tests pass. One test
  changed: the pinned order above now reads
  `[1, 2]`, then `[2, 0]`.
- React: 29 files, 120 tests pass.
- `vp check`: 0 errors.
- Size: core 22,104 to 22,363 B gzip (cap 22,528);
  with rpc 33,912 to 34,172 B (cap 34,816).

## Proof owed before it lands

- Speed: the write path is hot. `bench/queued.sh`
  against 0.21.1, verdict on the card.
- Core's mutation lane, floor 85.
- `vp run skills`: the error registry is a public
  type.

## Not decided

- **An op in a derived slot.** Decided after:
  allowed (Duke, 10:17 UTC: "Yes"). ADR 0150,
  point 9 has the rule and its test.
- **The limit as a setting.** It is fixed at 100.
