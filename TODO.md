# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.
Core ticket detail + reset recipes: `docs/roadmap/core-v1/PROGRESS.md`.

## Now

- [ ] pick the next thread (presets line t17+t18 + subflow all landed). Options: streaming design
      grill (needs the user) or tag-meta-on-every-unit (buildable now). See Next.

## Next (roadmap, in order)

- [ ] streaming design grill — LLM producer specifics (ADR 0021 is model-only)
  - Verify: ADR 0021 updated with cell ownership / accumulate-vs-replace / end + error-vs-cancel; a streaming ticket added here.
- [ ] tag-meta-on-every-unit — tags attach static metadata to data/operation/resource/tag
  - Verify: `scripts/ticket.sh` passes; metadata is readable off a unit handle (test); folded into the extension pickup story.
- [ ] streaming (impl) — `ctx.signal` + accumulate-via-`data` (ADR 0021)
  - Verify: `scripts/ticket.sh` passes; a producer writes a cell over time, a watcher sees the growing value, and `close()` cancels the producer (test).
- [ ] core/t19 — v1 validation milestone
  - Verify: all budget lanes green together (size, promises, heap, mutation, CRAP, both entries, cast-free examples).

## Done

- [x] core/t18 — resource presets (ADR 0015): `preset(resource, factory)` swaps the factory only for downstream consumers; same deps/caching/generation/teardown; async path included
  - Verified: gate green (check + 124 tests + size 7945 B + mutation exit 0 ~76.5% core); tag `core/t18`. Astra: 2 type-precision gaps — silent-any preset deps (fixed → `Record<string, unknown>`, reproduced+verified, narrowing test added) and a `void`-resource accepting an async preset (documented TS limitation; void resources are an anti-pattern). Census hardened to skip `.stryker-tmp`. **Presets line (t17+t18) complete.**
- [x] core/subflow — invocation object (ADR 0022, refines 0020): a bare op / command controller is always a callable; `resolve({ input?, rawInput?, tags? })` — defined `input` wins, `rawInput` is parsed, `tags` overlay the caller's ambient bindings for that one call (not into resources or nested subflows)
  - Verified: gate green (check + 119 tests + size 7916 B + mutation 76.48% core); tag `core/subflow`. Astra: 2 type holes found (undefined-input→NaN; `never`→optional arg), both fixed (runtime + `CallArgs` conditional) with regression tests; second focused pass CLEAN.
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
