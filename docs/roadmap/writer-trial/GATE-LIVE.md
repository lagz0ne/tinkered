# Live trial with the Jev gate (loans-01)

One fresh task, four writers, gate on (ADR 0068).
Bottom line: all four accepted; the gate raised
9 blocking findings before any writer reported done.
Two repair rounds were still needed: one a rule
the gate does not run yet, one a side effect of
a block.

## Setup

- **Task:** a tool library, new to every writer
  (`tools/writer-trial/loans/01-tool-library.md`).
- **Checker:** 53 cases; 12 canaries (3 good apps,
  9 planted bugs) all behave as expected.
- **Gate proof:** the reference app passes;
  a planted blank-copies default blocks at 0.94.
- **Frozen:** the hardened Jev bank, its calibration,
  and the gate, copied at trial create.

## Results

- **GLM Flash** — accepted first try.
  24 min. Gate never blocked.
- **MiMo Flash** — accepted first try.
  63 min. Gate blocked 6 writable `useData`
  writes in the view; the writer moved them
  into operations before reporting.
- **DeepSeek Flash** — accepted after 1 repair.
  12 min. Gate blocked 2 input defaults
  (`inputDefaultMasks`). Repair: a test put
  `isError` inside `expect` (census T08).
- **MiMo Pro** — accepted after 1 repair.
  190 min (177 first try). Gate blocked 1 input
  default. Repair: its fix widened
  `NotFound` to `{ id: unknown }` against the task.

Every final app: own check, test, and build exit 0;
53/53 teacher cases; gate `pass` on the teacher side.
Times are writer event-log spans, not wall clock.

## What the gate changed

- The stock trial's most common miss (a view
  writing cells through writable `useData`) shipped
  in 3 of 4 first attempts there. Here the gate
  stopped it during writing.
- No writer disputed a block. The 6 view-write
  blocks come from plain code, so they are exact.
  The 3 input-default blocks match what the
  writers reported; the lead did not see that code
  before the fix.
- Repairs: stock-01 took 6, plan-01 took 2,
  loans-01 took 2. The tasks differ, so this is
  an observation, not a controlled comparison.

## What the gate missed or caused

- **T08 (`isError` in `expect`)** — plain code finds
  it; the gate did not run it then. Fixed by
  `writers/gate-census`: `tools/jev/plain.mjs` runs
  the census rules on the parser, and every row
  blocks. Sweep over 12 accepted apps (3 domains):
  0 false blocks, 1 real miss the lead had passed
  (stock GLM test fixture imports `../../src/StockApp`).
- **`idField` in MiMo Flash** — `String(id)` for a
  non-text id scored 0.81, under the 0.85 bar.
  Harmless here (it still ends in `NotFound`).
  Labeled `true`; `inputDefaultMasks` now 20 / 39,
  61 points, 99% ordered.
- **Over-correction** — MiMo Pro obeyed the block
  by breaking the task's payload type. Fixed by
  `writers/gate-howto`: every blocking item now
  carries a `fix` line, and the rules say to keep
  every task rule and report a conflict.

## Teacher bugs found by the live run

- `review.mjs` used its helper table before
  declaring it; `check` crashed. Fixed (34c25b2).
- The checker read a button inside a cell as
  cell text; MiMo Flash's valid layout failed 9
  cases. Fixed, new good canary (a5b3d26).
- The task never defined the Available filter.
  Writers split two ways; the checker accepts both.
- The census flagged `../src/index` (public entry,
  no extension) as a private import (T04).
  `plain.mjs` allows it.

## Where things live

- Trial folder: `~/.local/share/tinker-writer-trial/loans-01/`
  (archives, sessions, events, checks, `lead-notes.md`).
- Projects, workspaces, containers, volumes:
  removed; `workers.mjs cleanup` exit 0.
