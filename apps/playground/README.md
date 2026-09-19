# Tinkered playground

Live at <https://playground.tini.works>. An in-browser playground for `@tinker/core` + `@tinker/react`,
and the **golden example** of an app built on them: every effect is a resource, every user action is
an operation, and the view only reads cells and runs operations ([ADR 0049](../../docs/decisions/0049-the-playground-is-the-golden-example-every-effect-a-resource-every-action-an-operation.md)).

Two views, toggled in the bottom bar:

- **Editor** — a multi-file project compiled in the tab by esbuild-wasm and rendered live in a preview
  iframe. The default project, _Ripples_, is a tile game written the same way as the shell.
- **Benchmark** — `@tinker/react` against Zustand, Jotai, Legend State v2/v3, Preact Signals, a naive
  React Context baseline and a bare `useState` control, every competitor in its source-audited best
  configuration, interleaved sampling, median ± IQR.

## Run it

```bash
vp install
vp run core#build && vp run react#build   # the app imports the workspace packages from dist
vp run playground#dev                     # builds the vendor bundles, then vite dev
vp run playground#build                   # static site in apps/playground/dist
```

`scripts/build-vendor.mjs` produces what the preview iframe imports through its import map: the
library dists, React as browser ESM, and `esbuild.wasm` — checked against the esbuild-wasm JS version
so a mismatch can never ship.

## The shape (read this before changing it)

```
src/main.tsx      composition root — creates the scope, resolves the services, renders
src/state.ts      tags (storage, entry, debounce) and cells (files, active, theme, view, dirty, status, bundle)
src/actions.ts    operations for every user action: editFile addFile closeFile renameFile selectFile setTheme setView reset
src/compiler.ts   the `compiler` resource (esbuild-wasm, booted once) and the `compile` operation
src/services.ts   effect resources: persistence, bundler, runtime — each torn down by `defer`
src/errors.ts     the error registry (InvalidInput, CompileFailed)
src/App.tsx       the view: components read exactly the cells they render, run operations, hold no effects
src/lib/files.ts  the default project (the Ripples example) as editor tabs
src/bench/        the benchmark runners (audited per library) and page
```

Rules of the house, from the ADR: no `useEffect` in the shell; no module-level state; config is a tag
a test can rebind; a resource's cleanup is a `defer`; a keystroke re-renders nothing but what changed.

## Deploy

The site is a static build baked into an nginx image and run as a Dokploy raw compose:

```bash
cd apps/playground && vp build && docker build -t tinkered-playground:latest .
# then redeploy the `playground` compose (see memory: dokploy-static-deploy-pattern)
```

`nginx.conf` serves `.mjs` as `text/javascript` and `.wasm` as `application/wasm`, and never caches
`index.html`, so a redeploy shows at once.
