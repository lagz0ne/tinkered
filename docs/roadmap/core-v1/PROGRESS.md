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
| core/t11 | Outcome hooks + session(fn)            | 09, 10     | [x]    |
| core/t12 | Single-node release                    | 09, 10     | [x]    |
| core/t13 | Release cascade within owner           | 12         | [x]    |
| core/t14 | Release cascade across owners          | 13         | [x]    |
| core/t15 | Command / manual observation           | 07         | [x]    |
| core/t16 | Resource observation                   | 09, 10, 15 | [x]    |
| core/t17 | Data/command presets                   | 05         | [x]    |
| core/t18 | Resource presets                       | 09, 10, 17 | [x]    |
| core/t19 | v1 validation milestone                | 01–18      | [ ]    |

Parallelizable once upstream lands: 04‖05, 15 alongside 12→13→14, 17 early off 05.
Family (keyed collections) is out of v1 (needs its own semantics ADR).

## Teardown / lifetime redesign (LT1–LT4)

Converge the ctx to `ctx.defer(end)` + `ctx.signal` (ADR 0024) with teardown as **reverse-registration
LIFO** (ADR 0026 — not a dependency scheduler). Replaces `cleanup` + `onOutcome`. Design inputs:
ADR 0024 (API), ADR 0026 (decisions), ADR 0025 (analysis/bug map), and the bug/requirements ledger
`teardown-redesign.md`. Each ticket lands astra-clean via the gate; sits before core/t19.

| tag      | ticket                                                               | blockers | status |
| -------- | -------------------------------------------------------------------- | -------- | ------ |
| core/lt1 | Converged ctx + reverse-registration close                           | t14, t16 | [x]    |
| core/lt2 | Release + cross-owner via the same drain                             | lt1      | [x]    |
| core/lt3 | Cancellation hardening + `close()` shutdown-mode redesign (ADR 0028) | lt2      | [x]    |
| core/lt4 | Prove the contract + remove old paths + budgets + accepted limits    | lt3      | [x]    |

- **lt1** — `ctx.defer(end)` (end = success|failed|cancelled|released) + `ctx.signal` on operation and
  resource ctx; `Scope.Outcome += cancelled`. Close drains the layer's one defer list (onClose is a
  defer) in **reverse registration order**, sequential + awaited, children-first. Settlement reducer
  (body/owned failure > cancel > success); `isCancel = error === signal.reason`; cancelled session
  rejects with the abort reason; `signal` chains parent→child and aborts at close start.
  _Accept (public seam):_ reverse-registration LIFO incl. onClose interleaving (even onClose
  registered mid-factory); diamond/chain order via registration; 10k-deep chain closes without
  overflow; op/resource `defer` sees the right status; a real late failure during close still
  surfaces; real failure beats cancel; cancelled session rejects with the abort reason; a streaming
  op writes a cell over time and stops cleanly when `close()` aborts its signal; throwing defer →
  aggregated `TeardownFailed`, later defers still run.
  _LANDED (tag `core/lt1`)._ Gate green: `vp check`, 158 core tests, strict census, size 10808 B,
  mutation 76.91%. **14 astra rounds** — full failure ledger in `teardown-redesign.md` (rounds 1–14).
  The settlement model is the ADR 0026/0025 §4 reducer applied **literally** (a real non-cancel body
  rejection wins → owned-work → inherited/explicit failed → cancel → success): rounds 7–9 chased an
  "own vs propagated body failure" distinction that is unsound (provenance by error value is
  impossible) and it was removed. Concurrent/overlapping-close correctness (rounds 10–13): severity
  merge of `inheritedEnd` in `abortSubtree`; **branded** abort reasons so `isCancel` recognizes a
  cancel across layers; live `inheritedEnd` re-read at settlement; and an already-closing (not-yet-
  settled) child adopts a more-severe incoming outcome. Round 14 confirmed clean (768-case 4-layer
  overlap matrix + branding/LIFO/after-settlement probes).
