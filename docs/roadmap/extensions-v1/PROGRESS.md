# extensions v1 — build progress

Extensions are middleware on the scope's verbs; the composition root installs them; `scope.ready`
awaits every start (ADR 0050). Core tickets first (start + close, then one verb per ticket), then
sync adopts them. **Complete 2026-09-19: the extensions-v1 queue is empty.**

- **Decision:** `docs/decisions/0050-extensions-are-middleware-on-the-scopes-verbs-the-composition-root-installs-them-ready-awaits-start.md`.
- **Glossary:** `docs/glossary.md` → "Extensions".
- **Gate + tag:** `scripts/ticket.sh <NN> "<title>"` → `core/t<NN>`; probes `bench/core-probe.mjs` (min of 3) on every core ticket.

## Anchors (core `packages/core/src/index.ts`, SCIP refs 2026-09-19)

`createScope` :2589 → `handleFor(makeLayer(undefined, options))`; `makeLayer` :2127 (the `Layer` record;
`defers: []`); `handleFor` :2494 (builds the handle; `resolve` dispatch :2517; `onClose` pushes
`{ fn, resource: undefined }` to `layer.defers` :2579; `close` → `closeLayer(layer, !opts?.graceful)`);
`closeLayer` :2314 → `startClose` :2364 (the structural close: abort subtree, classify body, children,
pending, defers); `emptyCtxFor(owner)` :1657 = a `Resource.Ctx` for a layer without a target (the
extension's `ctx`: `defer` lands in `owner.defers`, `signal` is the layer's); `Scope.Options` :192+;
`Scope.Handle` :388–445; unit discriminators `isData`/`isResource`/… on the private symbols :3–8.

## Order & status

| tag      | ticket                                                                                                        | blockers | status |
| -------- | ------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| core/t32 | `Scope.Extension`, `extensions` option, `start`/`close` chains, `scope.ready`, `resolve(ext)`, `NotSupported` | —        | [x]    |
| core/t33 | the `resolve` chain (cells, resources, tags) — probes flat when unhooked                                      | t32      | [x]    |
| core/t34 | the `run` chain (operation calls) — `op` probe flat when unhooked; short-circuit                              | t32      | [x]    |
| core/t35 | the `write` chain (cell sets) — probe flat when unhooked; a refused write leaves the cell                     | t32      | [x]    |
| sync/t06 | `source()` + `subscribe(transport)` as extensions; readiness = the initial data set; recipe + README          | t32      | [x]    |
| sync/t07 | Restore public seam coverage after t06; isolated mutation ≥ 70                                                | t06      | [x]    |

### Landed

| tag      | sha     | tests | size (B gzip) | mutation | probes (before → after)                                                                                                            | notes                                                                                                                                                              |
| -------- | ------- | ----- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| core/t32 | 66bcea7 | 239   | 22128         | 78.47    | create 176→169, warm 29.2→29.2, op 100.9→101.1, opres 330→327, cold 695→711, session 1617→1633 (pinned, min of 3, A/B alternating) | writer-built, one fix round (handle literal restored; cold-path `extendHandle`). Follow-up in t33: `exts` off the Layer record; extract only the resolve dispatch. |
| sync/t06 | 6409128 | 21    | 4066          | 62.34    | — (no core change)                                                                                                                 | `source()`/`subscribe(transport)` as extensions; ready = the initial data set; `SyncNotReady`; `fail()` in the registry. Writer-built, one fix round.              |
| core/t33 | 1810c85 | 246   | 22394         | 78.62    | t32 → t33 (pinned, min of 3): create 168.6→169.3, cold 716.7→707.0, session 1623→1587, op 101.9→100.9                              | `resolveThrough` onion on the root handle; records in a WeakMap off the Layer; the dispatch extraction measured and reverted. Writer-built, no fix round.          |
| core/t34 | 761f4a5 | 253   | 22635         | 78.72    | t33 → t34 (pinned, min of 3): op 101.1→100.9, run 112.4→112.3, opres 328.5→328.7, create 168.5→168.9                               | `runThrough` onion on the root handle; innermost `next` = the plain `run`; `handleFor` untouched. Writer-built, no fix round.                                      |
| core/t35 | d9f333f | 260   | 22851         | 78.56    | t34 → t35 (CPU7, min of 3): write 27.1→27.1, create 168.5→168.7, op 100.9→101.7, cold 709.2→706.3, session 1619→1609               | Writer-built, one fix round: closed cached-controller access guarded. Root set/update onion; sessions/dependency writes bypass; old guard/error retired.           |
| sync/t07 | 3a6ae72 | 28    | 4066          | 78.06    | — (tests only; source unchanged)                                                                                                   | One lead fix round: exact missing keys and queued-message cleanup. Whole initial set staged across a turn.                                                         |

### Impact blocks (ADR 0047)

