# 0106 The Start base is a package, glued by one plugin

Date: 2026-10-06. Status: proposed (lead, card `start/base`).
Refines: 0100, 0101. Uses: 0050, 0065, 0099, 0102, 0103.
Replaces, once accepted: the `runtime` copy-in item
(`docs/roadmap/start-scaffold/REGISTRY.md`).

## Context

Today the Start base ships shadcn-style.
The registry item `runtime` copies 32 files into the app's `src/scaffold/`.
A fresh app has 79 files in `src/`:

- 32 base files in `src/scaffold/`.
- 7 install-only entry files that hold base logic:
  `server.ts`, `router.tsx`, `start.ts`, `client.tsx`,
  `routes/api.sync.ts`, `routes/api.telemetry.ts`,
  `transport/routes.server.ts`.
- 40 example files: counter, todos, profile, auth, mail, sync bodies.
  Three of them are base logic too: `routes/__root.tsx`,
  `routes/api.auth.$.ts`, `transport/result.server.ts`.

An upgrade re-copies `runtime` with `--overwrite`, after a `--diff` dry run.
Entry files are install-only, so each contract change is a hand edit
that the README spells out ("Move from setup contract 3 to 4").
The writer trial hashes `src/scaffold/` byte by byte,
because the base sits in the writer's own tree.

The user, 2026-10-06:

> we'll want to treat the scaffolding, let's call it a base, in a setting
> that'll be outside of the userland, and the tsconfig/vite config magic
> will glue things together. Upgrading/sync to source should be as easy
> as it goes rather than fighting with what's in and not.

> the goal is after the setup, doctor should be easy, and the userland
> should be as little as possible to get value

## Precedents

- **shadcn registry** (CLI 4.21.0).
  It copies files in, and you own them.
  `add --diff` and `--dry-run` preview; `--overwrite` replaces.
  There is no install record and no three-way merge.
  shadcn already splits this way for its own base:
  its CSS ships in the package (`@import "shadcn/tailwind.css"`),
  and `shadcn eject` copies it in, one way.
  - Borrow: examples stay copy-in. They are yours from day one.
  - Drop for the base: a copied file you must never edit
    is a package with extra steps.
- **Nuxt layers.**
  `extends: ["@org/layer"]` loads a layer from npm, a path, or git.
  Nuxt writes `.nuxt/tsconfig.*.json`; the app's tsconfig points at
  them, and nobody edits them.
  A project file at the same path as a layer file wins.
  An upgrade is a version bump.
  - Borrow: the base as a package, a generated tsconfig,
    and `#` aliases for the base's reads of app code (Nuxt's `#build`).
  - Simpler: one base, no layer stack, no override by path.
- **Expo.**
  `expo-doctor` checks config, versions, and project health.
  `expo install --check` exits non-zero on version drift;
  `--fix` repairs it.
  Continuous native generation: `expo prebuild` writes
  `android/` and `ios/`, which are gitignored and changed only
  through config plugins.
  - Borrow: `doctor`, a `--fix` limited to versions and generated
    files, a gitignored generated folder, and extension points
    instead of edits.
- **create-react-app.**
  Config lives in the `react-scripts` package; an upgrade bumps it.
  `eject` copies it in, one way: "you're on your own".
  - Borrow: the package. Avoid: eject.
- **TanStack Router virtual file routes** (generator 1.167.40).
  `router.virtualRouteConfig` takes `rootRoute`, `route`, `physical`.
  File paths are relative to `src/routes`;
  `../../node_modules/...` works (checked in a throwaway app).
  `physical("", ".")` keeps the app's file routes in the same tree.
  Two routes on one path stop the generator
  ("Conflicting configuration paths").
  The generator rewrites a mounted file whose route id does not match.
  - Borrow: base routes mount from the package with `route(path, file)`.
  - Rule: base route files ship with their exact mount id.
- **TanStack Start entries.**
  `router.entry`, `server.entry`, `start.entry`, `client.entry`
  each take a path relative to `src/`; bare package names
  and absolute paths do not resolve.
  The Start plugin crawls packages that peer on `@tanstack/react-start`:
  it leaves them unbundled and runs them through the Start compiler.
  So server functions and middleware inside the base compile.
- **TanStack intent.**
  Skills ship inside packages and update with them.
  The starter's `AGENTS.md` already loads Start's skills this way.

Where ours is simpler than all of them:
one base, three opt-in parts, no overlay, no eject.

## Decision

### Three owners

