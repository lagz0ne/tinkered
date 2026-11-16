# 0160 A page build refuses server code, and app code has no barrel

Date: 2026-11-16. Status: accepted (Duke, 10:40
UTC, option C).
Adds to: ADR 0156 (`tinker check`).
Replaces: the "Start's import protection" part of
ADR 0112, and the feature door of the template.

## What the user said

- 10:07: "stay safe from wrong import that may
  break browser only build".
- 10:10: "more complex reexport might include
  that by accident ... That leads to banning of
  barrel export (which also to me a very anti
  pattern)".
- 10:40: picked "Graph guard + ban barrels".

## Context

Seven scratch page builds gave the proof.

- A barrel `export * from "./db.server"` put
  `readFileSync` in the page bundle. The build
  passed.
- A direct import of `./db.server`, with no
  barrel, did the same.
- So the cause is not the barrel. The page build
  does not know which files are server code.

ADR 0112 said Start's import protection refuses a
page import of a `.server.` file. The template
left Start for a plain Vite page. Nothing refuses
it now.

Release 0.29.3 put a `browser` export condition on
`@tinkered/entry/cmd` and `/server`. That guards
only this one package.

The known models:

- TanStack Start import protection: a bundler
  plugin refuses `.server.` files in the client.
- SvelteKit `$lib/server`: the bundler refuses a
  server module anywhere in the client graph.
- Next.js `server-only`: a marker module poisons
  every client path to it.

Each one walks the module graph in the bundler.
So the depth of a re-export does not matter.

## Decision

1. The page guard is a Vite plugin:
   `pageGuard()` from `@tinkered/cli/vite`.
2. It runs only where the page is built: the
   client environment, in dev, in the build, and
   in browser tests.
   - A browser test that runs the server in the
     page on purpose leaves the guard out.
   - The template does that: it adds the guard
     only when `process.env.VITEST` is unset.
3. It refuses a module in the page graph when:
   - its path has a `.server.` part;
   - its name starts with `bun:` or `node:`;
   - it is `@tinkered/entry` or one of its
     entries;
   - it is `@tinkered/bun`, or an entry of it
     other than `/client`.
4. The build error names the import and the file
   that holds it:

   ```text
   page imports server code "./db.server"
   from src/todo/barrel.ts
   ```

5. `import type` is erased before the bundler
   resolves anything, so the guard never sees it.
6. Later, `tinker dev` and `tinker build` add the
   plugin themselves. Until then the app's
   `vite.config.ts` adds it.
7. App code has no barrel. A new `tinker check`
   rule, `tinker/barrel`, finds in `src` and
   `cmds`:
   - `export … from "…"`;
   - `export * from "…"`;
   - `export { name }` of an imported name.
8. Type re-exports count too. A barrel of types is
   still a barrel.
9. A file may still export what it declares. A
   feature's capsule stays in its own file.
10. So the template's feature door goes. A route
    imports `@/todo/todo-list`, not `@/todo`. The
    lint rule "import a feature by its door" goes
    with it.

## Where ours is simpler

- One plugin, no marker module to install.
- The mark is the file name, as in Start.
- No list of allowed modules per app.

## What it costs

- Hedl and acountee have feature doors. Each gets
  `tinker/barrel` findings. They move on their own
  card.
- `apps/site` had 10 findings. Card
  `cli/page-guard` moved it: each import names the
  file that declares it, and the door lint is gone.
- An import path names a file, so a file move
  changes its importers. `@/` paths keep that
  change to one line each (ADR 0112).