Blocks list `src/` and `tests/` files only (examples live outside the package index).

```impact sync/t06
sync  source     src/index.ts tests/sync.test.ts
sync  subscribe  src/index.ts tests/sync.test.ts
sync  fail       src/errors.ts src/index.ts
```

```impact core/t35
core  writeThrough   src/index.ts
core  extendHandle   src/index.ts
core  rejectUnwired  (none)
core  NotSupported   (none)
```

```impact core/t33
core  resolveThrough    src/index.ts
core  resolveExtension  src/index.ts
core  extendHandle      src/index.ts
core  rejectUnwired     src/index.ts
```

```impact core/t34
core  runThrough    src/index.ts
core  extendHandle  src/index.ts
core  rejectUnwired src/index.ts
```

```impact core/t32
core  createScope   src/index.ts tests/index.test.ts tests/cache.bench.test.ts
core  handleFor     src/index.ts
core  makeLayer     src/index.ts
core  closeLayer    src/index.ts
core  emptyCtxFor   src/index.ts
core  extension     src/index.ts tests/index.test.ts
core  isExtension   src/index.ts
```

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention, one promise per test, gate re-run, SCIP
refs, `node scripts/jev/impact.mjs <tag>`, the probe table re-measured), cherry-picks, runs the
mutation lane alone, tags. Reports end with **Core feedback**.

### sync/t07 follow-up (done)

Writer `403f44d0-a8c7-4803-bda0-81638905400f` ran in Paseo workspace `wks_85042cce8c480929`,
with files isolated in `/home/paseo/next/tinkered-sync-t07`. Writer commit `8593ef5` landed as
`3a6ae72`; the writer is archived and its Git worktree/branch removed. The current workspace remains.

The t06 log ran all 21 tests, including forced close, far-side close, and zero keys; the earlier
40-uncovered diagnosis was wrong. This follow-up covers the actual public gaps: invalid snapshots
and wrong-direction messages during readiness, cleanup after readiness, conflicting/repeated keys,
source family creation, and waiting for the final snapshot. No source or public signature changed.
Isolated sync mutation is 78.06, above the ≥ 70 target; thresholds are unchanged.

```impact sync/t07
sync  source     src/index.ts tests/sync.test.ts
sync  subscribe  src/index.ts tests/sync.test.ts
sync  family     src/index.ts tests/sync.test.ts
sync  memoryPair src/index.ts tests/sync.test.ts
```

### core/t35 lead review (2026-09-19)

SHIP after one fix round. The first patch returned a cached controller after close; the seam
regression fails without the outer `ensureOpen` and passes with it. Excess casts, the unsafe
README cast, and a duplicate test were removed. One overload cast remains. One public promise
per test; no mocks. Both `handleFor` and `dataController` are byte-identical to t34. The writer
ran in this Paseo workspace after the user's correction; future writers must stay here too.

Lead reran build, `vp check` (0 errors, 13 existing warnings), all package tests (core 260),
37 validate lanes, size (22851 B gzip), strict census, and bundle purity (no runtime imports).
The user's isolated landing sequence covers the ticket gate checks; `scripts/ticket.sh`'s
stage-all / mutate-all tail was not used. Mutation ran alone and its score is in the table.

Lead pinned A/B (CPU7, alternating, min of 3; local observations, not the off-host timing gate):

| probe                  | t34 ns | t35 ns |
| ---------------------- | ------ | ------ |
| warm                   | 28.7   | 28.8   |
| s2_data                | 252.6  | 251.8  |
| s4_warm_ctl            | 9.6    | 9.3    |
| op                     | 100.9  | 101.7  |
| run                    | 112.8  | 112.7  |
| create                 | 168.5  | 168.7  |
| cold                   | 709.2  | 706.3  |
| session                | 1619.0 | 1609.0 |
| write (changing value) | 27.1   | 27.1   |
| opres, first round     | 310.6  | 315.0  |
| opres, repeat          | 332.8  | 328.8  |

The opres repeat went the other way; no consistent slowdown was observed. Both rounds stay
recorded. Evidence: `/tmp/core-t35-lead-ab.log`, `/tmp/core-t35-lead-opres-repeat.log`,
`/tmp/core-t35-land-*.log`, `/tmp/core-t35-mutate.log`.

SCIP rebuilt every package. Old symbols (`scripts/scip.sh refs 'rejectUnwired|NotSupported'`):

```text
== cli
  definitions
  references (count  symbol  file)
    (none)
== core
  definitions
  references (count  symbol  file)
    (none)
== drizzle
  definitions
  references (count  symbol  file)
    (none)
== harness
  definitions
  references (count  symbol  file)
    (none)
== hono
  definitions
  references (count  symbol  file)
    (none)
== http
  definitions
  references (count  symbol  file)
    (none)
== mcp
  definitions
  references (count  symbol  file)
    (none)
== react
  definitions
  references (count  symbol  file)
    (none)
== sync
  definitions
  references (count  symbol  file)
    (none)
== utils
  definitions
  references (count  symbol  file)
    (none)
```

