# POC proof: the Start base as a package

ADR 0106, picks 1a, 2a, 3a. Date: 2026-10-06.
Branch `start/base`.
Full logs: `proof/*.txt`, from real runs.
The blocks below are cut from them:
a line is left out or wrapped, and `…` marks a cut.

Two rounds:

- **0.2.0, the hardened base** (card `start/base-harden`):
  the 22 stress patches folded in. Sections 1 to 7.
- **0.1.x, the first POC**: the release proof.
  Kept below, unchanged; rerun it at commit `d524069f`.

## 1. Gates, 0.2.0

From the repo root, each by exit code:

- `vp install`: EXIT 0.
- `vp run -r build`: EXIT 0. It builds app-min too,
  and that build runs doctor's build-start checks and `tsc`.
- `vp check`: EXIT 0. 0 errors, 28 warnings, none in `poc/`.
- `vp run -r test`: EXIT 0.
  `poc/start-base`: 19 files, 92 tests.
- `vp run prose`: EXIT 0.

## 2. Doctor's checks and messages

`tinker doctor` prints a status line per check,
then one line per finding.
`--fix` writes only base-owned and generated files.
Each check is one file: `start-base/lib/checks/<name>.mjs`.
Its `say` table holds every message below.

### 1 base version

- `package.json:<line> <peer> is <found>, tested with <version>`
- `package.json:1 does not install @tinker/start; add it and install`

### 2 base bytes

- `node_modules/@tinker/start/<file> changed; an install drops base edits, so use an extension point`
  (also `missing`, `added`)
- `files.json is missing from the base`
- `--fix`: `restored <n> file(s) from <tarball>`,
  or `reinstall @tinker/start (<spec>) with your package manager`
- `skip` on a workspace link: no pinned bytes.

### 3 generated folder

- `.tinker/ is missing; run tinker prepare`
- `.tinker/<file> is stale; run tinker prepare`
- `.tinker/routeTree.gen.ts is missing; run tinker prepare`
- `.tinker/routeTree.gen.ts misses src/routes/<file>; run tinker prepare`
- `.tinker/routeTree.gen.ts:<line> imports <path>, which does not exist; run tinker prepare`
- `.gitignore does not list .tinker/` (and `.tanstack/`)
- `this tinker is base <a>, the app resolves <b>; run the app's own tinker`
- `--fix`: `ran tinker prepare; added <lines> to .gitignore`

### 4 glue

- `vite.config.ts is missing; add one with plugins: [tinker()]`
- `vite.config.ts:1 does not import tinker from "@tinker/start/vite"`
- `vite.config.ts:<line> calls tinker() <n> times; call it once: plugins: [tinker()]`
- `vite.config.ts:<line> adds tanstackStart(); tinker() adds it already`
- `vite.config.ts:<line> imports @tailwindcss/vite; tinker() adds Tailwind already`
- `tsconfig.json:1 does not extend "./.tinker/tsconfig.json"`
- `tsconfig.json:<line> sets compilerOptions.paths; it replaces the base's #tinker/* and @/* paths, so remove it`
- `tsconfig.json:<line> turns strict off; the base's files need strict`
- `package.json:1 has no "postinstall": "tinker prepare"; a fresh clone has no .tinker/`
- `--fix`: `wrote the extends line in tsconfig.json and the postinstall script in package.json`

### 5 named files

- `<file>:1 does not export <name>; the base imports it from this file`
- `<file>:1 is a Start file the base does not read; <where its job went>`,
  for `src/{router,start,server,client}.{ts,tsx,js,jsx}`
  not picked up, and `src/routeTree.gen.ts`.

### 6 imports

- `<file>:<line> "#tinker/…" is a base-only name; app code cannot import it`
- `<file>:<line> "@tinker/start/…" is not a base entry; use @tinker/start, @tinker/start/server, or @tinker/start/vite`
- `<file>:<line> "<path>" reaches into the base by path; use a base entry`
- `<file>:<line> "@tanstack/react-start/server-entry" skips the base's scope; use createServerEntry from @tinker/start/server`

