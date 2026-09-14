# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.
Core ticket detail + reset recipes: `docs/roadmap/core-v1/PROGRESS.md`.

## Now

- [ ] core/t15 + t16 — observation (chosen: riskier/code-heavy; folds in ctx.signal, subflow spans, tag-meta)
  - Verify: see Next. (streaming design grill is parked for the user whenever)

## Next (roadmap, in order)

- [ ] streaming design grill — LLM producer specifics (ADR 0021 is model-only)
  - Verify: ADR 0021 updated with cell ownership / accumulate-vs-replace / end + error-vs-cancel; a streaming ticket added here.
- [ ] core/t15 + t16 — observation; fold in tag-meta-on-every-unit + subflow spans + `ctx.signal`
  - Verify: `scripts/ticket.sh` passes; a span tree assertion test + tag-meta readable off a unit handle (test).
- [ ] streaming (impl) — `ctx.signal` + accumulate-via-`data` (ADR 0021)
  - Verify: `scripts/ticket.sh` passes; a producer writes a cell over time, a watcher sees the growing value, and `close()` cancels the producer (test).
- [ ] core/t17 + t18 — presets (ADR 0015)
  - Verify: `scripts/ticket.sh` passes; a preset replaces a node only for downstream consumers (test).
- [ ] core/t19 — v1 validation milestone
  - Verify: all budget lanes green together (size, promises, heap, mutation, CRAP, both entries, cast-free examples).

## Done

- [x] core/t07..t11 — structured close, sync/async resources, targets, outcome+session(fn)
  - Verified: tags `core/t07`..`core/t11` exist; each landed via a green `scripts/ticket.sh`.
- [x] core/t12 — single-node release (release resource → cleanup + rebuild; release data → reset; per-resource generation guard)
  - Verified: gate green (check + all tests 79 core + size 5036 B + mutation 79.81% core); tag `core/t12` (commit ca3793b). 6 astra rounds; final one-line `ensureOpen(owner)` guard landed on the reviewer's exact prescription + regression test (no 6th full round for a one-liner).
- [x] dep-model — subflows + resource deps (ADR 0020): bare op = subflow controller, bare resource = instance
  - Verified: gate green (check + all tests 80 core + size 5021 B + mutation 80.34% core); tag `core/dep-model` (commit 93443ca); astra clean after one prescribed P2 fix (required subflow input signature). `operation.controller` kept for now (removal deferred).
- [x] core/t13 — release cascade within one owner: reverse edges; two-phase iterative cascade (caches-first, then callbacks); diamond exactly-once; failed builds detach edges
  - Verified: gate green (check + all tests 87 core + size 5917 B + mutation 76.82% core); tag `core/t13` (commit bc8487c); astra CONFIRMED CLEAN after 2 rounds (5 bugs total, each regression-tested).
- [x] core/t14 — release cascade across owners: subtree search for scope nodes, owner-only for session; per-(node,owner) dedup; skip closing owners; per-layer teardown-depth close-reentry guard
  - Verified: gate green (check + all tests 94 core + size 6657 B + mutation 78.18% core); tag `core/t14` (commit 1754727); astra CONFIRMED CLEAN after 3 rounds (7 bugs total, each regression-tested). **Release subsystem (t12–t14) complete.**
