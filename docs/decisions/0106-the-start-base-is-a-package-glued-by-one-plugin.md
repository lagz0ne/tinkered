# 0106 The Start base is a package, glued by one plugin

Date: 2026-10-06. Status: accepted (user, 2026-10-06, after the POC, stress test, and hardening; card `start/base`).
Hardened by card `start/base-harden`: named files, build-start
checks, and ten doctor checks, from four stress tests.
Refines: 0100, 0101. Uses: 0050, 0065, 0099, 0102, 0103.
Replaces: the `runtime` copy-in item
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

`tinker(options)` returns the Start and React plugins,
and Tailwind's when the app installs `@tailwindcss/vite`,
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
- Aliases: `@` to `src`, and the `#tinker/*` names below.
- Dev and `tinker serve` load `.env` into `process.env`;
  a value set in the shell wins.
  `HOST` and `PORT` set the address, for preview too.
- `tinker({ prerender, pages, spa, sitemap })` passes
  these Start options on.
  Any other key fails the build: no option drops in silence.
- At build start it runs doctor's build-start checks,
  then the app's own `tsc` (see Doctor).
- In dev it restarts the server when the shell,
  a named file, or a seam file is added or removed,
  and reads `.env` again.
- Under Vitest it adds the aliases and Start's plugin,
  so a test has the route tree with no build.
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
      "@/*": ["/app/src/*"],
      "#tinker/app": ["/app/src/lib/tinker.ts"],
      "#tinker/start": ["/app/src/start.ts"],
      "#tinker/routes": ["/app/.tinker/routeTree.gen.ts"]
    }
  },
  "include": ["../src", "../tests", "./routeTree.gen.ts"]
}
```

`include` also lists `../vite.config.ts` and `../vite.config.mts`,
so the build's `tsc` checks the Vite config too.

Every path is absolute; `/app` stands for the app folder.
shadcn reads `paths` with tsconfig-paths,
which resolves an extended file's paths from the app folder,
so a relative `../src/*` sent its writes one folder up.
`.tinker/` is gitignored, so a machine path is fine.

A missing seam or named file maps to the base's default,
such as `node_modules/@tinker/start/src/defaults/start.ts`.
`tinker.d.ts` pulls in the base's type registers
for the router and Start, as Nuxt's generated `nuxt.d.ts` does.
`base.json` records the base version, `{ "base": "0.2.0" }`.
Doctor's check 3 compares `.tinker/` with what this base
would write, so it needs no stored hashes.

### The seam

The base reads app code only through these names:

- `#tinker/app` → `src/lib/tinker.ts`, a seam file.
- `#tinker/app.server` → `src/lib/tinker.server.ts`,
  a seam file.
- `#tinker/router` → `src/router.ts`, a named file.
- `#tinker/start` → `src/start.ts`, a named file.
- `#tinker/server` → `src/server.ts`, a named file.
- `#tinker/style` → `src/style.css`, a named file.
- `#tinker/routes` → `.tinker/routeTree.gen.ts`.
- `#tinker/parts` and `#tinker/parts.server` →
  `.tinker/parts.ts` and `.tinker/parts.server.ts`.

The shell, `src/routes/__root.tsx`, is the fifth named file.
It is a route, so it mounts as the root route, not by alias.

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
3. **A named file**: a fixed list the glue picks up,
   each with a base default. See Named files below.
4. **A plugin option**: `tinker({ telemetry, auth, sync })`,
   and Start's `prerender`, `pages`, `spa`, `sitemap`.
   Turning a part off frees its route path for the app.
5. **None fits**: a Start row in `docs/roadmap/core-feedback.md`.
   The base grows an extension point in a later version.

There is no file overlay and no eject.
A user edit inside `node_modules/@tinker/start` is refused:
`doctor` fails on it, and `upgrade` stops on it.

### Named files

The glue picks up exactly these five app files,
and nothing else:

- `src/router.ts`: router options, as `router`.
- `src/start.ts`: global middleware and `defaultSsr`,
  as `startInstance`.
  The base's CSRF and request middleware run first.
- `src/server.ts`: a custom server entry,
  as its default export.
- `src/routes/__root.tsx`: the page shell.
  It must render `<Outlet />`,
  and link `src/style.css` when that file exists.
- `src/style.css`: the stylesheet the base shell links.
  Tailwind runs when the app installs `@tailwindcss/vite`.

This is not an overlay: no other base file can be replaced.
Start's other usual files, such as `src/router.tsx`,
`src/client.tsx`, and `src/routeTree.gen.ts`,
fail the build with doctor's message.
So no file is ignored in silence.

`src/router.ts`, filled in:

```ts
import type { RouterOptions } from "@tinker/start";
import { NotFound } from "./frontend/not-found.tsx";

export const router: RouterOptions = () => ({
  defaultPreload: "intent",
  defaultNotFoundComponent: NotFound,
});
```

The function gets the route tree, for route masks.
The base sets its own error and 404 pages first;
these options replace them.

`src/server.ts`, filled in:

```ts
import { createServerEntry } from "@tinker/start/server";

export default createServerEntry({
  async fetch(request, next) {
    const response = await next(request);
    response.headers.set("x-app", "1");
    return response;
  },
});
```

`next` is the base's handler, which owns the root scope.
Start's own `server-entry` would skip that scope,
so doctor refuses it in `src/`.

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

The rule (user, 2026-10-06): every known mistake
either fails the build, or `tinker doctor` names
what is wrong and where, as a file and a line.

`tinker doctor` prints one line per check:
`ok`, `skip`, `fail`, or `fixed`.
Under it, one line per finding.
It exits 1 on any `fail`.

`--fix` writes only base-owned and generated things:
the `.gitignore` lines, the tsconfig `extends` key,
the `postinstall` script, `.tinker/`, and base bytes.
It never edits `src/`, the Vite config, or `.env`.

- It inserts the `extends` key and the `postinstall` script,
  and keeps every other byte of those files:
  comments, trailing commas, indent, line ends,
  and a byte order mark.
- An `extends` array that holds `./.tinker/tsconfig.json` passes.
  `--fix` puts that file first in the array, or turns a single
  other file into a two-item array; it never drops a file.
- It never writes a file that does not parse.
  Doctor names the parse error at its line instead.
- `tsconfig.json` is read as tsc reads it (JSONC).
  `package.json` and `components.json` are strict JSON,
  as npm and shadcn read them.
  TypeScript 7 ships no JS config reader,
  so the base uses `jsonc-parser`, VS Code's JSONC parser.

Each check is one small file with its message table,
`lib/checks/<name>.mjs`:

1. **base version**: `@tinker/start` resolves,
   its peers match the versions it was tested with,
   and each exact pin in `package.json` is what is installed.
   No fix yet: it prints the drift at its `package.json` line.
2. **base bytes**: every installed base file matches
   the hashes in the package's `files.json`.
   This is today's `flight-scaffold.mjs`, moved into the base.
   It also catches a route-generator rewrite.
   `--fix`: restore the bytes from the app's tarball.
3. **generated folder**: `.tinker/` matches this base.
   The route tree lists every route file that exports `Route`,
   and imports no base folder that moved.
   `.gitignore` lists `.tinker/` and `.tanstack/`.
   While check 7 fails, each line says to fix check 7 first.
   `--fix`: rewrite `.tinker/`, add the ignore lines,
   and run `tinker prepare` for the route tree.
4. **glue**: the Vite config (`vite.config.ts`, `.mts`,
   `.js`, or `.mjs`), parsed, imports `tinker`
   and calls it once, under the name it is imported as,
   with no `tanstackStart()` and no `@tailwindcss/vite`.
   `tsconfig.json` extends `./.tinker/tsconfig.json`
   and sets no `paths` and no `strict: false`.
   `postinstall` runs `tinker prepare`.
   `--fix`: the `extends` line and the `postinstall` script.
5. **named files**: each named or seam file exports
   what the base reads,
   and no Start file sits where the glue never reads it.
   An `export *` from a local file is followed;
   from a package, the export is not judged. No fix.
6. **imports**: app code reaches the base only through
   its entries: no `#tinker/*` name, no path into the package,
   no `@tanstack/react-start/server-entry`.
   This is the reverse of `check-seam.mjs`. No fix.
7. **routes**: `src/routes/` exists,
   each route file exports `Route`,
   its `createFileRoute` path matches the file,
   a user shell renders TanStack's `<Outlet />`,
   and no route takes or nests under a base path,
   in any of six forms. No fix.
8. **style**: a user shell imports `src/style.css`
   with `?url`, read from its import lines,
   no stylesheet sits unlinked,
   Tailwind's packages are there when the stylesheet imports it,
   and `components.json` aliases land in `src/`. No fix.
9. **env**: each key `.env.example` lists is set
   in `.env` or the shell.
   No fix: doctor never writes a secret.
10. **boundary**: each import boundary violation
    the last build kept in `.tinker/violations.json`.
    Start's own error stops at the first one. No fix.

Doctor's messages, check by check:

- [`poc/PROOF.md`](../../poc/PROOF.md), section 2.

`check-plain.mjs` (ADR 0099) joins doctor
when `apps/start-scaffold` moves (migration step 2).
`check-schema.mjs` belongs to the Postgres example
and moves with it.

### TanStack's generator writes src/

TanStack's route generator writes app files.
It rewrites a `createFileRoute` path
that does not match its file,
and it fills an empty route file with a template.
The installed generator (1.167.40) has no option
that turns this off.
So the base keeps it away from `src/` where it can:

- Check 7 names a wrong path and an empty file first.
- `vp build` runs doctor's build-start checks
  before the generator, and stops on them.
- `tinker prepare` and `doctor --fix` skip the generator
  while check 7 fails, and print check 7's lines.
- Only `vp dev` still runs it over such a file.
  That is TanStack's dev feature: a new empty route file
  gets its template.

### Build-start checks

`vp build` checks in two steps.
First, before TanStack's generator runs,
`tinker()` runs checks 5 to 8.
A fail stops the build with doctor's own line:

```text
tinker doctor, routes:
  src/routes/index.tsx:18 does not export Route;
  TanStack skips the file, so / is a 404
vp build: EXIT 1
```

Then, at build start, after the generator wrote the route tree,
it runs the app's own `tsc`.
Vite strips types without checking them,
so a wrong `<Link to>` used to ship:

```text
tsc found 1 type error(s); the build stops here:
src/routes/nav.tsx:2:71 TS2820 Type '"/tinkr"'
  is not assignable to type '"/" | "/tinker" | …'
vp build: EXIT 1
```

- Checks 1 and 4 only warn: the build still works.
  A second `tinker()` or a `tanstackStart()`
  in `vite.config.ts` is the exception: it stops the build,
  because Start would fail later with no cause.
- `tsc` reads the Vite config too,
  so a `tinker()` option of the wrong type stops the build.
- `tinker prepare` exits 1 when check 7 fails
  or the route tree stays stale, with doctor's lines.
  As the `postinstall` script it prints them and exits 0,
  so a fresh clone of a broken app still installs
  and can run doctor.
- The boundary record (check 10) starts empty only when
  a real build starts and its checks pass.
  Loading `tinker()` never wipes it.
- Checks 2, 3, 9, and 10 stay in doctor.
  They read installed bytes, generated files,
  the run-time env, or the last build.
- A build that fails on Start's import protection
  keeps every violation for check 10.

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

### Three ways to update

The base, the app template, and the examples
update in three different ways:

- **base**: `tinker upgrade <version>`.
  The package is replaced whole; `src/` is never written.
- **app template**: written once,
  by `shadcn add <url>/app.json` in an empty folder.
  Never re-applied.
  `--overwrite` is all or nothing per item:
  in the stress test it dropped 9 dependencies
  and moved `@tinker/start` back to an older version.
- **examples**: copied once by `shadcn add @tinker/<item>`.
  The app owns them.
  To see a newer one, run
  `shadcn add @tinker/<item> --diff` and merge by hand.

### Testing the base

The user, 2026-10-06:

> testing should not rely on framework (otherwise we are
> testing framework glue code). That's why we test unit tests
> (the glue, like readResults) and mostly test following
> tinkerer rules by using scope as test seams.

- The glue is tested as plain functions:
  tsconfig and alias output, the named-file pick-up,
  route-path clashes, each doctor check over a fixture folder
  (pass, each fail with its exact message, and `--fix`),
  the build-start checks, tsc output,
  `tinker serve`'s file rule, `.env` loading,
  and upgrade's version pins.
- Base behavior that runs as operations or resources
  is tested through a scope, with `createScope` and `settle`:
  `readResult`, the health operation, the `env` tag,
  the start extension, and the response body owner.
- No test runs `vp build`, `vp dev`, a TanStack runtime,
  a browser, or a served page.
  "The build fails with doctor's message" is tested
  by calling `buildChecks`, the function `tinker()`
  calls at build start.
- Builds, served pages, curl, and browser checks
  are proofs, in `poc/PROOF.md`. A script may run them.

### Not supported

Five things stay out of reach, each with its reason
(the stress reruns, `poc/PROOF.md` section 8):

- **A route whose loader calls a server function,
  rendered in a unit test with no build.**
  TanStack needs its request context there.
  Test the operation through a scope;
  prove the route with a build.
- **No error text in the page data in production.**
  The base's error page shows none,
  and the server log gets the error,
  but TanStack sends a loader's error to the browser.
- **Byte-identical builds from another folder.**
  Module ids are paths, and Start's server manifest
  keeps each route file's absolute path.
- **An example route as a shadcn `registry:page`.**
  shadcn maps page targets only for other frameworks;
  examples use `registry:file`.
- **Re-applying the app template**, by design (above).

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
- The base reads the app through two seam files
  and five named files; the app reads the base
  through its entries. Both are checked.
- Every known mistake fails the build,
  or doctor names it with a file and a line.
  Each build pays one `tsc` run for it.
- A usual Start file in the wrong place fails the build,
  so a Start user's habit gets a message, not silence.
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
   - A (pick): extension points and five named files only.
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
