# Third live gate trial (kitchen-01)

One fresh task (a kitchen queue), four writers, gate on.
New since ballot-01: cast rule S17, fix lines on every
block, teacher reuse of writer answers, caller lines
(`uses`), and arrow helpers as units.
Bottom line: all four accepted, 2 first try, 2 after one
repair. The gate raised 6 blocks: 5 real, 1 false.

## Setup

- **Task:** `tools/writer-trial/kitchen/01-kitchen-queue.md`.
- **Checker:** 53 cases; 13 canaries behave as expected.
- **Gate proof:** reference app passes; planted blank-qty
  default (0.92), already-cooking guard order (0.87), and
  `value as string` (S17) each block.
- **Image:** the host rebuild lost `sha256:2232d27e`.
  Rebuilt from the unchanged build folder as
  `sha256:91630289`; the ballot canaries give the same
  13 verdicts and scores on it (f324d3e).

## Results

- **DeepSeek Flash** — accepted first try. 15 min.
  Gate never blocked.
- **MiMo Flash** — accepted first try. 56 min.
  Gate blocked 3 input defaults; cleared by the fix line.
- **GLM Flash** — accepted after 1 repair. 48 min.
  Gate blocked T07 in a test helper (fixed before report).
  First try: a non-text id reached `NotFound` through
  `ctx.input` with no parser (teacher 52/53). In the
  repair the gate blocked an id helper that kept going
  with `""` (0.95, real).
- **MiMo Pro** — accepted after 1 repair. 190 min,
  including two gateway failures (one fresh session).
  Gate blocked `cancelTicket` on `noOpRejected` at 0.62:
  a false block. MiMo Pro kept the task and reported the
  conflict, as the rules ask. First try: `notFound(id:
unknown)` put a non-text id in `NotFound` (52/53).

Every final app: own check, test, and build exit 0;
53/53 teacher cases; gate `pass` on the teacher side.

## Three trials side by side

- **First-try accepts:** 2, 2, 2 (loans, ballot, kitchen).
- **Repairs:** 2, 2, 2.
- **Gate blocks during writing:** 9, 6, 6.
- **False blocks:** 0, 1 (teacher-side noise, fixed by
  answer reuse), 1 (`cancelTicket`, fixed below).
- **Repair causes:** every repair in ballot and kitchen
  was the same miss: a non-text id in a `{ id: string }`
  payload, in a form no check sees.

The fixes cut false blocks and made blocks clear faster.
They did not cut repairs: the one miss left is not a
code shape a plain rule or a one-unit question can see.

## Changes from this run

- `noOpRejected` bar 0.6 → 0.7: true cases score
  0.77–0.88; `cancelTicket` 0.53–0.62. Still `proven`
  (6 / 45, 66 points, 100% ordered). Proofs still block.
- Core check of the input path: `{ input }` is trusted
  and typed; `{ rawInput }` with no parser gives
  `undefined`. Not a core bug; a teaching gap
  (`docs/roadmap/core-feedback.md`, 2026-09-24).

## Next candidates

- **Teach the input rule.** Add one line to the writer
  rules: an operation that untyped code can reach
  declares an `input` parser, or reads `rawInput` and
  checks it. Aimed at the only repeated miss.
- **Stop here.** Three trials give the same picture.

## Where things live

- Trial folder: `~/.local/share/tinker-writer-trial/kitchen-01/`
  (archives, sessions, events, checks, `lead-notes.md`).
- Projects, workspaces, containers, volumes: removed.
