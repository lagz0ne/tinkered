# Tinkered playground

Live at <https://playground.tini.works>. An in-browser playground for `@tinker/core` + `@tinker/react`,
and the **golden example** of an app built on them: every effect is a resource, every user action is
an operation, and the view only reads cells and runs operations ([ADR 0049](../../docs/decisions/0049-the-playground-is-the-golden-example-every-effect-a-resource-every-action-an-operation.md)).

Four views share one running game:

- **Play** opens first. Press a solid tile to raise a wave.
  Turn the board, start or stop a storm, and change wave
  height, speed, or the time between storm presses.
  Clear removes waves and stops the storm.
- **Code** opens a file search and source reader.
  Edit the ocean files; library and Sessions files are read-only.
  Follow a name with F12, Ctrl/Cmd-click, or Follow symbol.
  Back and Forward restore the file and cursor position.
  Alt+Left and Alt+Right work inside the editor too.
- **Sessions** shows Harbor and Beacon forms side by side.
  Edit both, then reset one field or the whole form.
  Leave a route and return to see what stays.
  Refetch a project brief without changing the other project.
  View source opens the real example in Code.
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
vp run core#build && vp run react#build
vp run playground#dev
vp run playground#build
```

Build the packages first; the app imports their `dist` files.
The dev command builds vendor files before starting Vite.
The app build writes the site to `apps/playground/dist`.

`scripts/build-vendor.mjs` produces what the preview iframe imports through its import map: the
library dists, React as browser ESM, and `esbuild.wasm` — checked against the esbuild-wasm JS version
so a mismatch can never ship.
The vendor step copies each entry and every local file it imports.
It follows nested imports, re-exports, and dynamic imports.
It leaves bare imports for the import map and skips unused files.

## The shape (read this before changing it)

- **`src/main.tsx`** creates the scope and starts services.
- **`src/state.ts`** declares config tags and shell cells.
- **`src/actions.ts`** declares shell operations.
- **`src/compiler.ts`** owns esbuild-wasm and compilation.
- **`src/services.ts`** owns persistence, the bundle watcher,
  and preview messages; each uses `defer` for cleanup.
- **`src/errors.ts`** is the error registry.
- **`src/App.tsx`** reads cells and runs operations.
- **`src/bench/`** holds benchmark runners and the page.
- **`example/`** holds the default Tile storm modules.
- **`example/sessions/`** holds the separate form study.
- **`tests/`** checks model behavior through real scopes.

Rules of the house, from the ADR: no `useEffect` in the shell; no module-level state; config is a tag
a test can rebind; a resource's cleanup is a `defer`; a resource's value is the smallest shape its
consumer calls; a keystroke re-renders nothing but what changed. `src/` and `tests/` pass the strict
style census; `example/` is consumer code in the consumer idiom, like the repo's `examples/`.

```bash
vp run playground#test
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
The Sessions source links to its model without changing
the editable ocean files.

The shell uses the game's ocean colors. New sessions start
with the One Dark editor theme; saved theme choices stay.

The tests prove these game promises:

- A press returns its hue and sends a rising wave outward.
- A new wave rises smoothly; slow waves settle before expiry.
- Turns ease at both ends and finish in 250 milliseconds.
- Live height settings change tile lift.
- Clear removes waves and stops the storm.
- Storm presses use the chosen time gap, including changes
  made while the storm runs.
- Turns move toward each new heading, past a full circle.
- Closing the scope cancels the frame loop.
- Bad action inputs fail through the error registry.

## Sessions study

Each project has one stable namespace, a key for its values.
An open route owns a session.
Its form owns a child session.
Reset form replaces that child; Leave route closes both.

The example proves these rules:

- Reset title keeps the notes and the other project's draft.
- Reset form clears both fields and aborts the old draft signal.
  It keeps the project brief.
- Leaving a route closes its form and aborts its signal.
  Returning creates a fresh draft with the same project brief.
  The other project's draft stays.
- Refetch brief builds a new brief for that project only.
  The other project's brief and both drafts stay.

The brief is built locally, with no network call or delay.
Its build number counts real resource builds.
One reader per project shows the result of its own refetch.
Leaving Sessions closes open forms; briefs stay until reload.

`example/sessions/index.ts` is the model's public test seam.
`tests/sessions.test.ts` uses real sessions, keys, and cleanup.
The source reader opens the example as read-only text.

## Deploy

The site is a static build baked into an nginx image and run as a Dokploy raw compose:

```bash
cd apps/playground
vp build
docker build -t tinkered-playground:latest .
```

Then redeploy the `playground` compose.

`nginx.conf` serves `.mjs` as `text/javascript` and `.wasm` as `application/wasm`, and never caches
`index.html`, so a redeploy shows at once.