### 7 routes

- `src/routes/ is missing; create src/routes/index.tsx`
- `<file>:<line> does not export Route; TanStack skips the file, so <path> is a 404`
- `src/routes/__root.tsx:<line> sets component without <Outlet />; no page renders inside the shell`
- `<file>:<line> takes <path>, a base route`
- `<file>:<line> nests under <path>, a base route with no outlet; the base page renders`

### 8 style

- `src/routes/__root.tsx:1 replaces the base shell and does not link src/style.css; import style from "../style.css?url" and add { rel: "stylesheet", href: style } to head links`
- `<file>:1 is never linked: nothing imports it, and the shell links only src/style.css`
- `src/style.css:<line> imports tailwindcss, but <package> is not installed; tinker() adds Tailwind when it is`
- `components.json:<line> aliases.<name> "<alias>" lands at <path>, outside src/; shadcn writes there`
- `components.json:<line> aliases.<name> "<alias>" matches no tsconfig path`
- `components.json:<line> tailwind.css is "<file>"; the base links src/style.css`
- `src/style.css is missing; components.json needs it, with @import "tailwindcss"`
- `src/style.css:1 does not @import "tailwindcss"; shadcn needs Tailwind`

### 9 env

- `.env.example:<line> lists <KEY>; set it in .env or the shell`

### 10 boundary

- `<file>:<line>:<col> imports "<path>" into client code (<rule>); call it through createServerFn, or import it only from server code`
- `skip` before any build.

### At build start

`vp build` runs checks 5 to 8 and stops on a fail,
each line led by `tinker doctor, <check>:`.
Checks 1 and 4 only warn, except a second `tinker()`
or a `tanstackStart()` in `vite.config.ts`: those stop it.
Then the app's own `tsc`:

- `tsc found <n> type error(s); the build stops here:`
  then `<file>:<line>:<col> TS<code> <message>`
- `typescript is not installed in the app; vp build checks types with it, so add it to devDependencies`
- An unknown `tinker()` option:
  `tinker(): unknown option <key>; known: root, prerender, pages, spa, sitemap`

## 3. Unit tests, and breaking each check

`poc/start-base/tests/`: 19 files, 92 tests.
Plain unit tests of our glue as functions,
and base behavior through a scope.
No test runs a build, dev, TanStack, a browser,
or a served page (ADR 0106, Testing the base).

- Glue: tsconfig output (all paths absolute),
  named-file pick-up, aliases and `?url`,
  Start's options, the `tinker()` option check,
  the six clash forms, tsc output,
  `tinker serve`'s file rule, `.env` loading,
  upgrade's version pins.
- Each doctor check over a fixture folder in a temp dir:
  the pass case, each fail with its exact message,
  and `--fix` where it applies (checks 2, 3, 4).
- `buildChecks`, the function `tinker()` calls at build start.
- Through a scope: `readResult`, the health operation,
  the `env` tag, the start extension and its middleware,
  the response body owner, the default server entry,
  and the dev error page.

`scripts/break-each-check.mjs` breaks one thing at a time
in a scratch copy, then runs the tests
(log `proof/break-each-check.txt`):

```text
control (no break): 0 failed test(s)
caught    3 failed  check version always passes
caught    5 failed  check named always passes
caught    1 failed  tsconfig @/* goes back to ../src/*
…
102 of 102 breaks caught (41 logic, 61 message)
```

- 41 logic breaks: each check passes always,
  each `--fix` does nothing, each glue function lies.
- 61 message breaks: one mark in each `say` entry.
  So every doctor message has a test that reads it exactly.

## 4. app-min builds, serves, and passes doctor

Log `proof/8-hardened-app-min.txt`, on the workspace link:

