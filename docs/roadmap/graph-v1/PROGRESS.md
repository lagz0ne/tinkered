# graph v1 — the graph must produce the trace

A step worth seeing in a trace is an operation; a frame supplies units and never builds the
author's operation (ADR 0058). Three frames change shape, each with its consumers and its
span-tree test in one commit. No expand-contract, no shim.

- **Decision:** `docs/decisions/0058-a-step-worth-seeing-is-an-operation-the-graph-must-produce-the-trace.md`.
- **Glossary:** `docs/glossary.md` -> "Authoring: the graph and its trace".
- **Gate + tag:** `scripts/ticket.sh <pkg> <NN> "<title>"`; mutation lane alone, floor 75.
- **Starting census (Jev lint, 2026-09-21):** 33 of 175 units flagged --
  `runForwardsToClosure` 4, `stateOutsideCell` 8, `effectWithoutDefer` 3, plus the
  "reads like a unit" tail. Recorded per package as each ticket lands.
- **Hand-rolled observation to delete:** 1 `obs.child` (http retry), 2 `span.attributes`
  (hono, harness), 8 log lines re-deriving `ms` (http, hono, harness, drizzle, process, mcp x2).

## The rule, as a test

```text
would I want this step in a trace,
or to preset it?
  yes -> an operation
  no  -> a plain function inside one
```

## Order & status

Tracer-bullet tickets: each cuts a complete path and is verifiable on its own. **Blocked by** is the
edge that must land first. Every ticket ends with the Jev loop below -- the writer runs it and
decides each flag before reporting, so a review round is about shape, never about findings the
tools already print.

- **graph/t02a** -- [x] `http`: finish the package
  Blocked by: none (the base is on `graph/t02-http`).
  Delivers: `vp run http#test` green on the new shape.
  - [ ] `endpoints.test.ts`: the client-preset test targets `attempt`
        (the `client` resource is gone); the forced-close test settles
        `cancelled` again.
  - [ ] `observe.test.ts`: assert `github.attempt` spans, not the old
        hand-rolled `http GET <url>` name.
  - [ ] `retry.test.ts`: one `attempt` span per try, backoff on the
        test clock, abort during backoff makes no further call.
  - [ ] no `.operation(` or `.client` left in `packages/http`.
- **graph/t02b** -- [x] the consumers
  Blocked by: t02a.
  Delivers: `vp check` clean and every consumer's tests green.
  - [ ] `apps/issue-tracker/src/client/api.ts` (7 endpoints), `drafter.ts`,
        `tests/client.test.ts`.
  - [ ] `packages/tinkerer/src/index.ts` (the `step` endpoint).
  - [ ] `examples/http/basic.ts`, and any harness example the change reaches.
  - [ ] one span-tree test in the tracker: a real request shows
        `caller > api.send > api.attempt`.
- **graph/t01** -- [ ] core's gated log line
  Blocked by: nothing, but held: `bench` is not on PATH in this container,
  so the +2 ns budget cannot be measured here. Start it where `bench` runs.
- **graph/t03** -- [ ] `harness`
  Blocked by: t02b (same pattern, proven once).
  The turn builder goes; the author declares the turn operation on
  `coder.thread` and the cells. `request` -> `send`, `response` -> `respond`.
  Span-tree test over the recorded fixtures.
- **graph/t04** -- [ ] `process`
  Blocked by: t03.
  `command`'s sugar becomes a declared operation; the route keeps its row
  shape. Span-tree test over one command.
- **graph/t04b** -- [ ] `blueprint` and `tinkerer` ship span-tree tests
  Blocked by: t04.
  Neither package's shape changes -- both already declare their operations
  the right way round. They are on `check-graph`'s list only because the
  graph is not _asserted_ to produce the trace. One test each, copied from
  `packages/http/tests/span-tree.test.ts`:
  - [ ] `blueprint`: `check` over a fixture blueprint shows its own span
        and the judge subflow beneath it.
  - [ ] `tinkerer`: one turn over the recorded reply shows
        `coder.turn > coder.step`, and with a tool call the tool operation
        nested beneath.
- **graph/t05** -- [ ] re-run the census
  Blocked by: t04. Record the flag count per package, before and after.

## The Jev loop every ticket ends with

Run these, decide every hit, then report. A hit fixed or explained in one line is not a review
round; an unexplained hit is.

```bash
# file judges + per-unit lint
node tools/jev/preflight.mjs main..HEAD
# the unit judges, incl. runForwardsToClosure
node tools/jev/lint.mjs <changed src paths>
# over-testing
node tools/jev/tests.mjs <pkg>
# a test title with no README line
node tools/jev/promises.mjs <pkg>
# record each decision
node tools/jev/label.mjs <judge> true|false \
  <file>[#<unit>] --by graph/<t> --why "<one line>"
```

The bar this track exists for: **`runForwardsToClosure` must not appear on a unit you wrote.** If it
does, either the step deserves to be an operation, or the helper belongs inside `run`.

## Separate card

- **fix/claude-defer** -- `startClaude` starts an SDK session and stops it by hand
  (`effectWithoutDefer` 81%). A correctness defect about cleanup, not shape: its own ticket,
  a failing test first.

## Ticket rules

- One package per contributor, own worktree (`docs/roadmap/contributor-brief.md`).
- Every ticket lands its span-tree test with the change, never after.
- No hand-rolled span outside core: a grep rides beside the test.
- A package and its consumers change in one commit; no shim, no second surface.
- Every report ends with **Core feedback** (a failing snippet, not prose).

### Landed

One line per ticket: tag -- sha -- tests -- size (B gzip) -- mutation -- Jev flags before/after.

- **graph/t02a + t02b** -- see the landing sha --
  http 65 tests, tinkerer 51, tracker 47, full
  suite green -- 85.01 mutation alone -- http's
  own Jev notes 5 -> 4; `check-graph` 6 -> 4
  violations (http cleared both rules).
  Writer-built (pi meta-muse) from a lead base,
  one review round. The review found one real
  defect the writer had decided was test-only:
  a subflow throws core's `Disposed` while
  `ctx.signal.aborted` is still false, and the
  catch reported `RequestFailed/Transport` --
  blaming a network nobody touched. Fixed in
  production code with a test pinning it; the
  close-ordering question went to core feedback.