- **base**: the package `@tinker/start`, in `node_modules`.
  It ships TypeScript source, readable in place. It is never edited.
  An upgrade replaces it whole.
- **generated folder**: `.tinker/`, written by `tinker prepare`
  and by the Vite plugin. Gitignored. Never edited.
- **userland**: `src/`, `tests/`, `drizzle/`, and the config files.
  The base never writes here.

The word is "base"; code names still avoid the layer word `Base`.
So the package is `@tinker/start` and the plugin is `tinker()`.

### Before and after: a fresh app

Before (today's `starter` item):

```text
my-app/
  package.json  vite.config.ts
  vitest.config.ts  tsconfig.json
  components.json
  AGENTS.md  README.md  PLAIN.md
  .agents/skills/       5 skills
  scripts/              4 checks + serve
  tests/                12 files
  drizzle/              4 migrations
  src/
    scaffold/           32 base files
    server.ts           entry
    router.tsx          entry
    start.ts            entry
    client.tsx          entry
    routes/             7, 3 are base
    transport/          5, 2 are base
    lib/                2 seam files
    backend/            11 examples
    contracts/          5 examples
    frontend/           11 examples
    errors.ts style.css
    routeTree.gen.ts    generated
```

After (the smallest app):

```text
my-app/
  package.json        deps + scripts
  vite.config.ts      tinker()
  tsconfig.json       extends .tinker
  .gitignore          .tinker/
  AGENTS.md           points at skills
  src/
    routes/index.tsx  page + server fn
    backend/greet.ts  one operation
  .tinker/            generated
    tsconfig.json
    routeTree.gen.ts
    parts.ts
    parts.server.ts
    tinker.d.ts
    base.json
  node_modules/@tinker/start/
    src/              the base
```

After, with the todos example added:

```text
my-app/
  src/
    lib/tinker.ts         client seam
    lib/tinker.server.ts  server seam
    backend/  contracts/
    frontend/ routes/
    transport/ errors.ts
  drizzle/
  tests/
```

### The glue

Two config lines join an app to the base.

`vite.config.ts`:

```ts
import { defineConfig } from "vite-plus";
import { tinker } from "@tinker/start/vite";

export default defineConfig({
  plugins: [tinker()],
});
```

`tsconfig.json`:

```json
{ "extends": "./.tinker/tsconfig.json" }
```

`tinker(options)` returns the Start, React, and Tailwind plugins,
set up once:

- Start's four entries point into the base,
  by a path relative to `src/`.
- `router.generatedRouteTree` is `../.tinker/routeTree.gen.ts`.
- `router.virtualRouteConfig` mounts the routes of each
  enabled part, then the app's own `src/routes`:

  ```ts
  // what tinker({ sync: true }) passes on
  const dir = "../../node_modules/@tinker/start/src/routes";
  rootRoute(`${dir}/root.tsx`, [
    route("/api/telemetry", `${dir}/api.telemetry.ts`),
    route("/api/auth/$", `${dir}/api.auth.ts`),
    route("/api/sync", `${dir}/api.sync.ts`),
    physical("", "."),
  ]);
  ```

  The plugin computes each path from where the package resolves.
  When `src/routes/__root.tsx` exists, it replaces `root.tsx`.

- Import protection keeps today's rules.
  Start's default skips files under `node_modules`,
  so the plugin also denies the base's server entries
  as client specifiers.
- Aliases: `@` to `src`, and the five `#tinker/*` names below.
- Dev loads `.env` into `process.env`;
  `HOST` and `PORT` set the address.
- Under Vitest it adds only the aliases,
  and inlines `@tinker/start` so its source is transformed.
- It writes `.tinker/` the same way `tinker prepare` does.

The runtime entries ship as `.ts`, so Vite compiles them.
The plugin and the `tinker` command ship as `.mjs`,
because Node will not strip types under `node_modules`.

`.tinker/tsconfig.json` (generated; today's other
compiler options are left out here):

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["../src/*"],
      "#tinker/app": ["../src/lib/tinker.ts"],
      "#tinker/app.server": ["../src/lib/tinker.server.ts"],
      "#tinker/routes": ["./routeTree.gen.ts"],
      "#tinker/parts": ["./parts.ts"],
      "#tinker/parts.server": ["./parts.server.ts"]
    }
  },
  "include": ["../src", "../tests", "./"]
}
```

A missing seam file maps to the base's empty default.
`tinker.d.ts` pulls in the base's type registers
for the router and Start, as Nuxt's generated `nuxt.d.ts` does.
`base.json` records the base version, the plugin options,
and the hashes of the other generated files.

### The seam

The base reads app code only through five names:

```text
a base file
  |
  v