```text
vp build: EXIT 0
<p>Hello, world.</p>
HTTP/1.1 200 OK
{"ok":true,"base":"0.2.0"}
<main><h1>Tinker base</h1>
server stopped: EXIT 0
ok    1 base version
skip  2 base bytes
ok    3 generated folder … ok    10 boundary
doctor: all checks pass
EXIT 0
```

## 5. Each silent mistake now stops the build

Log `proof/9-build-stops.txt`: a scratch copy of app-min,
with the packed 0.2.0 installed as a real folder.
One mistake at a time:

```text
## Start's usual src/router.tsx
tinker doctor, named files: src/router.tsx:1 is a
  Start file the base does not read; router options
  go in src/router.ts
vp build: EXIT 1
## a route exports route, not Route
tinker doctor, routes: src/routes/index.tsx:18 does
  not export Route; TanStack skips the file, so / is
  a 404
vp build: EXIT 1
## a user __root.tsx without <Outlet />
tinker doctor, routes: src/routes/__root.tsx:3 sets
  component without <Outlet />; no page renders …
vp build: EXIT 1
## base files imported by path and by a base-only name
tinker doctor, imports: src/backend/peek.ts:1
  "../../node_modules/@tinker/start/src/errors.ts"
  reaches into the base by path; use a base entry
vp build: EXIT 1
## routes that take or nest under the base's /tinker
tinker doctor, routes: src/routes/tinker/index.tsx:2
  takes /tinker, a base route
tinker doctor, routes: src/routes/tinker/settings.tsx:2
  nests under /tinker, a base route with no outlet …
vp build: EXIT 1
## a stylesheet nothing links
tinker doctor, style: src/styles.css:1 is never
  linked …
vp build: EXIT 1
## a <Link to> typo
tsc found 1 type error(s); the build stops here:
src/routes/nav.tsx:2:71 TS2820 Type '"/tinkr"' is
  not assignable to type …
vp build: EXIT 1
## a tinker() option the base would drop
Error: tinker(): unknown option prerendr; known: …
vp build: EXIT 1
## two tinker() calls in vite.config.ts
tinker doctor, glue: vite.config.ts:5 calls tinker()
  2 times; call it once: plugins: [tinker()]
vp build: EXIT 1
## a route clash while no dev server runs
$ tinker prepare
tinker prepare: the route generator left the tree
  stale; fix the lines below:
src/routes/tinker.tsx:2 takes /tinker, a base route
EXIT 1
```

Two stay in doctor, by design: they are not wrong
in the files a build reads.

```text
## shadcn aliases under a stale .tinker/
fail  3 generated folder
      .tinker/tsconfig.json is stale; run tinker prepare
fail  8 style
      components.json:1 aliases.ui "@/components/ui"
      lands at ../src/components/ui, outside src/;
      shadcn writes there
$ tinker doctor --fix
fixed 3 generated folder
## a new route while no dev server runs
fail  3 generated folder
      .tinker/routeTree.gen.ts misses
      src/routes/later.tsx; run tinker prepare
$ tinker doctor --fix
fixed 3 generated folder
doctor: all checks pass
```

## 6. What the base does now

Log `proof/10-base-does.txt`: the five named files,
`public/`, `.env`, and a server function that throws.

```text
vp build: EXIT 0
doctor: all checks pass
<link rel="stylesheet" href="/assets/style-….css"/>
<p>app 404 page</p>              src/router.ts
raw from src/server.ts           src/server.ts
x-app-middleware: yes            src/start.ts
HTTP/1.1 200 OK                  public/robots.txt
"greeting":"from-dot-env"        .env, under serve
<h1>Something went wrong</h1>    /boom
visible <pre> with the error: 0
error text in the page data (TanStack, P4): 1
tinker: a route failed on the server: Error: boom: …
```

A fresh clone (`proof/11-fresh-clone.txt`):

