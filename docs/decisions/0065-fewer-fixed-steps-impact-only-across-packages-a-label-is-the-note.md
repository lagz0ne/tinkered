# 0065 Fewer fixed steps: an impact block only across packages, a Jev label is the note

Date: 2026-09-24. Status: accepted. Narrows: 0047 (the impact block), 0054 (the writer's Jev
steps). The gates do not change.

## Context

Each ticket carried steps that cost time and rarely caught anything:

- ADR 0047 made an impact block (the planned blast radius) and a SCIP review note required for
  every public-symbol change. ADR 0054 counted 21 blocks and no mismatch judged real. Inside one
  package, `vp check` and the tests already find every caller the change breaks.
- A writer answered each Jev flag twice: one line in the report, then a `label.mjs` call that
  holds the same answer in `--why`.
- The report asked for a before/after line table and a list of added tests. Both are in the diff.

## Decision

1. **An impact block only when a public symbol changes across packages** (a rename, removal, or
   signature change that other packages use), or for a wide refactor. The lead writes it before
   the code; the lead's review runs `refs` on the old and new symbols. A change inside one
   package needs neither.
2. **A Jev flag gets one answer: its label.** `label.mjs <judge> true|false <file> --by <ticket>
--why "<fixed how | why not a defect>"`. The report pastes the label lines. No separate note.
3. **The report is:** branch, commits, the gate chain with its `EXIT` line, the label lines,
   changes from the brief with reasons, and Core feedback.
4. Plans cite a symbol by name, not a line number. `refs` finds its line when needed.

## Consequences

- The gates stay: the exit-code chain, `pnpm validate`, the mutation lane run alone, and
  calibration at every landing that adds labels.
- `scripts/ticket.sh` still runs `impact.mjs`; with no block it prints nothing to act on.
