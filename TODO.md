# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.
Core ticket detail + reset recipes: `docs/roadmap/core-v1/PROGRESS.md`.

## Now

- [ ] lazy resource building (pair, parallel) — build a resource only when its value is actually used,
      via a lazy getter on the deps object, so crafting an object that never touches a dep is cheap.
  - Dispatched as an isolated worktree pair off `core/lt2`. Verify: a dep whose getter is never read
    is never built (observable via a build counter / no cleanup); existing behavior unchanged when the
    getter IS read; gate green + astra-clean. Land as its own tag.

- [ ] core/lt3 — cancellation hardening + deadlock detect-and-kill + one-end state machine (ADR 0026
      Q3/Q4/Q5), PLUS the lt2-deferred build/release timing races (separate-release resource-cleanup
      ordering; superseded mid-build dependent's late-cleanup order vs a concurrently-released
      dependency — both run once, only order can be off; see `teardown-redesign.md`).
  - Verify: a self/ancestor teardown-wait is killed not hung; a conflicting end on an already-ended
    lifetime throws; the cancel-before/after-body-settle matrix; the deferred ordering races; gate
    green (`scripts/ticket.sh`) + astra-clean.

- [ ] teardown/lifetime REDESIGN (umbrella) — converged API `ctx.defer(end)` + `ctx.signal` (ADR 0024)
      with teardown as reverse-registration LIFO (ADR 0026). Tracked as core/lt1–lt4 in PROGRESS.md;
      failure ledger in `docs/roadmap/core-v1/teardown-redesign.md`.
  - lt1 DONE (`core/lt1`): converged ctx + reverse-registration close; literal settlement reducer;
    branded cancel reasons; concurrent-close severity/inheritedEnd correctness. 14 astra rounds.
  - lt2 DONE (`core/lt2`): release via reverse-registration drain + depth-ordered cross-owner chain +
    direct op-borrow (ADR Q2). A rounds-8–14 resource-cleanup dep-borrow was found beyond-spec +
    deadlock-prone and REMOVED (simplified; code shrank). Timing-race ordering deferred to lt3.
  - Remaining: lt3 (cancel/deadlock/state + deferred timing races) → lt4 (prove contract + remove any
    dead two-phase paths + budgets).
  - Verify: each lt ticket lands green (`scripts/ticket.sh`) + astra-clean; bug-ledger classes covered.

## Next (roadmap, in order)

- [ ] core/t19 — v1 validation milestone
  - Verify: all budget lanes green together (size, promises, heap, mutation, CRAP, both entries, cast-free examples).

## Done

- [x] lt3 slice 1 review, round 2 — P1: external concurrent close during an awaited close defer
      gets an early ack with missing teardown errors (`packages/core/src/index.ts:1556,1640`).
  - Verified: `/tmp/lt3-review-r2/concurrent-close.test.ts` fails; true async reentry control passes.
    Restoring only the old guard span in a `/tmp` source copy makes the external-close probe pass.
    Plain Node `/tmp/lt3-review-r2/direct.mts` confirms early ack before the hook is released.
    Core suite 177/177 and root suite 183/183 pass; strict style census clean.
    `vp check` exits 1 on existing formatting in `docs/roadmap/core-v1/teardown-redesign.md`.
    Review complete; next author action: distinguish external close from async teardown reentry.
    No library/test edits and no deferred release-side or ordering findings.

- [x] lt3 slice 1 review — async teardown re-entry deadlock at
      `packages/core/src/index.ts:1562,1650`; also reproduced on `core/lt2`.
  - Verified: `/tmp/lt3-review-r1/reentry.test.ts` synchronous control passes; after-await probe
    times out. `vp check` exits 0 (two existing warnings), core tests 176/176, root tests 182/182,
    strict style census clean. No library/test edits; fix left to the author.

- [x] core/lt2 — release via the reverse-registration drain (diamonds), cross-owner order by depth
      (descendants first, chained awaiting each descendant owner's full async drain), direct op-borrow
      (ADR 0026 Q2: release waits for in-flight operations borrowing the resource, across the op body +
      its own defers), defers extracted up front, superseded builds drain once.
  - Verified: gate green — `vp check`, 172 core tests, strict census, size ~13.1 KB, mutation 77.33%;
    tag `core/lt2`. 15 astra rounds; a rounds-8–14 resource-cleanup dependency-borrow (beyond ADR Q2,
    deadlock-prone) was removed in a mid-course simplification (engine shrank ~1.2 KB). Two build/
    release timing-race ordering edges deferred to lt3 (see `teardown-redesign.md`).

- [x] core/lt1 — converged `ctx.defer(end)` + `ctx.signal` (replaces `cleanup`/`onOutcome`);
      `Scope.Outcome += cancelled`; close drains one per-layer defer list in reverse registration order
      (LIFO, onClose is a defer), sequential + awaited, children-first; settlement = ADR 0026/0025 §4
      reducer applied literally; branded cancel reasons; parent→child abort chaining; cancelled session
      rejects with the abort reason.
  - Verified: gate green — `vp check`, 158 core tests, strict census, size 10808 B, mutation 76.91%;
    tag `core/lt1`. 14 astra rounds (ledger `teardown-redesign.md`): rounds 7–9 removed an unsound
    "own vs propagated" distinction (provenance by error value is impossible); rounds 10–13 fixed
    concurrent/overlapping-close propagation (severity merge, branded reasons, live inheritedEnd read,
    already-closing child adopts a more-severe outcome); round 14 CONFIRM CLEAN (768-case matrix).

- [x] core/lifetime-design — proposed guideline in `docs/decisions/0025-teardown-redesign-guideline.md`.
  - Verified: model, six-invariant coverage, unified algorithm, bug-class map, six open decisions,
    and five sequenced ticket drafts are present; all document links resolve. No implementation edits.

- [x] core/tag-meta — static metadata on every unit (ADR 0023): `meta: [someTag(v)]` on data/operation/resource/tag (incl. a tag itself), read via `handle.meta` or `tag.read(unit)`; inert (never affects resolution)
  - Verified: gate green (check + 128 tests + size 8232 B + mutation 77.00% core); tag `core/tag-meta`. Astra: 1 bug (shared mutable empty-meta array leaked across units) — fixed by freezing the sentinel (`Object.freeze([])`, allowed by the user), census S15 narrowed to permit an empty-literal freeze while still flagging value-freezing; regression test added.
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
