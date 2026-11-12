# Tinker site

The Tinker site: the guide and the playground in one app.
It replaces `apps/website` and `apps/playground`.

It is a tinker-app template app on the workspace packages.
Bun runs the server and the socket.
Vite bundles the page.
The build is one binary.

## Run

```bash
bun run dev    # Vite + bun --hot
bun run check  # tsc, tests, build, checks
bun run build  # page bundle, then one binary
bun run start  # the built server
```

## Pages

- `/`, `/guide/<slug>`: the guide, over rpc.
- `/llms.txt`, `/llms/<slug>.md`: the guide
  for agents, as plain markdown.
- `/play`: the playground. esbuild-wasm
  compiles the tabs in the browser; a frame
  runs them.
- `/live?room=<name>`: the playground's ocean,
  shared. Two frames of `/sea.html` (its own
  cmd, `cmds/sea.tsx`) on one room.
  `tide({ room })` sends each press to the
  server; every tab in the room lands it.
- `/bench`: @tinkered/react against other
  stores, in the visitor's browser.

## Play's vendor files

`bun run vendor` writes `public/vendor/*.mjs`
and `public/esbuild.wasm`. The preview's
import map loads one React, one Core and zod
from there. Build and dev run it first.

## Layout

- `cmds/`: the seams. Each one is a top-level
  `createScope({ capsules })`.
- `src/`: the site's features (`@/`).
- `tinker/`: the template base (`~/`), from
  tinker-app 0.24.6 (`tinkerApp` in package.json).

## Rules

The template's rules hold here:

- Config is a capsule key, filled by a cmd.
- Every function is an operation
  (`bun run check:plain`).
- No `useEffect`, `useState` or `useReducer`.
- The page talks to the server through rpc
  and remote data only.
