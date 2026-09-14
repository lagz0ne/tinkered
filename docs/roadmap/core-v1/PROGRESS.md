# core v1 — build progress

One green git checkpoint per ticket. Progress is linear and resettable: land tickets
in order, tag each, reset to any tag if a slice goes wrong.

- **Tickets:** `docs/roadmap/core-v1/issues/NN-*.md` (numbered in dependency order).
- **Decisions:** `docs/decisions/0009`–`0018`. **Glossary:** `docs/glossary.md`.
- **Branch:** `core-rebuild`. **Baseline:** tag `core/base` (design only, no code yet).

## How a ticket lands (deterministic + correct)

1. Build the slice + its scope-seam behavior tests (no mocks; deterministic handshakes, no sleeps).
2. Gate + checkpoint:

   ```bash
   scripts/ticket.sh <NN> "<short title>"
   ```

   The gate runs `vp check` + `vp run -r test` (+ `mutate`/size where wired). It commits
   only if green, then sets tag `core/t<NN>`. A red gate makes no checkpoint.

## Reset (git techniques)

- Undo the current (unlanded) work: `git reset --hard core/t<last>` (or `core/base`).
- Redo a landed ticket: `git reset --hard core/t<blocker>`, rebuild, re-run the gate.
- Inspect a checkpoint: `git switch --detach core/t07`.

## Order & status

Linear order (each ticket's blockers are all lower-numbered). Mark `x` when its tag exists.

| tag      | ticket                                 | blockers   | status |
| -------- | -------------------------------------- | ---------- | ------ |
| core/t01 | Packaged scope + data read             | —          | [x]    |
| core/t02 | data write + watch                     | 01         | [x]    |
| core/t03 | Sync commands (incl. effects)          | 02         | [x]    |
| core/t04 | Scope tags, all modes                  | 03         | [x]    |
| core/t05 | Async commands + work ownership        | 03         | [x]    |
| core/t06 | Sessions + inheritance + copy-on-write | 04         | [x]    |
| core/t07 | Structured close + onClose             | 05, 06     | [x]    |
| core/t08 | Sync scope resources + cleanup         | 07         | [x]    |
| core/t09 | Async resource builds + close          | 08         | [x]    |
| core/t10 | Resource targets + owner-context       | 08         | [x]    |
| core/t11 | Outcome hooks + session(fn)            | 09, 10     | [ ]    |
| core/t12 | Single-node release                    | 09, 10     | [ ]    |
| core/t13 | Release cascade within owner           | 12         | [ ]    |
| core/t14 | Release cascade across owners          | 13         | [ ]    |
| core/t15 | Command / manual observation           | 07         | [ ]    |
| core/t16 | Resource observation                   | 09, 10, 15 | [ ]    |
| core/t17 | Data/command presets                   | 05         | [ ]    |
| core/t18 | Resource presets                       | 09, 10, 17 | [ ]    |
| core/t19 | v1 validation milestone                | 01–18      | [ ]    |

Parallelizable once upstream lands: 04‖05, 15 alongside 12→13→14, 17 early off 05.
Family (keyed collections) is out of v1 (needs its own semantics ADR).