#tinker/app
  -> src/lib/tinker.ts
#tinker/app.server
  -> src/lib/tinker.server.ts
#tinker/routes
  -> .tinker/routeTree.gen.ts
#tinker/parts
  -> .tinker/parts.ts
#tinker/parts.server
  -> .tinker/parts.server.ts
```

This keeps today's two-seam rule (card `start/seam`);
only the names change.
The base's `package.json` has no `imports` field,
so the alias is the only way these names resolve.

App code reaches the base only through package entries:

- `@tinker/start`: shared units, such as `startRequests`,
  the sync types, and `Register`.
- `@tinker/start/server`: `readResult`, `httpRequest`, `env`,
  `eventHistory`.
- `@tinker/start/client`: `syncClient` and the client sync units.
- `@tinker/start/testing`: `requestHeaders`, `handleAuth`,
  `httpBackend`.
- `@tinker/start/vite`: `tinker()`.

The package's `exports` refuses every other path.

### Base parts

A part is an opt-in slice of the base, set in `tinker({ ... })`.

- **telemetry**: on by default. Route `/api/telemetry`.
  Needs nothing from the app.
  Reads `VICTORIA_TRACES_URL`, `VICTORIA_LOGS_URL`,
  `OTEL_SERVICE_NAME`; each has a default.
- **auth**: off by default. Route `/api/auth/$`.
  Needs `auth` and `readAccount` from the server seam.
- **sync**: off by default; it turns `auth` on.
  Route `/api/sync`; server functions `getBootstrap`, `getAccount`.
  Needs `database` and `bootstrap` from the server seam.
  Needs `records`, `readSnapshot`, `readBootstrap`, `readBatch`,
  `streamMessage`, and the `Register` bodies from the client seam.

The plugin writes `.tinker/parts.ts` and `.tinker/parts.server.ts`.
They export the enabled parts' extensions and router context;
the base entries install them.

### Settings and the server entry

The server entry moves into the base.
It is still the one entry that creates the roots (ADR 0100).
It binds the base tags and one new tag, `env`:
a copy of `process.env`, a fact the entry injects.
Each part reads its own keys from `env` and checks them once.
App settings become resources over `env`:

```ts
import { resource } from "@tinker/core";
import { env } from "@tinker/start/server";
import { z } from "zod";

const databaseEnv = z.object({
  DATABASE_URL: z.string().min(1),
});

export const databaseSettings = resource({
  label: "database.settings",
  depends: { env },
  factory: ({ env }) => ({
    url: databaseEnv.parse(env).DATABASE_URL,
    migrations: "drizzle",
  }),
});
```

The server seam exports `extensions`.
The entry installs them after the base's own:

```ts
// src/lib/tinker.server.ts (todos example)
import { databaseSetup } from "../backend/database.ts";

export const extensions = [databaseSetup];
export { database } from "../backend/database.ts";
export { auth, readAccount } from "../backend/auth.ts";
export { bootstrap } from "../backend/sync.ts";
```

`databaseSetup` is today's base `setup` extension,
which runs `migrate` at start.
It moves to the Postgres example, because migrations are the app's.
The auth example loads `tanstackStartCookies` in its own resource,
so the entry no longer names it.

### The smallest app

Two files. No base file, no seam file.

`src/backend/greet.ts`:

```ts
import { operation } from "@tinker/core";
import { z } from "zod";

export const greet = operation({
  label: "greet",
  input: z.object({ name: z.string().min(1) }),
  run: (_deps, { input }) => ({
    text: `Hello, ${input.name}.`,
  }),
});
```

`src/routes/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { startRequests } from "@tinker/start";
import { readResult } from "@tinker/start/server";
import { greet } from "../backend/greet.ts";

const runGreet = createServerFn({ method: "GET" })
  .middleware([startRequests.middleware])
  .handler(async ({ context }) =>
    readResult(
      await context.session.settle(greet, {
        input: { name: "world" },
        signal: context.signal,
      }),
    ),
  );

