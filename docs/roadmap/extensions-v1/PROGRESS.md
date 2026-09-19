# extensions v1 — build progress

Extensions are middleware on the scope's verbs; the composition root installs them; `scope.ready`
awaits every start (ADR 0050). Core tickets first (start + close, then one verb per ticket), then
sync adopts them.

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
| core/t35 | the `write` chain (cell sets) — probe flat when unhooked; a refused write leaves the cell                     | t32      | [ ]    |
| sync/t06 | `source()` + `subscribe(transport)` as extensions; readiness = the initial data set; recipe + README          | t32      | [x]    |

### Landed

| tag      | sha     | tests | size (B gzip) | mutation | probes (before → after)                                                                                                            | notes                                                                                                                                                              |
| -------- | ------- | ----- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| core/t32 | 66bcea7 | 239   | 22128         | 78.47    | create 176→169, warm 29.2→29.2, op 100.9→101.1, opres 330→327, cold 695→711, session 1617→1633 (pinned, min of 3, A/B alternating) | writer-built, one fix round (handle literal restored; cold-path `extendHandle`). Follow-up in t33: `exts` off the Layer record; extract only the resolve dispatch. |
| sync/t06 | 6409128 | 21    | 4066          | 62.34    | — (no core change)                                                                                                                 | `source()`/`subscribe(transport)` as extensions; ready = the initial data set; `SyncNotReady`; `fail()` in the registry. Writer-built, one fix round.              |
| core/t33 | 1810c85 | 246   | 22394         | 78.62    | t32 → t33 (pinned, min of 3): create 168.6→169.3, cold 716.7→707.0, session 1623→1587, op 101.9→100.9                              | `resolveThrough` onion on the root handle; records in a WeakMap off the Layer; the dispatch extraction measured and reverted. Writer-built, no fix round.          |
| core/t34 | 761f4a5 | 253   | 22635         | 78.72    | t33 → t34 (pinned, min of 3): op 101.1→100.9, run 112.4→112.3, opres 328.5→328.7, create 168.5→168.9                               | `runThrough` onion on the root handle; innermost `next` = the plain `run`; `handleFor` untouched. Writer-built, no fix round.                                      |

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
core  rejectUnwired  src/index.ts
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
