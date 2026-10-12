# 0112 Imports name a place, not a climb

Date: 2026-10-12. Status: accepted (user, 2026-10-12: "we should have setup the paths
similar to shadcn project"; "other than sibling, import should be using import paths";
"import sorting rules (split external and internal)").
Adds coding-convention rule 15.

## Context

Code reached other folders with `../` chains, such as `../../contracts/todos`.
A chain depends on where the importing file sits.
Moving a file breaks every chain in it and every chain to it.
The scaffold makes new files in set places, so it pays the same cost.

The precedent is shadcn.
Its `tsconfig.json` maps `@/*` to `./src/*`.
Its `components.json` names the folders with the same `@/` paths.
The scaffold already had both files; the code did not use them.

The second precedent is the import groups in eslint-plugin-perfectionist.
Oxfmt's `sortImports` is a port of it, so it runs inside `vp check`.

## Decision

- Each TypeScript project maps `@/*` to its `src/`.
- A sibling import stays `./name`. Every other import in the project is `@/path`.
- `import/no-relative-parent-imports` (oxlint) flags `../`.
- `sortImports` sorts into three groups, a blank line between them:
  packages, then `@/` paths, then `./` siblings.
  This is the Oxfmt default.
- A test imports the package entry as `@/index`. T04 and the census read
  `@/` as they read `../src/`.
- In the scaffold, a test may import any module.
  An app has no package entry, so T04 skips tests under `apps/*/tests/`.
- Scaffold code outside `src/backend` imports `@/backend/index.server`.
  - The barrel is internal: the app's `package.json` has no `exports`
    (user, 2026-10-12: exports expose "supposed to be internal" services).
  - Loading it loads every backend module.
    `check-imports` proves no driver loads on import.
  - No lint rule enforces it (user: "no reason to enforce that practice
    for no gain").
- The frontend has no barrel: a route imports `@/frontend/App`.
  A barrel there could pull every component into each route chunk.

The backend and frontend stay apart by Start's import protection.
It refuses a client import of any `.server.` file or `/backend/` path.
A barrel adds nothing to that.

## Where `../` stays

- Plain `.mjs` scripts: Node runs them with no `tsconfig`.
- `packages/start`: each app compiles Start's `src/` as its own code.
  There `@/` means the app's `src/`, so Start cannot use it.
- A second source folder next to `src/` (the playground's `example/`,
  blueprint's `tinker/`), and raw text read from another package.
- Trial fixtures keep the imports their runs recorded.

## Where ours is simpler

shadcn also has `@/components`, `@/lib`, `@/hooks` aliases.
We use only `@/`, because `@/components` is already `@/` plus a folder.
