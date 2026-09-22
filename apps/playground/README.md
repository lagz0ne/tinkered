# Tinkered playground

Live at <https://playground.tini.works>. An in-browser playground for `@tinker/core` + `@tinker/react`,
and the **golden example** of an app built on them: every effect is a resource, every user action is
an operation, and the view only reads cells and runs operations ([ADR 0049](../../docs/decisions/0049-the-playground-is-the-golden-example-every-effect-a-resource-every-action-an-operation.md)).

Three views share one running game:

- **Play** opens first. Press a solid tile to raise a wave.
  Turn the board, start or stop a storm, and change wave
  height, speed, or the time between storm presses.
  Clear removes waves and stops the storm.
- **Code** opens a file search and source reader.
  Edit the example files; core and React files are read-only.
  Follow a name with F12, Ctrl/Cmd-click, or Follow symbol.
  Back and Forward restore the file and cursor position.
  Alt+Left and Alt+Right work inside the editor too.
- **Benchmark** compares `@tinker/react` with Zustand,
  Jotai, Legend State v2/v3, Preact Signals, React Context,
  and `useState`.

Full screen shows only the game and an exit button.
If the browser refuses full screen, the game fills the page.
Escape also leaves this mode when the game has focus.
Changing views or full-screen mode keeps the game alive.
Editing and rebuilding the example starts a new preview.

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
src/compiler.ts   the `compiler` resource — esbuild-wasm behind a one-call seam `{ bundle(entry, files) }` — and the `compile` operation
src/services.ts   effect resources: persistence, bundler (debounced on the ambient clock), runtime — each torn down by `defer`
src/errors.ts     the error registry (InvalidInput, CompileFailed, HarnessInvariant)
src/App.tsx       the view: components read exactly the cells they render, run operations, hold no effects
src/bench/        the benchmark runners (one documented function per audited library) and page
example/          the default project (Tile storm) as real modules — type-checked, loaded into the editor as text
tests/            the scope-level suite: a Map-backed `storage` tag, a preset `compiler`, a test clock — no React
```

Rules of the house, from the ADR: no `useEffect` in the shell; no module-level state; config is a tag
a test can rebind; a resource's cleanup is a `defer`; a resource's value is the smallest shape its
consumer calls; a keystroke re-renders nothing but what changed. `src/` and `tests/` pass the strict
style census; `example/` is consumer code in the consumer idiom, like the repo's `examples/`.

```bash
vp run playground#test                    # tests through a scope
```

## Game tests without a browser

`example/index.ts` exports the game state and actions.
A test creates a scope and binds `frames` to a hand-run
queue. `makeTestClock` supplies time; `random` supplies
repeatable storm targets and hues. No DOM or global
replacement is needed.

Source tests also prove that imports reach real declarations,
local names do not falsely jump to an import, and history
restores each file and cursor position in the right order.
Package sources stay out of the editable file set.

The tests prove these game promises:

- A press returns its hue and sends a rising wave outward.
- Live height settings change tile lift.
- Clear removes waves and stops the storm.
- Storm presses use the chosen time gap, including changes
  made while the storm runs.
- Turns move toward each new heading, past a full circle.
- Closing the scope cancels the frame loop.
- Bad action inputs fail through the error registry.

## Deploy

The site is a static build baked into an nginx image and run as a Dokploy raw compose:

```bash
cd apps/playground && vp build && docker build -t tinkered-playground:latest .
# then redeploy the `playground` compose (see memory: dokploy-static-deploy-pattern)
```

`nginx.conf` serves `.mjs` as `text/javascript` and `.wasm` as `application/wasm`, and never caches
`index.html`, so a redeploy shows at once.