New symbols (`scripts/scip.sh refs 'writeThrough|extendHandle'`):

```text
== cli
  definitions
  references (count  symbol  file)
    (none)
== core
  definitions
    extendHandle  ->  src/index.ts:2694
    writeThrough  ->  src/index.ts:1721
  references (count  symbol  file)
       17  extendHandle  src/index.ts
        9  writeThrough  src/index.ts
== drizzle
  definitions
  references (count  symbol  file)
    (none)
== harness
  definitions
  references (count  symbol  file)
    (none)
== hono
  definitions
  references (count  symbol  file)
    (none)
== http
  definitions
  references (count  symbol  file)
    (none)
== mcp
  definitions
  references (count  symbol  file)
    (none)
== react
  definitions
  references (count  symbol  file)
    (none)
== sync
  definitions
  references (count  symbol  file)
    (none)
== utils
  definitions
  references (count  symbol  file)
    (none)
```

`node scripts/jev/impact.mjs core/t35 HEAD~1..HEAD` on the code landing: neither,
zero discrepancies. Definitions above are the review's anchors (ADR 0047).

### sync/t07 lead review (2026-09-19)

SHIP after one fix round. The initial violation cases first deliver one valid snapshot, then
assert only the remaining key in `SyncNotReady.missing`, the label, failed scope close, and wire
closure. The first cleanup test was masked by `memoryPair` dropping sends after close; it now
queues invalid then valid traffic before awaiting close and proves the later snapshot cannot apply.
The whole-set test holds the final snapshot across an event-loop turn, so an early ready is visible.
Separate family instances prove source-side creation of an unheld `a/b` identity. Distinct cells
with a shared key fail with `SyncConflict`; rebinding one cell emits one registration key.
Existing forced-close, far-side-close, and zero-key cases remain. No mocks, sleeps, internal tests,
casts, or ignored cleanup promises were added. The far-side case now narrows its error by control flow.

Lead reran the sync build, `vp check` (0 errors, 13 existing warnings), all package tests (sync 28),
all 37 deterministic validation lanes (including purity and cast-free examples), size (4066 B gzip),
and strict style census. Core and sync source are byte-identical to the baseline. No timing claim.
All packages were reindexed. No symbols were removed or renamed; the old/new tables below have
identical definition lines and file sets, with only test references growing. Impact for
`sync/t07 HEAD~1..HEAD` on code commit `3a6ae72`: neither, zero discrepancies.

Baseline (`scripts/scip.sh refs 'source|subscribe|family|memoryPair' sync`):

```text
== sync
  definitions
    family  ->  src/index.ts:70
    memoryPair  ->  src/index.ts:445
    source  ->  src/index.ts:187
    subscribe  ->  src/index.ts:288
  references (count  symbol  file)
       19  family  src/index.ts
       31  family  tests/sync.test.ts
       16  memoryPair  tests/sync.test.ts
        1  source  src/index.ts
       11  source  tests/sync.test.ts
        8  subscribe  src/index.ts
       12  subscribe  tests/sync.test.ts
```

After landing and reindexing (same command):

```text
== sync
  definitions
    family  ->  src/index.ts:70
    memoryPair  ->  src/index.ts:445
    source  ->  src/index.ts:187
    subscribe  ->  src/index.ts:288
  references (count  symbol  file)
       19  family  src/index.ts
       39  family  tests/sync.test.ts
       20  memoryPair  tests/sync.test.ts
        1  source  src/index.ts
       14  source  tests/sync.test.ts
        8  subscribe  src/index.ts
       16  subscribe  tests/sync.test.ts
```

Mutation ran alone, after writer archive and worktree removal: **78.06%** (242 killed, 0 timeout,
63 survived, 5 uncovered, 0 errors), 28 tests, 1m33s. `Done in` and process exit were observed;
Stryker restored the originals and `git status --short` was empty. The target ≥ 70 is met.
The staged readiness test also removed the early-ready survivors that skipped the missing-set check;
the remaining waiter guard survivor is not that same promise.

Evidence: `/tmp/sync-t07-report.md`, `/tmp/sync-t07-lead-draft-tests.log`,
`/tmp/sync-t07-land-{gate,build,check,tests,validate,size,census,index,impact}.log`,
`/tmp/sync-t07-{baseline,land}-refs.txt`, `/tmp/sync-t07-mutate.log`.
Installation still reports the pre-existing esbuild build-policy placeholder; existing dependencies
passed the gates. No dependency policy changed. Core feedback: no missing primitive; the public
transport, error payloads, and family identity supplied every needed seam.
