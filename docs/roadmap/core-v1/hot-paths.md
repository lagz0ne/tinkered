# `@tinker/core` — code map & hot paths (t19 prep)

A SCIP-backed map of the engine (`packages/core/src/index.ts`) and its hot paths, to drive the t19 v1
validation budgets (size, promises, heap, deep-chain). Line numbers are as of tag `core/lt4`; the
call edges are derived from a SCIP index and cross-checked against the source. Allocation and
sync-vs-async notes come from reading the source (SCIP records occurrences, not runtime behavior).

## Reproduce the SCIP index

Tools live under the persistent user home (never `/usr`/apt); artifacts under `/tmp/scip-core/`
(nothing written into the repo).

```bash
export PNPM_HOME=/home/paseo/.local/share/pnpm
export PATH="$PNPM_HOME/bin:/home/paseo/.local/bin:$PATH"
# one-time installs (already done): pnpm add -g @sourcegraph/scip-typescript ; scip CLI built from source → ~/.local/bin/scip
scip-typescript index --cwd packages/core --output /tmp/scip-core/index.scip --no-progress-bar
scip stats    --from /tmp/scip-core/index.scip
scip snapshot --from /tmp/scip-core/index.scip --to /tmp/scip-core/snapshots --strict=false
scip print --json /tmp/scip-core/index.scip > /tmp/scip-core/index.json
```

Index: 6 documents, **2948 definitions / 13425 occurrences** (`src/index.ts` = 996 symbols / 4525
occurrences). `createScope` = **1 definition + ~190 references, all in the test files** — SCIP proof
that tests only touch the public seam.

## What SCIP gives us

- **Jump-to-def / find-all-refs** — from each symbol's occurrences + a role bit (definition vs
  reference). A definition also carries an `enclosing_range` (its body span).
- **Who-calls-whom (approximate)** — SCIP has no runtime call graph; approximate it by mapping each
  _reference_ of a function symbol to the tightest definition whose `enclosing_range` contains it
  (`caller → callee`). Limits: dynamic dispatch through the `deps` object (subflows) and lazy getters
  don't show as direct edges.
- **Code map** — group definitions by descriptor to see the layers (below).

## Code map (layered)

- **Public factories** — `createScope` (1901), `data` (377), `operation` (428), `resource` (451),
  `tag` (397), `preset` (486).
- **Layer + data** — `makeLayer` (1546), `effectiveEntry`/`readCell` (548/562), `writeCell` (596),
  `flushTree` (585), `ownCell`/`invalidateEff` (574/568).
- **Resolution** — `commandController` (990), `resourceController` (1228), `buildResource` (1133),
  `buildDeps` (1098), `resolveDep`/`resolveEdge` (695/682), `defineLazyDep` (1069).
- **Release + teardown** — `releaseNode` (1360), `collectAffected` (1326), `closeLayer` (1693),
  `startClose` (1742), `drainDefers` (1625) / `runDefers` (941), `settleOutcome` (1658),
  `finishLayer` (1772), `markSwept` (1594) / `abortSubtree` (1607).

## Hot-path call trees

`:N` = definition line; `[…]` = per-call heap allocations.

### 1. Operation resolve — `getController(op).resolve(input)`

```
commandController(layer,op,parent) :990        [1 obj {resolve,get}]
resolve(call) :995
├─ ensureOpen; openSpan (→ undefined when obs OFF, 0 alloc); presetFor (parent-chain Map walk)
├─ readCall(op,call) :1021                      [1 obj]
├─ collectBorrows(op.depends) :1024             [1 array]; empty if no resource deps
├─ if borrowed.length: new Promise + settleBorrow   [1 Promise +1 closure]  ← only with resource deps
├─ buildDeps(op.depends,…) :1098                [1 deps obj]   ◄── HOT LOOP `for key in depends`
│    ├─ resource dep → defineLazyDep :1069      [getter closure]; build DEFERRED to first read
│    └─ else → resolveDep :695 → readCell / commandController (subflow) / resourceController (eager build)
├─ ctx {label,input,signal,defer,obs,log} :1030 [1 obj + defer closure; obs/log shared OFF consts when idle]
├─ result = op.run(deps,ctx) :1039
└─ track(result, asPrimary, onSettle) :1045     [~4 closures]
     ├─ SYNC (not thenable) → onSettle("ok") now        ← NO PROMISE :854
     └─ ASYNC → Promise.resolve(result).then(…); pending.add :858   [1 tracked Promise]
```

