# No wrapper in the writer material (cinema-02)

Main moved to "no wrapper" (ADR 0060; best-practices rule 3 and
"a helper is allowed only over values"). The writer material taught
the old style: every teacher reference app passed controllers into
helpers. This card brings the material in line and measures it.
Bottom line: DeepSeek, same seat-map task as cinema-01, followed
both new rules with no teacher help and passed 41/41.

## What changed

- **Rules** (`tools/writer-trial/guidelines.md`): declare every data
  cell, operation, and resource once at module level; a helper takes
  plain values, never a controller, scope, or session.
- **Gate, writer mode** (`tools/jev/plain.mjs`):
  - S18: a `data`, `operation`, `resource`, or `tag` call inside a
    function. Main's `unitCouldBeModuleLevel` reports only units that
    could move, so a builder like `textAction(label, cell)` passed it.
  - S19: a helper parameter typed as a controller, scope, or session,
    directly or through a same-file type alias.
  - `apps/playground` (the golden example) has zero hits on both.
- **Jev:** `wrapsCallersStep` joins the writer questions as advice
  (noisy: 87% ordered). A proven judge answering within 0.1 of its bar
  is asked twice more and the gate uses the median; the locker gate
  proof went from 3 of 6 runs to 4 of 4.
- **Image:** `tinker-writer-trial:20260925`
  (`sha256:ac6b1e42`), holding the current core and react builds.
- **Reference apps:** all seven rewritten; S18/S19 hits 14 → 0,
  behavior unchanged; every canary and gate proof passes on the new
  image.

## Result

- **cinema-01** (old material): first try, 41/41, 4 helpers taking a
  controller.
- **cinema-02** (new material): 17 min, 9 Jev calls. The gate blocked
  one input default (`readSeatId`, 0.87); DeepSeek fixed it. S17, S18,
  S19: 0. Teacher 41/41 after a checker fix; own check, 65 tests,
  and build exit 0.

## Checker bug found

DeepSeek put Release inside the Seat cell. The checker found a row by
the cell's accessible name, which then read "D6 Release D6", so one
case failed. Fixed: match a text node equal to the id outside any
button (dad9a97); new good canary with that layout; 16/16 pass.

## Where things live

- Trial folder: `~/.local/share/tinker-writer-trial/cinema-02/`.
- Projects, workspaces, containers, volumes: removed.
