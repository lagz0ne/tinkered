# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.
Core ticket detail + reset recipes: `docs/roadmap/core-v1/PROGRESS.md`.

## Now

- [ ] subflow contract fix (dep-model / ADR 0020 refinement) — a bare operation dep is ALWAYS a
      callable, never a value even on void input; the callable accepts one object `{ input?, rawInput?, tags? }`.
  - Decision (user): one object arg (not positional). `input` = pre-typed (skip parse); `rawInput` = raw (parsed); `tags` = per-call bindings overlaid on the caller's context.
  - Verify: `scripts/ticket.sh` passes; a void-input bare op is delivered as a function (test);
    a subflow call passes rawInput (parsed), pre-typed input, and per-call tag bindings (test);
    new ADR (0022) refining 0020 + glossary `subflow` row updated.

## Next (roadmap, in order)

- [ ] subflow contract fix (dep-model / ADR 0020 refinement) — a bare operation dep is ALWAYS a
      callable, never a value even on void input; the callable accepts `input`, `rawInput`, and `tags`.
  - Verify: `scripts/ticket.sh` passes; a void-input bare op is delivered as a function (test);
    a subflow call can pass rawInput (parsed), pre-typed input, and per-call tag bindings (test);
    ADR 0020 updated + glossary `subflow` row updated.

- [ ] core/t18 — resource presets (ADR 0015): re-add the `preset(resource, factory)` overload and
      wire it through ownership / caching / generation / teardown.
  - Verify: `scripts/ticket.sh` passes; a resource preset replaces the built instance for downstream
    consumers, respects target/owner, and is torn down on close (test).
- [ ] streaming design grill — LLM producer specifics (ADR 0021 is model-only)
  - Verify: ADR 0021 updated with cell ownership / accumulate-vs-replace / end + error-vs-cancel; a streaming ticket added here.
- [ ] tag-meta-on-every-unit — tags attach static metadata to data/operation/resource/tag
  - Verify: `scripts/ticket.sh` passes; metadata is readable off a unit handle (test); folded into the extension pickup story.
- [ ] streaming (impl) — `ctx.signal` + accumulate-via-`data` (ADR 0021)
  - Verify: `scripts/ticket.sh` passes; a producer writes a cell over time, a watcher sees the growing value, and `close()` cancels the producer (test).
- [ ] core/t19 — v1 validation milestone
  - Verify: all budget lanes green together (size, promises, heap, mutation, CRAP, both entries, cast-free examples).

## Done

- [x] core/t17 — data/command presets (ADR 0015): `preset(dataCell, value)` (parse-validated) and `preset(command, run)`, downstream-only, cleared on close
  - Verified: gate green (check + 113 tests + size 7750 B + mutation 76.47% core); tag `core/t17`. Astra found no preset-runtime bugs; 2 census-regex bugs (S16 missed `preset<T>(`/`preset (`, flagged strings/comments) fixed + `style-census.selftest.sh` regression added. Resource-preset overload deferred to t18.
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
- [x] core/t15 — command / manual observation: behavior-neutral auto operation spans, explicit parent threading (no ALS), ctx.obs.child/event, ctx.log, isolated sinks, independent toggles, bounded history, off-is-free
  - Verified: gate green (check + all tests 105 core + size 7420 B + mutation 76.61% core); tag `core/t15` (commit 923e9af); 3 astra rounds (9 bugs, mostly behavior-neutrality — identity/lazy-thenable/sink-isolation — each regression-tested). Final prescribed one-liner landed on gate + astra probe.
- [x] core/t16 — resource observation: build spans linked to the caller (cross-owner), `used` edge per resolve, balanced async spans, value identity preserved (no proxy)
  - Verified: gate green (check + all tests 108 core + size 7505 B + mutation 76.31% core); tag `core/t16` (commit 6ef84b5); astra CLEAN on first review. **Observation subsystem (t15–t16) complete.**