```text
$ tsc --noEmit (before prepare)
error TS5083: Cannot read file '.tinker/tsconfig.json'.
$ tinker prepare  (the postinstall)
tinker prepare: wrote .tinker/tsconfig.json,
  .tinker/base.json, .tinker/routeTree.gen.ts
tsc: EXIT 0
doctor: all checks pass
```

## 7. The four stress areas, rerun on 0.2.0

Each area's own case runner ran again,
from its stress worktree, on the packed 0.2.0
(cases copied to `/tmp`; the stress worktrees untouched).
Each result: `proof/stress-<area>.txt`.

- **router**: 18 checks.
  Before: 14 WORKS, 4 WITH CHANGE.
  After: 18 WORKS.
- **server**: 16 checks.
  Before: 9 WORKS, 7 WITH CHANGE.
  After: 16 WORKS.
- **shadcn**: 9 checks.
  Before: 3 WORKS, 4 WITH CHANGE, 2 NOT SUPPORTED.
  After: 7 WORKS, 2 NOT SUPPORTED.
- **devloop**: 41 checks.
  Before: 20 WORKS, 17 WITH CHANGE, 4 NOT SUPPORTED.
  After: 38 WORKS, 3 NOT SUPPORTED.
  Y6 (an app tsconfig that overrides the base)
  is now caught by check 4.
  P7 (build time) was not timed again.
- **Total**: 84 checks.
  Before: 46 WORKS, 32 WITH CHANGE, 6 NOT SUPPORTED.
  After: 79 WORKS, 0 WITH CHANGE, 5 NOT SUPPORTED,
  0 REGRESSED.

Case changes the reruns made, all in `/tmp`:

- Each app gained `"postinstall": "tinker prepare"`,
  the 0.2.0 step in `UPGRADE.md`.
- Router options moved to `src/router.ts`;
  the server entry uses `createServerEntry`.
- `@ts-expect-error` lines on `prerender` and `spa`
  went: the options are typed now, and the build runs `tsc`.

Router, server, and devloop ran on the first 0.2.0 pack;
shadcn ran on both. After the fixes below,
every case copy was built again on the fixed pack
(`proof/stress-sweep-fixpack.txt`):

```text
26 case apps   build=0 doctor=0
import-protection   build=1 doctor=1 (on purpose)
fail  10 boundary
```

The ten devloop mistakes, rerun on the fixed pack,
give the same results (`proof/stress-devloop-mistakes-fixpack.txt`).

### What the reruns caught in 0.2.0

Each is fixed, with a test, before this proof:

- `tinker prepare` said it wrote the route tree
  when the generator stopped on a route clash.
  Now it exits 1 and prints check 7's line;
  check 3 leaves a clash to check 7.
- Check 8 asked for Tailwind as soon as
  `components.json` existed, so the shadcn
  `app` item no longer built (shadcn case 1, REGRESSED).
  Now it asks only once a file sits in the `ui` folder.
  The recheck on the fixed pack: case 1 WORKS.
- Two `tinker()` calls only warned,
  then Start failed with "Duplicate declaration".
  Now the glue line stops the build first.
- The build's `tsc` skipped `vite.config.ts`.
  Now it reads it, so a `tinker()` option type is checked.

## 8. Not supported, and rough edges

Not supported (5), each with its reason:

- **A route whose loader calls a server function,
  rendered in a unit test with no build** (devloop T4).
  TanStack needs its request context:
  "No Start context found in AsyncLocalStorage".
  Test the operation through a scope instead.
- **No error text in the page data in production**
  (devloop P4). The page shows "Something went wrong",
  and the server log has the error,
  but TanStack sends a loader's error to the browser
  for hydration.
- **Byte-identical builds from another folder**
  (devloop P6). Module ids are paths,
  and Start's server manifest keeps each route file's
  absolute path.
- **An example route as a shadcn `registry:page`**.
  shadcn maps page targets only for other frameworks;
  use `registry:file`.
- **Re-applying the app template**, by design:
  `--overwrite` is all or nothing per item.

Rough edges, none blocking:

