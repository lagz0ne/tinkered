# 0047 The impact chain: a plan declares its blast radius, SCIP diffs it, Jev judges each mismatch

Date: 2026-09-18. Status: accepted. Refines: the Jev advisory plan (`docs/roadmap/jev-loop/PLAN.md`,
"protect-node-0"), the SCIP workflow in `CLAUDE.md` (the brief's refs table). Advisory only: the
gate stays `scripts/ticket.sh`, `pnpm validate`, the SCIP set-diff, and the lead.

## Context

Every gate we have checks that the code built is correct. None checks that the code built is the
code the plan asked for: a ticket can land green while touching a symbol the plan never named, or
while leaving a planned reference out. The brief already carries the expected blast radius (the
refs table the lead writes from SCIP before delegating), and SCIP already reports the actual one
after landing. Nothing crosses the two.

**The analogy is a frozen lockfile.** `pnpm install --frozen-lockfile` compares what the plan
declares (the lockfile) with what the source asks for (`package.json`); a deterministic diff finds
every mismatch, and a human decides which side is wrong (update the lockfile, or revert the
dependency). Ours is simpler: no resolution, only presence of a symbol in files.

## Decision

1. **The plan declares its blast radius in an impact block.** The lead writes it when cutting a
   ticket, BEFORE the code, as a fenced block in the track's `PROGRESS.md`, keyed by the future tag:

   ````text
   ```impact cli/t04
   cli  ^readCommand$  src/index.ts
   cli  ^commands$     src/index.ts tests/cli.test.ts examples/basic.ts
   cli  ^readRun$      src/index.ts
   ```
   ````

   One line per symbol: package, the SCIP `refs` regex, then the files (relative to the package)
   expected to define or reference it. `(none)` means the symbol must have no definition left (a
   removal). The formatter leaves fences alone, so the block never re-pads.

2. **SCIP is the sensor.** `scripts/jev/impact.mjs <tag> [range]` indexes the block's packages,
   runs `refs` per line, and set-diffs per symbol: **unexpected** files (actual minus expected),
   **missing** files (expected minus actual), plus **undeclared public changes** (an `export` added
   or renamed in the range's diff that no line's regex covers). Deterministic; no model yet.
3. **Jev answers one boolean per discrepancy**, in its proven zone: "Does achieving the goal
   require `<symbol>` to be referenced in `<file>`?" (for an undeclared export: "…require a new
   public symbol `<name>`?"). The goal is the range's commit message (`--goal` overrides). The
   verdict is a fixed mapping, never the model's:

   | discrepancy       | Jev true                       | Jev false                     |
   | ----------------- | ------------------------------ | ----------------------------- |
   | unexpected ref    | **plan wrong** (under-scoped)  | **source wrong** (over-built) |
   | missing ref       | **source wrong** (under-built) | **plan wrong** (over-scoped)  |
   | undeclared export | **plan wrong**                 | **source wrong**              |

   No discrepancy → **neither** (no model call at all). A symbol with both kinds → **both**.
   Probability inside (0.4, 0.6) → **unclear → human**.

4. **Where it runs.** The lead runs it in review step 1; `scripts/ticket.sh` prints it as a
   never-blocking pre-read beside `review.mjs`. It always exits 0. Contributors do not run it: the
   plan is the lead's, and a writer must not grade the scope it was handed (no self-grading).

## Consequences

- The "wrong thing built correctly" case gets a sensor: a green gate with an unexpected ref now
  says which side to fix, in one line per mismatch.
- The impact block replaces the free-text "Anchors" line for new tickets; old Anchors stay.
- Fixtures (jev/impact ticket): the real cli/t04 block must answer **neither** with zero model
  calls; the same block with `commands` limited to `src/index.ts` must answer **plan wrong** for
  `tests/cli.test.ts` and `examples/basic.ts`. A source-wrong fixture needs a real over-built
  diff — jev/calibrate mines one from history.
- CLAUDE.md's contributor workflow gains one sentence: the lead writes the impact block when
  cutting the ticket and reads `impact.mjs` in review.

## Alternatives rejected

- **A 4-way route per discrepancy** (source / plan / both / neither) — a classifier, proven
  weaker (2/3); the mapping above gets the same answer from a boolean.
- **One file per ticket under `docs/roadmap/<track>/impact/`** — a new directory for what
  `PROGRESS.md` already holds per ticket.
- **A blocking gate** — Jev never decides pass/fail (the one rule of the advisory layer).
