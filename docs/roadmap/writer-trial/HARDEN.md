# Jev hardening on trial code

Goal: Jev questions that any writer model can use
to write the way we do, in any domain.
Decision: [ADR 0061](../../decisions/0061-in-the-writer-loop-a-proven-jev-hit-and-a-plain-shape-finding-block-done.md).

Bottom line: 3 questions now block "done" in the writer loop.
Every other question stays advice.

## What blocks "done" now

- **Plain shape findings** (`tools/jev/shape.mjs`).
  React state hooks, effects, scope props,
  writable `useData` in a view.
- **`inputDefaultMasks`** — bad user input
  becomes a default instead of an error.
  Threshold 0.85.
- **`noOpRejected`** — a guard runs before the
  "already so" check, so a repeat request fails.
  Threshold 0.6.
- **`domainLogicInRender`** — a view checks input
  or picks an error itself. Threshold 0.6.

Both sides use one rule (`tools/writer-trial/gate.mjs`):

- the worker's `jev` tool marks `gate.blocking`;
- `review.mjs check` records `jevExit`,
  and `machine-pass` needs it.

An unavailable check is never a pass.

## How the questions were tested

- **Pool:** 1,695 items from 21 saved snapshots.
  Bookings, stock moves, a learning plan.
- **Labels:** 835 cases, labeled blind.
  The labelers never saw a Jev score.
- **Lead review:** every `true` label, plus 4 overrides.
- **Seeded:** 5 real units with one planted bug
  (a guard moved, or an input rule in a view).
- **Bar** (ADR 0054): 5 cases a side,
  30 points apart, 90% of pairs in order.

## Results

- **Added:** `inputDefaultMasks`
  32 true / 61 false, 57 points, 99% ordered
  (with caller-aware cases; threshold kept at 0.85).
  Reworded once: the first wording scored
  `if (blank) return 1` at 25%. The tool-library
  gate proof caught it; 11 cases were added.
- **Added:** `noOpRejected`
  6 / 44, 67 points, 100% ordered.
- **Reworded:** `domainLogicInRender`
  6 / 43, 81 points, 100% ordered.
  The old wording scored its real cases at 19%.
- **Reworded:** `configNotTag`
  Clean units fell from 26% to 5%.
- **Retired:** `titleVague`
  Noisy with both wordings on 120 tests.
- **Rejected:** `unknownErrorSwallowed`, `staleNotice`
  The bug spans units; one unit cannot show it.
  [Evidence](harden-evidence/rejected-candidates.json).
- **Fixture eval:** 27 of 27 as expected.

## What is still open

- 14 questions stay `provisional`.
  Where they have bad cases, they separate by 45–90 points,
  but trial apps hold 0–3 real bad cases each.
  They need real bad code from other apps.
- A cross-unit question (unknown errors swallowed
  through a helper) needs the helper in the state.
  That is an extraction change, not a wording change.
- `jev/caller-context` (done): a helper unit carries
  `uses`, its same-file calling lines. `idText` (only
  fills a thrown payload) fell from 0.84 to 0.36.
  Callers in another file are still unseen.
- `jev/arrow-units` (done): `const x = () => …`
  helpers in `.ts` are units too. 23 more units
  across 20 accepted apps; 1 real catch (stock
  DeepSeek `readId` turns a missing id into `""`
  and looks it up), 0 false blocks.
- Live run: [GATE-LIVE.md](GATE-LIVE.md).

## Where things live

- Labels: `tools/jev/cases.jsonl`
  (`by`: blind label, lead, or seeded).
- Scores: `tools/jev/calibration.json`.
- First pass over the pool:
  [first-pass.json](harden-evidence/first-pass.json).
- Working files (pool, scores, labels):
  `~/.local/share/tinker-writer-trial/harden/`.