- Adding or removing the shell or a seam file
  while `vp dev` runs prints one error line,
  then the restart; the page is fine a second later.
- Every dev restart logs Vite's own
  "transport was disconnected".
- `tinker upgrade` from 0.1.x runs the old CLI,
  so its old pin rule rewrites a `file:` tarball peer.
- Check 4 sees `paths` and `strict: false`
  in an app tsconfig; other overrides it does not judge.
- Lightpanda shows the stylesheet link but loads no CSS;
  the styled button was proven in Chrome.
- In the rerun setup, an app and the base that load
  two Vite copies make `vp dev` answer "Cannot GET /"
  with no error. A real install has one copy.

## The first POC, 0.1.x

### What is here

- `start-base/` — the package `@tinker/start`, now 0.1.1.
  The base: Start bridge, entries, two base routes,
  `tinker()`, and the `tinker` command.
- `app-min/` — the smallest app.
  Two files in `src/`, one line of glue in each config.
- `scripts/curl-app.sh` — serve the built app on a free port,
  curl three paths, stop it.
- `scripts/pack-releases.sh` — pack 0.1.1 (the tree)
  and 0.1.0 (the tree minus `release-0.1.1.patch`).
- `scripts/proof-release.sh` — the release proof below.

Run it again, from the repo root:

```bash
vp install && vp run -r build
poc/scripts/pack-releases.sh
poc/scripts/proof-release.sh
```

### Gates with poc/\* in the workspace

`pnpm-workspace.yaml` gains `poc/*`. No `file:` fallback.

- `vp install`: 13 projects. EXIT 0.
- `vp run -r build`: EXIT 0. It builds app-min too.
- `vp check`: EXIT 0. 0 errors.
  28 warnings, none in `poc/`.
- `vp run -r test`: EXIT 0. `poc/` has no tests.

`vp check` needs `vp run -r build` first.
The build writes `app-min/.tinker/`, and the base's
`tsconfig.json` checks the base against it.
`apps/start-scaffold` has the same need:
39 type errors before its route tree is built.

### 1. app-min builds and serves

The workspace link, log `proof/7-workspace-link.txt`:

```text
base folder: poc/start-base
vp build: EXIT 0
$ curl -s :PORT/ | grep -ao '<p>[^<]*</p>'
<p>Hello, world.</p>
$ curl -si :PORT/api/health
HTTP/1.1 200 OK
cache-control: no-store
content-type: application/json

{"ok":true,"base":"0.1.1"}
$ curl -s :PORT/tinker | grep -ao '<main>…'
<main><h1>Tinker base</h1>
<p>@tinker/start <!-- -->0.1.1</p></main>
server stopped: EXIT 0
```

`vp run typecheck` in app-min: EXIT 0.

### 2. Base routes split into their own chunks

Start's manifest maps each route to its file and chunk.
Through the workspace link:

```text
"/"       poc/app-min/src/routes/index.tsx
          -> /assets/routes-D-xhqWLN.js
"/tinker" poc/start-base/src/routes/tinker.tsx
          -> /assets/tinker-PIxTlaLl.js
root      poc/start-base/src/routes/root.tsx
          -> /assets/index-Cf8CQkip.js
```

Through the packed release, the base file is
`node_modules/.pnpm/@tinker+start@file+…/src/routes/tinker.tsx`,
and it still gets `tinker-Dy-Vk5GC.js`.
`/api/health` is server-only, so it has no client chunk.
So the ADR's open risk (pnpm links skip splitting) did not happen.

### 3. Doctor passes on the 0.1.0 release

Log `proof/1-release-0.1.0.txt`:

```text
ok    1 base version
      @tinker/start 0.1.0; 4 peers match
ok    2 base bytes
      27 files match files.json
ok    3 generated folder
ok    4 glue
ok    5 seams
ok    6 imports
ok    7 routes
doctor: all checks pass
EXIT 0
```

