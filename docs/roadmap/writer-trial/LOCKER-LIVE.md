# Fourth live gate trial (locker-01)

One fresh task (a parcel locker), gate on, and two new writer
rules: read and check `ctx.rawInput`, and keep error payload
types exact.
Bottom line: three writers finished and passed first try with
no payload miss; that miss cost 2 repairs in each of the last
two trials. GLM stopped on a gateway credit error and was not
scored. After this trial only DeepSeek v4.1 Flash stays (cost).

## Setup

- **Task:** `tools/writer-trial/locker/01-parcel-locker.md`.
- **Rules:** `tools/writer-trial/guidelines.md` "Errors and
  input" (42a7e00), checked against core first:
  a `{ input }` call skips an `input` parser, a throwing parser
  surfaces as DataValidationFailed, and `ctx.rawInput` holds the
  caller's value for both call styles.
- **Checker:** 50 cases; the payload miss has two named cases
  (`{ input }` and `{ rawInput }` calls). 15 canaries pass.
- **Gate fix before launch:** `noOpRejected` scored the correct
  `receiveParcel` (a create with a limit guard) at 0.64–0.72
  against a 0.7 bar. One added line: a create or a remove has no
  already-so state. True min 0.70, clean max 0.61, bar 0.66.
  All three gate proofs still block their plants.
- **MiMo Pro prompt:** one extra line, "Keep each response short:
  one step at a time", after two gateway time-limit failures in
  kitchen-01. Rules and task identical.

## Results

- **DeepSeek Flash** — accepted first try, 50/50. Gate blocked
  two input defaults mid-round; cleared by the fix line.
- **MiMo Flash** — accepted first try, 50/50. Gate blocked an
  id default and 6 writable `useData` writes; both cleared.
- **MiMo Pro** — accepted first try, 50/50. Gate blocked a real
  guard-order bug in `storeParcel` (0.8); fixed. First trial with
  no payload miss (it missed in loans-01, ballot-01, kitchen-01).
- **GLM Flash** — not scored. Gateway `402 insufficient_funds`
  mid-round; saved as evidence, then dropped for cost.

## Four trials side by side

- **First-try accepts:** 2, 2, 2, 3 of 3 finished.
- **Payload-miss repairs:** 1, 2, 2, 0.
- **False blocks:** 0, 1, 1, 0.

## Cleanup note

DeepSeek's container was gone at export time; its volume and
saved attempt were intact. The container was recreated
(stopped, same settings) on the volume, export ran, and
`workers.mjs cleanup locker-01` exited 0: no containers,
volumes, or projects left.

## Where things live

- Trial folder: `~/.local/share/tinker-writer-trial/locker-01/`.
- Writer list: `tools/writer-trial/config.json` `models`
  (DeepSeek only from 2026-09-25).
