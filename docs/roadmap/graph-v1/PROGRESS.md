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

- **graph/t01** -- [ ]
  Core: one log line per operation (label, ms,
  outcome), gated on `obs.observing` exactly as
  the span is. `bench` before and after in a
  sandbox; `op` must stay within +2 ns.
  Packages keep their domain attributes and drop
  their hand-derived `ms`.
- **graph/t02** -- [ ]
  `http`: `send` and `attempt` become operations;
  the endpoint builder goes. Config merges inside
  `send`; per-call config stays `tags` on the run.
  Delete the hand-rolled `obs.child`. Span-tree
  test asserts listRepos > send > attempt x2.
  Consumers in the same commit: blueprint,
  tracker, tinkerer, examples.
- **graph/t03** -- [ ]
  `harness`: the turn builder goes; the author
  declares the turn operation depending on
  `coder.thread` and the cells. `request` -> `send`,
  `response` -> `respond` where the shape survives.
  Span-tree test over the recorded fixtures.
- **graph/t04** -- [ ]
  `process`: `command`'s sugar becomes a declared
  operation the author writes; the route keeps its
  row shape. Span-tree test over one command.
- **graph/t05** -- [ ]
  Re-run the Jev census; record the fall per
  package. Any unit still flagged is fixed or
  explained in one line.

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