On the workspace link, check 2 says `skip`:
a source checkout has no pinned bytes.

### 4. Break it, one thing at a time

Edit a base file in `node_modules`
(`proof/2-break-base-file.txt`):

```text
fail  2 base bytes
      src/routes/tinker.tsx changed in
      node_modules/@tinker/start. An install drops base
      edits; use an extension point
EXIT 1
$ tinker doctor --fix
fixed 2 base bytes
      restored 1 file(s) from tinker-start-0.1.0.tgz
EXIT 0
```

Delete `.tinker/` (`proof/3-break-generated.txt`):

```text
fail  3 generated folder
      .tinker/ is missing
EXIT 1
$ tinker doctor --fix
fixed 3 generated folder
      ran tinker prepare
EXIT 0
```

Import base internals from `src/`
(`proof/4-break-import.txt`):

```text
fail  6 imports
      src/backend/peek.ts:1
      "@tinker/start/src/backend/body.server.ts" is not a
      base entry; use @tinker/start or
      @tinker/start/server; src/backend/peek.ts:2
      "../../node_modules/@tinker/start/src/backend/…"
      reaches into the base by path
EXIT 1
```

`--fix` leaves it failing, EXIT 1: doctor never edits `src/`.
Removing the file makes it pass, EXIT 0.

Extra: drop the tsconfig line
(`proof/5-break-tsconfig.txt`):

```text
fail  4 glue
      tsconfig.json does not extend
      "./.tinker/tsconfig.json"
EXIT 1
$ tinker doctor --fix
fixed 4 glue
      set extends in tsconfig.json
EXIT 0
```

### 5. Upgrade 0.1.0 to 0.1.1

0.1.1 adds one header to `/api/health`
(`scripts/release-0.1.1.patch`).
Log `proof/6-upgrade.txt`:

```text
$ tinker upgrade 0.1.1 --from ../start-base/packs
package.json: @tinker/start
  file:…/tinker-start-0.1.0.tgz
  -> file:…/tinker-start-0.1.1.tgz
$ pnpm install
+ @tinker/start 0.1.1
$ tinker prepare
$ tinker doctor
doctor: all checks pass
Upgrade notes, 0.1.0 to 0.1.1:
## 0.1.1
`/api/health` replies with `Cache-Control: no-store`.
EXIT 0
$ diff src hashes before and after
src/: no change
$ git diff poc/app-min/src
(empty)
$ git status --short poc/app-min
 M poc/app-min/package.json
$ curl -si :PORT/api/health
cache-control: no-store
{"ok":true,"base":"0.1.1"}
```

`git status` compares with the commit, where app-min uses the
workspace link; the upgrade itself changed one line, 0.1.0 to 0.1.1.
The script then restores the link and the lockfile.

### What the proof caught

- `upgrade` first ran the old base's `prepare`:
  Node had cached the 0.1.0 path.
  `base.json` kept 0.1.0 and the notes were empty.
  Fixed in `83639c8a`; check 3 now catches it too.
- `.tinker/tinker.d.ts` was not needed.
  The route generator already imports the base's
  router and start types into `routeTree.gen.ts`.
- A tsconfig `include` of `"./"` skips the dot-folder;
  `.tinker/tsconfig.json` names `routeTree.gen.ts` instead.
- The base's `.tsx` files need `@types/react`
  in the base's own dev dependencies.

### Not in this POC

- Parts: telemetry, auth, and sync are not ported.
  The base routes are `/api/health` and `/tinker`.
- Doctor checks 8 (plain) and 9 (env).
- Check 4 reads `vite.config.ts` as text.
  It does not load the real Vite config.
- `--fix` for check 1 (peer pins). It prints the drift.
- `tinker prepare` does not write `routeTree.gen.ts`;
  the next `dev` or `build` does.
- `upgrade` from a registry, without `--from`.
- Packs are gitignored; `pack-releases.sh` remakes them.
  The remade packs matched the proof's packs, file for file.