Sync no-dep resolve ≈ 6 small objects + ~4 closures, **zero promises**.

### 2. Resource resolve + build

```
resourceController(layer,res,parent) :1228      [1 obj — allocated EVEN on cache hit]
resolve() :1235
├─ resources.get(res) HIT → return value :1239  ◄ fast path (Map get, no build)
├─ builds.get(res) → inflight Promise :1241      async de-dup
├─ building.has(res) → CircularResource :1243
└─ buildResource :1133
   ├─ resolveResourceDeps → buildDeps(…,registerEdge) → addDependent on first lazy read  ◄ HOT LOOP
   ├─ ctx {…,defer} :1147
   ├─ result = res.factory(deps,ctx) :1164
   ├─ SYNC: resources.set(res,{value}); return :1165   ← NO PROMISE
   └─ ASYNC: finishAsyncBuild → Promise.resolve().then(publish,fail) :1205   [1 Promise]
```

A deep **sync** resource dependency chain recurses on the native JS stack (depth = chain length);
async chains move to the heap (safe).

### 3. Data read / write / watch

```
read  → readCell → effectiveEntry :548     effCache HIT = O(1) Map get; MISS walks parent chain then caches
write → writeCell :596
        ├─ admit(parse) :352
        ├─ eqOf(target)(…) :599            [1 closure PER WRITE]; equal ⇒ no notify
        ├─ ownCell (COW) :574              MISS: [1 Entry] + invalidateEff (RECURSES children)
        └─ flushTree :585                  RECURSES session-tree depth; per watcher read()+eq+fn   ◄ HOT LOOP
watch → addWatcher :645                    [1 Watcher + 1 unsubscribe closure]
```

### 4. Close / teardown — `close(opts)` → `closeLayer` → `startClose`

```
closeLayer(layer, !graceful) :1693
├─ layer.closing = startClose(layer,force) :1695
├─ closeWouldReenter? → best-effort Result now :1705   (re-entrant teardown ack, no self-wait)
└─ startClose :1742
   ├─ markSwept(layer) :1594                 SYNC at call time, ITERATIVE (deep trees safe)
   └─ Promise.resolve().then(run):
      ├─ if forced: abortSubtree :1607        ITERATIVE
      ├─ body = await classifyBody :1648
      ├─ await closeChildren(rollback) :1687  RECURSES per child, sequential await
      ├─ while(pending.size) await Promise.all :1754
      ├─ settleOutcome :1658
      ├─ await drainDefers :1625              ◄ INNER LOOP i=n-1..0 LIFO, await each
      ├─ settleOutcome again :1760            (monotonic re-settle)
      └─ finishLayer :1772                    detach; push swept errors up; ~13 map/set .clear()
```

Iterative (safe at depth): `markSwept`, `abortSubtree`, `collectAffected`, parent-chain reads
(`effectiveEntry`, `tagFind`, `ownerOf`). Recursive (depth-bounded): sync resource chain
(`buildResource↔resolveDep`), `flushTree`/`invalidateEff`, `closeChildren`.

## t19 budget targets (ranked)

1. **0 promises on the fully-sync resolve/build path** — already true (`track` short-circuits
   non-thenables :854; `buildResource` returns sync values directly). Lock it with a bench assertion.
2. **Allocations per resolve** — ~6 objs + ~4 closures on the minimal command path; candidates to hoist:
   `eqOf` (per write), the borrow `Promise` (only when an op has resource deps :1026).
3. **Per-dep cost** — `resourceController` allocates a `{resolve,get}` wrapper on every `resolveDep`
   incl. cache hits; `buildDeps` `for key in depends` is O(deps).
4. **Deep-chain stack ceiling** — add tests: 10k-deep **sync** resource chain, deeply nested sessions
   (`flushTree`, `closeChildren`); async chains should convert to heap and pass.
5. **Observation off ≈ free** — confirm the "off" path stays allocation-free (span = `undefined`,
   `obs`/`log` = shared consts); budget the "on" path separately (1 Span + event arrays per resolve).
6. **Close cost** — per-scope-teardown: `finishLayer` clears ~13 maps/sets; `drainDefers` LIFO-serial
   with an `await` between hooks; sequential `closeChildren` + pending join for wide/deep trees.
