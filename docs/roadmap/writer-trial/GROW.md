# A five-round growing app (grow-01)

The harder test: one booking app that grows over five rounds,
DeepSeek v4.1 Flash only, on the no-wrapper material. Each round
reruns every earlier round's checks.
Bottom line: DeepSeek finished all five rounds, 43/43 on the last,
with one repair. Every failure that stopped a round came from the
teacher side: two checker bugs, one wrong writer rule, and one
question wording that falsely blocked a task-mandated default.

## Setup

- **Task:** `tools/writer-trial/packets/01-05`, booking suite.
- **Checkers proven first** on image `20260925`
  (`grow-prep/prove.out`): two known-good apps pass all five
  rounds, the known-bad app fails round 4 (27/29), an empty app
  fails round 1.

## Rounds

- **1 Book and cancel** — accepted. 19 min. The gate blocked 5
  writable `useData` writes and 2 input defaults; all fixed before
  the report. First check failed on a checker bug (below). 472 lines.
- **2 Edit** — accepted first try. 11 min, 0 blocks. 818 lines.
- **3 Dates and weekly series** — accepted with a lead override.
  10 min. The gate blocked the omitted-date default the task
  requires; DeepSeek kept the task and reported the conflict.
  1174 lines.
- **4 Undo** — accepted after 1 repair. 12 min over two tries.
  The repair came from a wrong teacher rule (below); the same
  false block repeated. 1269 lines.
- **5 Rename a series** — accepted first try. 4 min. 43/43 on the
  transfer checker, which reruns every round. 1458 lines.

Totals: 56 minutes of writer time, S17/S18/S19 hits 0 in every
round, own check, tests (145 at the end), and build exit 0 in
every round.

## Teacher-side bugs found and fixed

- **Select inside its label.** `<label>Room <select>` adds option
  text to the label, so an exact `getByLabel("Room")` timed out on
  valid markup. One `labeled()` helper for all 59 lookups (bda0247).
- **Room select in round 4.** The round-4 checker called `fill` on
  the Edit room `<select>`; the round runner already accepted a
  select for Room. `setField` (4a362c5).
- **Wrong writer rule.** The rules said `useId` gives unique labels
  across mounted roots. It does not: every separately mounted root
  gets the same ids, so a second app's labels point at the first
  app's fields. DeepSeek followed the rule; the two-roots case caught
  the real bug. Rule corrected; DeepSeek's repair wraps each control
  in its label and adds a two-root test that fails without the fix.
- **Question wording.** `inputDefaultMasks` scored the task-mandated
  omitted-date default at 0.85–0.94. Third wording: a default only
  for an absent field, with a present bad value still raising, is
  not masking. The flagged units now score 0.61–0.78; at 0.85 clean
  0/64, true 28/32 (32/64 labeled, sep 56, ordered 99%). All five
  gate proofs still block their plants. The trial kept its frozen
  wording, so rounds 3–5 carry a recorded lead override.

## What this shows

- DeepSeek grew a 1,458-line app across five rounds with no
  regression the checkers could find.
- Its writer-side misses were all caught by the gate during writing.
- The teacher's rules, checkers, and question wording are now the
  weakest part of the loop. Each new layout or task rule found one
  more assumption in them.

## Where things live

- Trial folder: `~/.local/share/tinker-writer-trial/grow-01/`
  (`lead-notes.md` has every round).
- Projects, workspaces, containers, volumes: removed.