- **lt2 final2 review:** P1 reproduced in `/tmp/lt2-final2-review/regression.test.ts`: one release
  of root `conn` cascades to an in-flight child `tx` borrowed by an operation. Once the build and
  operation finish, `conn` cleanup overtakes `tx`'s late async defer. The superseded defer's drain
  (`src/index.ts:1319`) is not joined by the original owner chain (`:1294`, `:1342`). Expected
  `tx-clean-open, conn-clean`; actual `conn-clean, tx-clean-closed`. Pre-release registration control
  passes. Prior borrow-registration fix confirmed. Checks: `vp check` green (two warnings), core
  172/172, workspace 178/178, strict census green. Source/tests unchanged; lt2 remains open.

- **lt2** — `release` selects the affected set via the `dependents` graph (selection only) and runs
  their defers through the SAME reverse-registration drain with `released`; cross-owner **claims** so
  an owner's close joins queued (incl. cross-owner) release work and never drops a late throw; borrow
  policy (Q2: wait for in-flight borrowers before physical teardown).
  _Accept:_ diamond release correct; cross-owner release joined (late throw not lost); superseded/
  failed builds run their defers once (released/failed); release/close/rebuild overlap has no double
  cleanup.
  _LANDED (tag `core/lt2`)._ Gate green: `vp check`, 172 core tests, strict census, size ~13.1 KB,
  mutation 77.33%. Design (after a mid-course simplification — see the ledger lt2 scope decision):
  release drains each affected owner's defers in reverse REGISTRATION order (diamonds), owners drained
  DESCENDANTS-FIRST (invariant 6) and chained so an ancestor dependency waits for each descendant
  owner's full (incl. async) drain; a **direct op-borrow** (ADR 0026 Q2) registered BEFORE dep
  resolution makes a release wait for in-flight operations borrowing the resource (across the op's
  body + its own defers); defers extracted up front so a rebuild during cleanup is not swept in;
  superseded builds drain their late defer once, borrow-aware. A rounds-8–14 "resource-cleanup borrows
  its dependency closure" mechanism was found beyond ADR 0026 Q2 and deadlock-prone, and REMOVED (net
  code shrank). Deferred to lt3 (build/release timing races, not core lt2 invariants): ordering a
  resource-cleanup against a dependency released by a SEPARATE later `release()`, and a superseded
  (mid-build) dependent's late-cleanup order vs its concurrently-released dependency — both run once,
  only order can be off. See `teardown-redesign.md`.
- **lt3** _LANDED (tag `core/lt3`)._ Gate green: `vp check`, 185 core / 191 root tests, strict census,
  size 15.1 KB gzip, mutation 77.45%; CONFIRM CLEAN over two review rounds (6 timing/mode findings, all
  fixed + regression-tested; 204 scratch cases). Delivered: lazy resource building; Q3 sync-reentry
  no-hang; **Q4 → ADR 0027** (close returns a `Result`, never throws); Q5 cancel-timing; and the pivot
  **ADR 0028 — `close()` is a shutdown MODE, not a wished outcome**: `close(opts?: { graceful?: boolean })`,
  forced (default) aborts + rolls resources back (cancelled) / graceful commits (success), reality-only
  reducer, the whole wish/severity machinery deleted (engine 15.0→14.5→15.1 KB across the churn). Real
  descendant-failure push-up collection at any depth. Deferred to lt4: graceful→forced escalation; a
  layer's own owned-work failure surfacing after its child cascade; async self-reentry; ordering races.
  Hostile userland objects out of scope for v1.
- **lt4** _LANDED (tag `core/lt4`)._ Docs/proof-only — NO source change since `core/lt3` (the redesign
  already removed the old wish/two-phase paths cleanly; no dead code). Delivered: glossary + ADR-ref
  refresh to the shutdown-mode / reality-reducer model (removed stale `ctx.cleanup`/`onOutcome`/wished-
  outcome terms); **ADR 0029 — teardown v1 accepted limitations** (escalation, own-owned-work-after-
  cascade, async self-reentry, cooperative-cancellation precondition, unspecified teardown ORDER,
  adversarial objects, async dep-cycle-after-await — each safe, each promotable if a real case hits);
  contract seam audit (every live guarantee has a deterministic test — close never throws, reality
  reducer, commit/rollback matrix, descendant collection at depth, cancellation, deep chains,
  streaming). Budgets green: size 15.1 KB gzip (< 30 KB), mutation 77.45%. Code carried the lt3
  CONFIRM-CLEAN review unchanged.
  _Accept:_ every live ledger class has a deterministic seam test; gate green; limitations documented.
