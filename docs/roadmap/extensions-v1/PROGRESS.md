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
| core/t32 | `Scope.Extension`, `extensions` option, `start`/`close` chains, `scope.ready`, `resolve(ext)`, `NotSupported` | —        | [ ]    |
| core/t33 | the `resolve` chain (cells, resources, tags) — probes flat when unhooked                                      | t32      | [ ]    |
| core/t34 | the `run` chain (operation calls) — `op` probe flat when unhooked; short-circuit                              | t32      | [ ]    |
| core/t35 | the `write` chain (cell sets) — probe flat when unhooked; a refused write leaves the cell                     | t32      | [ ]    |
| sync/t06 | `source()` + `subscribe(transport)` as extensions; readiness = the initial data set; recipe + README          | t32      | [ ]    |

### Landed

| tag | sha | tests | size (B gzip) | mutation | probes (before → after) | notes |
| --- | --- | ----- | ------------- | -------- | ----------------------- | ----- |

### Impact blocks (ADR 0047)

Blocks list `src/` and `tests/` files only (examples live outside the package index).

```impact core/t32
core  createScope   src/index.ts tests/index.test.ts
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