export const Route = createFileRoute("/")({
  loader: () => runGreet(),
  component: () => <p>{Route.useLoaderData().text}</p>,
});
```

What this gets: a page, a server function, and an operation
with its request session, cancellation, span, and log line.
Telemetry is on with no setup.

### Overrides: extension points, not file edits

When an app needs other base behavior, it uses, in this order:

1. **A tag binding**: settings, and test fakes
   such as `httpBackend`.
2. **A Core extension**: the `extensions` list of a seam file,
   installed after the base's own
   (ADR 0050: middleware on the scope's verbs).
3. **A named file**: a fixed list the base looks for,
   each with a default.
   The list is `src/routes/__root.tsx` (the page shell)
   and `src/style.css`.
   This is not an overlay; no other base file can be replaced.
4. **A plugin option**: `tinker({ telemetry, auth, sync })`.
   Turning a part off frees its route path for the app.
5. **None fits**: a Start row in `docs/roadmap/core-feedback.md`.
   The base grows an extension point in a later version.

There is no file overlay and no eject.
A user edit inside `node_modules/@tinker/start` is refused:
`doctor` fails on it, and `upgrade` stops on it.

### Upgrade

One command, no merge:

```text
tinker upgrade 0.7.0
  |
  v
doctor: do base bytes match?
  |-- no: stop; list edited files
  v yes
package.json: @tinker/start 0.7.0,
and the peer versions it was tested with
  |
  v
install, with the lockfile's
package manager
  |
  v
tinker prepare: rewrite .tinker/
  |
  v
tinker doctor
  |
  v
print UPGRADE.md, 0.6.0 to 0.7.0
```

- It never writes `src/`, `tests/`, or `vite.config.ts`.
- A seam change between versions shows as a type error
  or a doctor seam failure, with its `UPGRADE.md` step.
- Undo is git: restore `package.json` and the lockfile,
  then install again.
- Examples are userland, so an upgrade never touches them.
  To see a newer example, run `shadcn add <item> --diff`.

The command is `upgrade`, not `sync`.
In this repo, "sync" is the data sync (ADR 0048, the `sync` part).

### Doctor

`tinker doctor` prints one line per check: `ok`, `fail`, or `fixed`.
It exits 1 on any `fail`.

`--fix` writes only base-owned and generated things:
package pins and scripts, the `.gitignore` line,
the tsconfig `extends` line, `.tinker/`, and a base reinstall.
It never edits `src/`, the body of `vite.config.ts`, or `.env`.

1. **base version**: `@tinker/start` resolves,
   and its peers match the versions it was tested with:
   `@tinker/core`, `@tinker/react`, `@tanstack/react-start`,
   `@tanstack/react-router`, `vite-plus`.
   `--fix`: set the pins, then install.
2. **base bytes**: every installed base file matches
   the hashes in the package's `files.json`.
   This is today's `flight-scaffold.mjs`, moved into the base.
   It also catches a route-generator rewrite.
   `--fix`: reinstall the base.
3. **generated folder**: `.tinker/` matches the base version
   and the plugin options in `base.json`,
   and `.gitignore` lists `.tinker/`.
   `--fix`: run `tinker prepare`; add the ignore line.
4. **glue**: `vite.config.ts` calls `tinker()` once,
   with no second `tanstackStart()`.
   `tsconfig.json` extends `./.tinker/tsconfig.json`.
   Each base entry and `#tinker/*` name resolves,
   through the app's real Vite config,
   to the installed base or the expected app file.
   `--fix`: the `extends` line and the `postinstall` script;
   for `vite.config.ts` it prints the line to add.
5. **seams**: each enabled part finds the exports it needs.
   The message names the part, the file, and the export.
   No fix.
6. **imports**: app code imports the base only through
   its five entries, and never a `#tinker/*` name.
   This is the reverse of `check-seam.mjs`. No fix.
7. **routes**: no app route takes a path
   that an enabled part owns. No fix.
8. **plain**: `check-plain.mjs` on `src/`
   (ADR 0099, 0100, 0102, 0103).
   Its base exceptions key on the package path,
   not `src/scaffold/`. No fix.
9. **env**: each key an enabled part needs is in `.env`
   and passes its check, and `.env.example` lists it.
   No fix: doctor never writes a secret.

`check-boundary.mjs` proves browser imports fail the build.
It needs a build, so it runs in `tinker doctor --build`
and in the project's `check` script.
`check-schema.mjs` belongs to the Postgres example
and moves with it.

### Examples and the registry

- `runtime`: retired. Its 32 files become the package.
- `starter`: shrinks to the glue and docs:
  `package.json`, `vite.config.ts`, `tsconfig.json`,
  `.gitignore`, `.env.example`, `AGENTS.md`, `README.md`.
  The five skills move into the package and load through `intent`.
