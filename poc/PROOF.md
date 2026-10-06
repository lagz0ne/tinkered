# POC proof: the Start base as a package

ADR 0106, picks 1a, 2a, 3a. Date: 2026-10-06.
Branch `start/base`. Code: `ca210bc7`, fix `83639c8a`.
Full logs: `proof/*.txt`, from real runs.
The blocks below are cut from them:
a line is left out or wrapped, and `…` marks a cut.

## What is here

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

## Gates with poc/\* in the workspace

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

## 1. app-min builds and serves

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

## 2. Base routes split into their own chunks

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

## 3. Doctor passes on the 0.1.0 release

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

## 4. Break it, one thing at a time

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

## 5. Upgrade 0.1.0 to 0.1.1

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

## What the proof caught

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

## Not in this POC

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