- `postgres-auth-mail-example`: splits into opt-in items,
  joined by `registryDependencies`:
  `postgres`, `auth`, `mail`, `counter`, `profile`, `todos`.
  An item that needs a part names it in `meta.parts`.
  If that part is off, `doctor` prints the plugin option to set.

### Writer trial

- The image packs `packages/start` the way it packs Core and React:
  `@tinker/start: file:./start.tgz`.
  The seed has no `src/scaffold/`.
- `scaffold.json` becomes `base.json`: the packed base's `files.json`.
- The gate runs the image's trusted `tinker doctor`, not the writer's.
  It covers base bytes, glue, imports, routes, and plain.
  The glue check catches a writer alias that shadows the base.
- `check:plain` is the same script, now inside the trusted base.
- Base files leave the writer's tree, so the Jev baseline list
  shrinks to the example files.
  Any S17 or S24 baseline findings in base files leave with them.
- This needs a new image tag; saved images keep their bytes.

### Migration for `apps/start-scaffold`

1. Add `packages/start` (`@tinker/start`).
   Move `src/scaffold/**`, the four entries, `scripts/serve.mjs`,
   the three base routes, `transport/routes.server.ts`,
   and `transport/result.server.ts`.
   Swap `@/lib/tinker*` for `#tinker/app*`,
   and `@/routeTree.gen` for `#tinker/routes`.
   `peerDependencies` names `@tanstack/react-start`.
2. Move the base proof tests (http, telemetry, sse, protocol,
   transport, waste, sync-client, tab-lifetime)
   and `check-seam.mjs`, `check-plain.mjs`, `check-boundary.mjs`
   into the package, with a fixture app
   like `maintain/fixtures/note-app/`.
3. Add `tinker()`, `tinker prepare`, `tinker doctor`,
   `tinker serve`, `tinker upgrade`.
   Proof: the two-file app builds, serves `/`, runs `greet`,
   and doctor exits 0.
   Also prove code splitting of base routes through a pnpm link.
   This is unverified: Vite may see the link's real path
   and skip splitting with no warning.
4. `apps/start-scaffold` becomes a consumer:
   `@tinker/start: workspace:*`, `tinker({ sync: true })`,
   settings as `env` resources, examples in `src/`.
5. Registry: retire `runtime`, shrink `starter`, split the examples.
   `check-registry.mjs` proves a clean install from packed tarballs,
   then an upgrade from base N to N+1 with `src/` hashes unchanged.
6. Writer trial: a new image tag with the packed base.
7. Docs: README, `AGENTS.md`, the skills.

Steps 1 and 4 change public names across packages,
so the lead writes an impact block first (ADR 0065).

## Consequences

- An upgrade is a version bump. Nothing in `src/` is merged.
- The smallest app is two files, with no base code in `src/`.
- The base reads the app through five aliases;
  the app reads the base through five entries. Both are checked.
- `packages/start` is a new package,
  with its own tests and mutation lane (floor 85).
- Base source stays readable in `node_modules`.
  But an upgrade's diff no longer shows in the app's git history;
  `UPGRADE.md` and the package diff replace it.
- The base cannot be edited in place.
  A missing hook waits for a base release.
- The route generator rewrites a mounted file whose id is wrong.
  Base route files ship with their exact mount ids,
  and doctor's base bytes check catches a rewrite.
- Settings move from one base reader to resources over `env`.
  Tests bind `env`, or preset one settings resource.

## Open questions

1. **Where the base lives.**
   - A (pick): an npm package in `node_modules`.
     Upgrade is a bump; the lockfile pins exact bytes;
     an edit cannot survive an install.
   - B: a committed `.tinker/base/` folder, synced by hash.
     Upgrade diffs show in the app's git,
     but we must write our own sync and refuse-on-edit logic.
   - Why A: there is no second copy to keep honest.
2. **When an app must change base behavior.**
   - A (pick): extension points and two named files only.
     Gaps become base releases.
   - B: also a Nuxt-style overlay:
     a file at `src/base/<path>` replaces that base file.
   - Why A: strict first (ADR 0099).
     An overlay hides which file runs, and doctor cannot check it.
     B can still come later.
3. **An escape hatch for the whole base.**
   - A (pick): no eject.
   - B: `tinker eject` copies the base into `src/`, one way,
     like CRA and `shadcn eject`.
   - Why A: eject ends upgrades;
     one ejected app forks the base for good.
