# Proof: the Start base as a package

ADR 0106, picks 1a, 2a, 3a. Date: 2026-10-06.
Branches `start/base` and `start/base-package`.
Full logs: `proof/*.txt`, from real runs.
The blocks below are cut from them:
a line is left out or wrapped, and `…` marks a cut.

Seven rounds:

- **0.6.0, the sync part's client side**
  (card `start/base-parts`, step 3b). Section S.
- **0.5.0, the sync part's server side**
  (card `start/base-parts`, step 3a). Section R.
- **0.4.0, the auth part** (card `start/base-parts`,
  step 2 of 3). Section Q.
- **0.3.0, the telemetry part** (card `start/base-parts`,
  step 1 of 3). Section P.
- **The package** (card `start/base-package`):
  the POC moves out of `poc/`. Section 0.
- **0.2.0, the hardened base** (card `start/base-harden`):
  the 22 stress patches folded in. Sections 1 to 7.
- **0.1.x, the first POC**: the release proof.
  Kept below, unchanged; rerun it at commit `d524069f`.

Sections 1 to 8 and their logs predate the move.
Read their paths this way:

- `poc/start-base` is now `packages/start`.
- `poc/app-min` is now `apps/start-min`.
- `poc/scripts/proof-hardened.sh` is now
  `packages/start/scripts/proof.sh`.

## Y. Telemetry queue and client bytes

Card `start/telemetry-fast`.
Branch `start/telemetry-fast`.
Date: 2026-10-07.
Base: clean `origin/main` at `df2a6da8`.

New regression: closing a tab never sends a batch
above 32,000 UTF-8 bytes.
Main failed with a 46,524-byte body.
The fix passes, drops an oversized record,
and sends the fitting record and the whole remaining backlog.

Built `start-min` entry, with source maps:

- Before: `index-B7mgwKzW.js`, 493,762 bytes.
  Gzip at level 9: 153,581 bytes.
  Source map: 18 zod modules.
- After: `index-CYmq-gbh.js`, 401,027 bytes.
  Gzip at level 9: 128,110 bytes.
  Source map: zero zod modules.

The byte counts include the source-map URL.
These are built files; no browser timing is claimed.
Queue probe: `bench/telemetry-fast.mjs`.
Both sides use the same bundled probe and the same built Core.
It runs 100,000 tiny observed operations, flushing every 500.
It excludes stdout and measures the whole process.
The final comparison ran ten rounds, one run per side per round.

```text
A median 2531 ms   B median 1145 ms
delta -1386.4 ms (-54.8%)
95% range [-1603.8, -1222.5] ms
verdict: b is faster
```

`benchctl ab --runs 10` is read as ten runs per round.
An earlier six-round comparison is not the proof above.
The final command uses explicit round and run counts:

```bash
next_probe=../fix-telemetry-fast/.bench
benchctl ab --rounds 10 --runs-per-round 1 \
  --a 'node .bench/telemetry-probe.mjs' \
  --b "node $next_probe/telemetry-probe.mjs"
```

Run from the clean base worktree root.
The probe bodies are built from each tree's source.
The source test file used for the regression was restored.
No source edits remain in the base.

Final gates:

- `vp install`: exit 0.
- `vp run -r build`: exit 0.
- `vp check`: exit 0; zero errors, 28 warnings.
  Main also prints 28 warnings.
- Focused telemetry tests: exit 0; 45 tests pass.
- All Start tests with one worker and a 30-second limit:
  exit 0; 405 tests pass.
- Normal recursive tests: exit 1; three sync tests
  exceed the five-second limit on this busy box.
- The full test set passed under each package's own config
  with a 30-second limit; Node-only Jev passed separately.
- `vp run prose`: exit 0; no hits.
- `vp run @tinker-start-scaffold#check`: exit 0.
  Real auth, SMTP, migrations, two-tab sync, and profile pass.
- `pnpm validate`: exit 0; all 18 lanes pass.
- Jev pre-flight, test quality, and promises: exit 0.
  Resource flags have false labels and reasons.
  Calibration is committed.
- Strict census: queue and schema files pass.
  The full telemetry target keeps main's S06 console
  and T04 private-import hits.

The full test commands use one worker and one task at a time.
They run unscoped and scoped names separately;
the Node-only suite cannot take a Vitest timeout flag.

```bash
VITEST_MAX_WORKERS=1 vp run \
  --concurrency-limit=1 --filter='*' \
  --filter='!@tinker/jev' test -- \
  --testTimeout=30000
VITEST_MAX_WORKERS=1 vp run \
  --concurrency-limit=1 --filter='@tinker/*' \
  --filter='!@tinker/jev' test -- \
  --testTimeout=30000
vp run @tinker/jev#test
```

The final fault check is saved in
[the clean-commit log](proof/22-telemetry-fast-mutation.txt).
Its header names the checked commit and its clean tree.
Only that log is committed after the run.

## X. Examples keep the user's app files

Card `start/registry-no-overwrite`.
Date: 2026-10-07.
Branch: `start/registry-no-overwrite`.

Run from this repo root:

```bash
node apps/start-scaffold/maintain/\
  proof-no-overwrite.mjs
```

Full logs:

- [Real CLI adds](proof/21-registry-no-overwrite.txt).
- [New doctor breaks](proof/21-registry-no-overwrite-breaks.txt).
- [Final gates](proof/21-registry-no-overwrite-gates.txt).
- [Release checks](proof/21-registry-no-overwrite-validate.txt).
- [Jev](proof/21-registry-no-overwrite-jev.txt).
- [Start mutation](proof/21-registry-no-overwrite-mutation.txt).
  Its header names the clean code commit.
  Only that log is committed after the run.

The real CLI proof added all nine non-app items.
Each started on a fresh `app` with real packed packages.
None used an overwrite flag.
Before each add, it edited Vite config and both seams.
SHA-256 hashes before and after matched for nine app files.
The package scripts also stayed the same.
Dependencies were added through shadcn's dependency fields.

```text
Local registry http://127.0.0.1:37045/r
registry server PID 2277724
Own TCP relay PID 2277900
9 fresh apps; 9 adds without --overwrite
edited config and both seams unchanged byte for byte
app scripts unchanged
applied doctor's switches and export lines by hand
9 items: build, doctor, serve EXIT 0
GET /: Hello, world. (HTTP 200)
GET /demo: A shared counter (HTTP 200)
relay PID 2277900 stopped
registry server PID 2277724 stopped
own Compose project removed
proof command EXIT 0
```

Before the hand edits, doctor prints these lines for todos:

```text
todos-example: needs the auth part; set tinker({
auth: true }) in vite.config.ts
todos-example: needs the sync part; set tinker({
sync: true }) in vite.config.ts
todos-example: src/lib/tinker.server.ts:1 needs
auth; add export { auth } from
"../backend/auth";
```

It also names all other missing seam exports.
An empty server extensions list gets a database startup line.
The proof joins that extension and keeps the user's own exports.
The next build and doctor pass.
The demo runs at `/demo`; the user's first page stays at `/`.
Postgres and Mailpit run in one owned Compose project.
Each app server and the local relay stop by PID.

The registry build refuses all app-owned targets.
It also refuses duplicate targets across items.
The registry check plants eleven protected targets and a duplicate.
Each bad registry is refused before source files are read.
It also builds the app and the app plus starter.
The copied starter tests use app paths, not a fixed package name.
No item changes package scripts.
The copied guides use direct check commands.

The new tests call the doctor check directly.
The new break run catches eight of eight breaks:
four logic breaks and four message breaks.
The control run has no failed test or broken file.

Not proved by the CLI proof:

- Feature bodies installed on their own.
  The demo still shares its bodies through one dependency.
- Sign-in, a profile save, or mail sending in a copied app.
  The source app's separate Compose gate covers those flows.
- Public hosting, published packages, or a future release.

Nothing was published or pushed.
[Item needs and assumptions](PROGRESS.md#startregistry-no-overwrite).

## W. GitHub release paths, served locally

Card `start/github-release`.
Date: 2026-10-07.
Branch: `start/github-release`.
Full log: [20-github-release.txt](proof/20-github-release.txt).
Release steps: [RELEASE.md](RELEASE.md).

```bash
node scripts/proof-github-release.mjs
```

Core, React, and Start share `0.7.0`.
They ship as one tested set under tag `start-v0.7.0`.
The second dry set, `0.7.1`, changes version metadata only.
Neither version was published.

The log lists each tarball's size and sha256.
The dry folders hold `assets/` and the registry at its repo paths.
The app item and React's Core dependency contain release URLs.
The registry links contain raw GitHub URLs at the same tag.

The proof copies those files into a local mirror.
Only those copies replace the two GitHub origins with 127.0.0.1.
All URL paths stay the same.
It also changes the packed upgrade URL default and hashes
those proof bytes again in `files.json`.
The original dry tarballs stay untouched.
Their Start byte pins match every original packed file
before the proof changes its one URL default.

Key lines from the log, wrapped:

```text
PASS: one shadcn add in an empty folder.
doctor: all checks pass
PASS: GET / HTTP 200; Hello, world.
PASS: edited base refused before package.json changed.
PASS: upgrade 0.7.0 -> 0.7.1 writes all three new URLs;
  every user file unchanged.
PASS: every proof server stopped by PID.
  Nothing published.
```

The refused upgrade returned 1 and named `src/index.ts`.
The successful upgrade installed the second set,
ran prepare and doctor, then built again.
User source, seams, and config matched their earlier hashes.
Only package.json, the lockfile, installed packages,
and generated or built files may change.

Not proven: public GitHub downloads or raw hosting,
other package managers, a real code upgrade,
or live demo auth, sync, and mail.

## V. One local shadcn add starts an app

Card `start/shadcn-registry`.
Date: 2026-10-07.
Branch: `start/shadcn-registry`.

Run from this repo root:

```bash
node apps/start-scaffold/maintain/proof-registry.mjs
```

Full logs:

- [Local CLI](proof/18-shadcn-registry.txt).
- [Final gates](proof/18-shadcn-gates.txt).
- [Release checks](proof/18-shadcn-validate.txt).
- [Jev](proof/18-shadcn-jev.txt).
  [Assumptions and item needs](PROGRESS.md#startshadcn-registry).
  [Local setup](../../../apps/start-scaffold/README.md#local-registry).

```text
Local registry http://127.0.0.1:39433/r
server PID 2032302
one shadcn add wrote the empty app
npm install: EXIT 0
vp build: EXIT 0
doctor: all checks pass
GET / returned Hello, world. (HTTP 200)
App server PID 2032827 stopped
standalone mail: build and doctor EXIT 0
source change appears in --diff
user files, package.json, every base byte unchanged
upgrade 0.6.0 -> 0.6.1: no user source or config changed
todos, profile, auth pages, counter, wiring:
  build and doctor EXIT 0
registry server PID 2032302 stopped
proof script: EXIT 0
```

The app item writes ten user files once.
Its package, config, page, and greet operation come from
`apps/start-min`.
The seams start with empty extensions.
The env example lists optional host settings as comments.
The small app needs no secret and doctor passes at once.
The base files are never copied into the app.

`TINKER_PACKAGE_DIR` points at packed Core, React, and Start.
It changes private package specs to absolute `file:` paths.
`TINKER_REGISTRY_URL` sets links between local items.
`TINKER_REGISTRY_OUT` keeps proof builds outside this repo.
The checked-in build uses release version specs.
It is ready for review, with no published package or domain.

The mail item alone builds with no Postgres or SMTP.
The other examples share the complete demo's bodies.
Their dependency copies that demo and enables auth and sync.
It also replaces the first page and empty seams.
The first copy needs `--overwrite` and `cp .env.example .env`.
Build and doctor pass without a running Postgres.
Live demo use needs Postgres and SMTP.
That copied demo's live use was not run in this proof.
The app's real-service check is a separate gate.

The diff proof changes the mail source and rebuilds the
local registry, then restores the source in `finally`.
It hashes user source and every installed base file.
A dry diff changes none of them or package.json.
The upgrade uses a local 0.6.1 version-bump fixture.
It keeps source and config; only package and install files change.
It proves the update path, not a future feature release.
Every proof server stops by its own PID.
Nothing is published.

Publishing still needs the user's go, exact domain,
and a place to install real Core, React, and Start releases.
Those release specs replace the local `file:` paths.
The registry's `/r` URL must use that exact domain.

## U. The app checks and example items

Card `start/scaffold-on-base`, Step 2.
Date: 2026-10-07.
Branch: `start/scaffold-on-base-2`.

[Check owners and assumptions](PROGRESS.md#startscaffold-on-base-step-2)
list the owner and reason for each old check.
The brief keeps plain as an app rule.
Doctor owns the base import rules.

Run every named app check:

```bash
vp run @tinker-start-scaffold#check
```

Full logs:

- [Gates](proof/17-scaffold-checks-gates.txt).
- [Named app checks](proof/17-scaffold-checks-app.txt).
- [Doctor regression](proof/17-scaffold-checks-doctor.txt).
- [Plain rule breaks](proof/17-scaffold-checks-plain.txt).
- [Registry copy proof](proof/17-scaffold-checks-registry.txt).
- [Real services](proof/17-scaffold-checks-compose.txt).
- [Jev](proof/17-scaffold-checks-jev.txt).
- [Full Start mutation](proof/17-scaffold-checks-mutation.txt).
  Its header names the final clean code commit.
  Only that log is committed after the run.

```text
build: EXIT 0; 11 tasks
check: EXIT 0; 0 errors, 28 warnings
tests: EXIT 0; 1840 pass, 1 old skip
writer tool tests: EXIT 0; 92 pass
validate: EXIT 0; 17 lanes
prose: EXIT 0; 0 hits
named app checks: EXIT 0; every task
registry: EXIT 0; 9 items, 77 files
new doctor breaks: EXIT 0; 3 of 3 caught
plain planted breaks: EXIT 0; 11 caught
```

The two new import tests fail without the fixes.
They call the check function directly.
The rules cover module declarations, import-equals,
and absolute paths into the installed base.
Doctor 5 and 10 already cover the other removed rules.
No duplicate doctor check is added.

Jev finds no new model flags or promise gaps.
The changed check tests have four titles and no flags.
The full Start scan has 177 titles and no model flags.
Its old file notes name private imports and large helpers
in unchanged part tests; they remain outside this step.
No new judge label or calibration row is needed.

The first test run overlapped validate's Core rebuild.
It failed while Core's dist files were absent.
The final gate runs build, check, tests, and prose
in order after validate finished; each returns 0.

The registry has one owner per file.
Its runtime item has no files;
it depends on `@tinker/start@0.6.0`.
Todos, profile, auth pages, mail, and counter
are separate copy-in items.
Shared demo wiring has its own item.
The aggregate example and starter join those items.
The base dependency is pinned only by the runtime item.
App examples can be copied without pinning it again.
The old frontend action entry still exports the split actions.

The registry proof copies every item into a fresh folder.
It uses the installed workspace dependencies,
then builds and checks the whole copied app.
No registry is published.

The real-service proof still uses the app's Compose file.
It saves a profile through the split profile page too.
Run it through the named app check:

```bash
vp run @tinker-start-scaffold#test:compose
```

```text
vp build: EXIT 0
doctor: all checks pass
run app migrations: EXIT 0
curl POST /api/auth/sign-up/email: 200
curl POST /api/auth/sign-in/email: 200
tab two received todo through /api/sync
Postgres saved todo: Step one crosses two tabs
profile page saved name; Mailpit received SMTP mail
PROOF PASS: real auth, SMTP, migrations, two-tab sync,
and profile page
server stopped: EXIT 0
relay stopped: EXIT 0
docker compose down -v: EXIT 0
```

The sync event is HTTP 200 with no tab reload.
There are two browser sessions, one live tab each.
The profile mail has subject `Your profile was updated`.
Owned processes and Compose volumes are removed.

Not proved here:

- A registry CLI install into an empty folder.
- Each example running alone without the shared demo.
- An independent dependency install or base upgrade.
- Packed base byte hashes: doctor skips the workspace link.
- Trace or log storage, or mail link clicks.
- One browser session with two targets.
- A rebuilt trial image.

The publishing card owns registry install and upgrade proof.
[Outside users and the trial image follow-up](PROGRESS.md#outside-users)
name the unchanged consumers and exact next work.
Core feedback: none.

## T. The scaffold runs on the base

Card `start/scaffold-on-base`, Step 1.
Date: 2026-10-07.

Run from the repo root:

```bash
node packages/start/scripts/scaffold-proof.mjs
```

Full log: [16-scaffold-on-base.txt](proof/16-scaffold-on-base.txt).
The app keeps its own auth, database, mail, and migrations.
The base mounts telemetry, auth, and sync.
The app owns none of their route files.

```text
vp build: EXIT 0
doctor: all checks pass
tinker doctor: EXIT 0
run app migrations: EXIT 0
GET /api/health: 200 {"ok":true,"base":"0.6.0"}
curl POST /api/auth/sign-up/email: 200
Mailpit: real SMTP verification message received
curl POST /api/auth/sign-in/email: 200
tab one: real better-auth browser sign-in succeeded
tab one added todo: Step one crosses two tabs
tab two received todo through /api/sync
Postgres saved todo: Step one crosses two tabs
PROOF PASS: real auth, SMTP, migrations, two-tab sync,
and profile page
server stopped: EXIT 0
relay stopped: EXIT 0
docker compose down -v: EXIT 0
```

Tab two records `GET /api/sync` as EventSource, status 200.
It shows the new todo without a reload.
Each tab uses the same real account.
Lightpanda allows one target per browser session.
The proof uses two sessions, with one live tab each.

The script starts only its own Compose project.
The host's default network address pools are full.
A temp Compose file gives this project a free small subnet.
The workspace cannot reach host loopback ports.
Its own TCP relays use `docker compose exec` to reach
Postgres and Mailpit from local ports.
It edits no host service or Docker setting.
Cleanup stops each owned PID and removes its own volumes.

Not proved here:

- Packed base byte hashes: doctor skips a workspace link.
- Trace or log storage: the part is on;
  this run points its storage URLs at a closed local port.
- Email link clicks: sign-in does not need them here.
- Trial images and the new registry layout.
- One browser with two targets: Lightpanda refused it.

## S. The sync part, client side, 0.6.0

Step 3b of card `start/base-parts`: the client side of sync.
Copied from `apps/start-scaffold/src/scaffold`
(`frontend/sync.ts`, `events.ts`, `owner.ts`, `router.tsx`,
and `sync.functions.ts`), with the scaffold's tests
(`sync-client`, `tab-lifetime`, `transport`, `protocol-*`)
as the source of the cases; the scaffold is not changed.
It lives in `packages/start/src/parts/sync/client/`
and `src/parts/sync/functions.ts`.

### What it is

- With sync on, the router entry builds the tab's sync
  state in its app root:
  - `syncClient`: cursors, the account, local writes;
  - `snapshotLoader`, `loadSnapshot`, `checkAccount`;
  - `eventSource`, `consumeConnection`, `streamChanges`,
    and `syncStreaming`: the tab's stream;
  - `accountOwner`: whose work it is; `tabLifetime`:
    a real page hide closes the app root.
- `syncRouter` hands the router its `context`
  (`bootstrap`, `account`), `dehydrate`, and `hydrate`.
- `getBootstrap` and `getAccount`: server functions
  that settle the server seam's `bootstrap` and
  auth's `readAccount`.
- `@tinker/start/client` exports the tab's units.
- `Sync.Records` and `Sync.RouterContext`
  are on `@tinker/start`.
- Check 5 names each client seam name
  (`records`, `readSnapshot`, `readBootstrap`,
  `readBatch`, `streamMessage`), the server seam's
  `bootstrap`, and missing `Register` bodies.
  Check 6 takes `@tinker/start/client`.
- Each run and factory destructures its ctx.

### What the proof caught

- A stand-in `records` that left out a parameter
  it did not read failed `tsc` inside
  `node_modules/@tinker/start`. The base now calls
  `records` through `Sync.Records`, and an app types
  its factory with it, so a wrong method fails
  in the app's own file.
- Two tests applied a result before the write read
  its reply, so a kept result and a fresh one looked
  the same. Each test now waits for the reply first.
- The first partial break run missed two breaks
  and hung on a third:
  - no test imported `@tinker/start/client` in app
    code; the imports test does now;
  - the augmentation break left an `if` with no body,
    so its file failed to load; it leaves `;` now;
  - the reconnect break slept 0 ms on the test clock,
    so the stream loop never yielded; it sleeps 400.

### Gates

```text
vp install: EXIT 0
vp run -r build: EXIT 0
vp check: EXIT 0
  0 errors, 28 warnings (as on main;
  none in packages/start)
vp run -r test: EXIT 0
  @tinker/start: 358 passed (291 before)
vp run prose: EXIT 0
break-each-check, partial: 18 of 18
  caught (16 logic, 2 message)
mutation: proof/mutation.txt
```

### break-each-check: a partial run

Log: `proof/break-each-check-3b.txt`. It runs the control
and only the breaks that are new or changed since 3a's
full run (198 of 198 caught, `proof/break-each-check.txt`),
picked with the new `BREAKS` filter:

- the 15 client breaks;
- the seam-names break, whose text moved;
- two message breaks: `say.augment` (new)
  and `say.entry` (it names the client entry).

The other breaks still hold: since that run,
`lib/` changed only in the 3b feature commit,
whose new lines these breaks cover, and each
commit after the breaks is a test or a doc.

### Mutation

The floor is per package, on kills alone.
The run of record is `proof/mutation.txt`.
Its first lines name the commit and the clean tree;
its last line gives the totals.

`src/parts/sync`, in a targeted run before the last
test commits: 708 of 831 killed, 85.20 on kills alone.
The last test commits kill 15 more; each was checked
by applying the mutant by hand.

### Survivors in src/parts/sync, by reason

From the targeted run, without the 15 killed after it.

- A loop that never yields (15, all timeouts):
  it awaits only settled promises, so timers, I/O,
  and the test never run again; only Stryker's
  timeout ends it.
  - `client/sync.ts:118`, the write loop's body.
  - `client/events.ts:146, 201, 240`: the frame
    wait's, a connection's, the stream loop's bodies.
  - `stream.server.ts:92, 123, 124` (two),
    `145, 146` (two), `154, 179, 182, 183`.
- `{}` as a unit's config, or a union zod refuses:
  the module fails to load, no test runs,
  and Stryker counts it as survived.
  - `client/sync.ts:11`, `client/events.ts:14, 95, 104`,
    `client/owner.ts:5`, `client/router.ts:12`.
  - `stream.server.ts:33`, `endpoint.server.ts:12`,
    `notifications.server.ts:6`, `history.server.ts:10`,
    `off.ts:7`, `envelopes.ts:44, 45, 46`.
- A label nothing shows:
  `client/events.ts:96, 256`, `client/owner.ts:29`,
  `client/tab.ts:6` (a tag with a default,
  or an extension), and `off.ts:8`
  (the off router; reachable on the trace,
  left with the per-file target dropped).
- Clean-up on things already done: a removed
  listener, a cleared map, `{ once: true }`.
  A settled promise ignores a second resolve.
  - `client/sync.ts:23, 24, 25, 45, 46, 94` (two),
    `97, 98, 99`.
  - `client/events.ts:139` (two),
    `client/owner.ts:37` (two), `39`.
  - `stream.server.ts:53` (two),
    `56, 62, 167, 168, 191, 192`.
  - `notifications.server.ts:86` (two), `90`.
  - `stream.server.ts:49, 50` (two): close aborts the
    stream's stop and closes its subscription;
    either alone ends a held wait.
- The same value either way:
  - `client/sync.ts:31, 32, 36, 37, 59`, the `?? -1`
    fallbacks (no coverage): the public cursor is set
    at start, an account's when it joins.
  - `client/sync.ts:32, 37`: `cursors.get(null)`
    is undefined, so the fallback gives -1 again.
  - `client/sync.ts:37`, `-1` to `+1`: with no account,
    the stand-in `records` reads no private revision.
  - `client/sync.ts:17`: before a snapshot, an event
    is skipped either way; a snapshot sets `public`.
  - `client/sync.ts:41`: deleting a null key does nothing.
  - `client/events.ts:31`: versions only grow,
    so a forgotten one is never asked for again.
  - `client/events.ts:48, 58`: the held promise is
    resolved, so a stale one lets waits through.
  - `client/events.ts:203`: an ended connection's
    `undefined` fails to read, so it ends false anyway.
  - `client/events.ts:245`: a failed result has no value.
  - `endpoint.server.ts:32`: a success has no error.
  - `notifications.server.ts:11`: the first subscribe
    resets it before anything reads it.
  - `history.server.ts:21` (two): the insert just before
    makes the row the select finds.
  - `schema.ts:25` (four): the key shapes migrations;
    the base runs none, and tests make their tables.
  - `stream.server.ts:87`: output is unset only after
    cancel, and line 85 returns first.
  - `stream.server.ts:135`: private rows come only
    with a private cursor.
- The stream sends the same bytes, in more or
  fewer pulls, or one more read after a close:
  - `stream.server.ts:85, 124, 128` (two);
  - `142, 146` (three), `150, 156` (two);
  - `161, 165, 166, 181, 186` (two), `187`.
- The browser's EventSource: `client/events.ts:97`.
  Node has none; proof 15 runs it in a tab.
- Not in the score: `client/owner.ts:11` is a
  runtime error, a page hide before `bind`.

### Tests

- `tests/sync-client.test.ts`: the tab lifetime, the
  account owner, snapshots, events in order, writes
  (receipts, results, retries, rejection, exits,
  stops), waits, and the trace names.
- `tests/sync-tab.test.ts`, with a stand-in
  EventSource bound as `eventSourceBackend`:
  loads and account checks, frames, connections,
  reconnects 500 ms apart on a test clock,
  the router side, the on and off parts, the trace.
- `tests/sync.test.ts` gains the server side's
  edges: wait probes first, so a hanging mutant
  fails fast; the paired account checks, each the
  only one that can catch its case; heartbeat reads;
  a cancelled body; a replaced listener.
- No test runs a build, a server, TanStack,
  or a browser, and none waits on a timer.

### jev

- `promises.mjs start`: 0 of 154 titles lack
  a README line.
- `tests.mjs start`: 0 of 154 flagged.
  Its plain notes: each file imports `../src/`
  (the package tests its own units); `heldWrite`
  (21 lines) and `sources` (35, a stand-in
  EventSource) are over 20 lines;
  `sync.test.ts` has 4 helpers.
- Pre-flight on `origin/main..HEAD`: 7 flags,
  each labeled in `tools/jev/cases.jsonl`.

### Builds and serves

Log: `proof/15-sync-client.txt`, in a scratch copy
of apps/start-min with stand-in seams: PGlite in
memory, two public events, a page that shows the
public count, and `POST /api/bump` that commits one.

```text
## sync on, client side
tinker: sync turns auth on
vp build: EXIT 0 · doctor: all checks pass
curl -s :PORT/  (getBootstrap, server render)
<p>count <!-- -->2</p>
browser engine: lightpanda (the default)
agent-browser open http://127.0.0.1:PORT/
agent-browser eval …textContent
"count 2"
curl -s -X POST :PORT/api/bump
{"count":3}
agent-browser eval …textContent
"count 3"
server stopped: EXIT 0
storage: span names after the tab (…cut)
      1 sync.endpoint
      1 sync.open
      1 sync.receive
      1 sync.stream
## a client seam without streamMessage
tinker doctor, named files: src/lib/tinker.ts:1
  does not export streamMessage;
  the sync part reads it
vp build: EXIT 1
## no Register bodies
tinker doctor, named files: src/ adds no
  Register bodies to "@tinker/start";
  the sync part reads them
vp build: EXIT 1
```

### Not proven here

- A real Postgres server: the stand-in is PGlite.
- A sign-in in a tab: the stand-in auth signs no one
  in; account changes are proven by scope tests.
- A write from a tab through a server route:
  `execute` is proven by scope tests only.
- Chrome: Lightpanda ran the stream, so no
  Chrome run was needed.
- `vp dev`: only builds were served.

## R. The sync part, server side, 0.5.0

Sync is too big for one clean step, so it lands in two:
3a, the server side (here), and 3b, the client side.
Copied from `apps/start-scaffold/src/scaffold`
(`backend/stream.ts`, `notifications.ts`, `events.ts`,
`sync.schema.ts`, `sync.ts`, `protocol.ts`, and
`src/routes/api.sync.ts`); the scaffold is not changed.
It lives in `packages/start/src/parts/sync/`.

### What it is

- `tinker({ sync: true })` turns it on; it is off by default.
  It turns auth on: the build prints
  `tinker: sync turns auth on`, and the head of
  `.tinker/parts.server.ts` says so too.
  `auth: false` with it fails the build.
- Route `GET /api/sync`, only while on: the stream.
  Its wire rules sit in a session resource,
  `syncEndpoint`, so a scope test reaches them.
- It reads `database` from the server seam.
  It reads no env key of its own.
- `eventHistory` and the `Database` type are on
  `@tinker/start/server`; `Register`, the `Sync` types,
  the envelopes, and the readers on `@tinker/start`.
- drizzle-orm is a dependency now; the tables and
  the stream's query are base code.
- Each run and factory destructures its ctx.
  The stream's four account re-checks are one
  `recheck` now; they behaved the same.

### Left for 3b

- `getBootstrap` and `getAccount`: only the client
  calls them, so they come with it.
- The sync client, tab lifetime, and router wiring.
- The client seam names, and the server seam's
  `bootstrap`: check 5 asks for what the base reads.

### Gates

```text
vp install: EXIT 0
vp run -r build: EXIT 0
vp check: EXIT 0
  0 errors, 28 warnings (as on main;
  none in packages/start)
vp run -r test: EXIT 0, twice
  @tinker/start: 291 passed (259 before)
vp run prose: EXIT 0
break-each-check: 198 of 198 caught
  (120 logic, 78 message)
mutation: 87.10, EXIT 0
  2939 killed, 26 timed out, 379 survived,
  60 not covered, of 3404
  Kills alone: 86.34
  src/parts/sync: 298 of 389 killed,
  80.21 (76.61 on kills alone)
```

The sync files score lower than the package.
Most of their survivors are of two kinds:

- The stream re-reads the account after a wake,
  and again after the rows query (the scaffold's
  guard against leaking a revoked account's rows).
  Each check hides the other's mutants.
- A wait guard whose mutant hangs, so the test
  times out instead of failing.

Two runs taught one thing about timeouts:
a 30 s test timeout let Stryker's own 15 s timeout
fire first, so 73 hanging mutants counted as
timeouts, not kills (84.96 on kills alone).
Warming PGlite and drizzle once in a `beforeAll`,
with Vitest's 5 s test timeout kept, brought them
back to kills. The last run's totals match the one
before it; 6 test workers exited with SIGILL in it,
and Stryker restarted them and retried.
break-each-check ran before the last test commit
(`2fd4f397`), which only warms more modules and splits
one test in two; it removes no assertion.

### Tests

- `tests/sync.test.ts`, on an in-memory PGlite
  stand-in seam (`tests/fixtures/app.server.ts`):
  - notifications: commit, rollback, a read
    before waiting, a listener that cannot start,
    one that breaks, root close;
  - stream framing: replay after a cursor,
    100 to a frame, the greeting, each new commit,
    a resumed cursor, private rows;
  - cancel between events: a held read ends
    on cancel, on a backend stop, on a graceful
    request close;
  - accounts: another account's cursor is
    refused, a sign-out or a sign-in sends the
    account frame, heartbeats, the 30 s lease;
  - wire and params: each route reply,
    `Last-Event-ID` before `?cursor=`,
    a read failure is not a 400;
  - the event history; the trace names.
- `tests/sync-envelopes.test.ts`: each shared
  reader and envelope, kept and refused.
- The glue and doctor tests: the switch, the
  record, the mount, check 5's `database` line,
  check 7's `/api/sync` line, the build stop.
- No test runs a build, a server, TanStack,
  or a browser, and none waits on a timer.

### Builds and serves

Log: `proof/14-sync-part.txt`, in a scratch copy
of apps/start-min with stand-in seams: an in-memory
PGlite database with two public events.

```text
## sync on, with stand-in seams
tinker: sync turns auth on
vp build: EXIT 0 · doctor: all checks pass
// …parts on: telemetry, auth, sync;
//   sync turns auth on.
curl -N :PORT/api/sync
event: changes
id: {"public":2,"private":null}
data: {"kind":"changes","events":[…2 events…]}

: connected
first byte after 2.7 s (PGlite starts)
curl -N, Last-Event-ID: {"public":1,…}
event: changes
id: {"public":2,"private":null}
data: {…the second event…}

: connected
?cursor=bad: 400
## sync off (the default)
doctor: all checks pass
GET /api/sync: the app takes it
## sync on, and the app's own /api/sync
src/routes/api.sync.ts:2 takes /api/sync,
  a base route; tinker({ sync: false }) frees it
vp build: EXIT 1
## sync on, a seam without database
tinker doctor, named files:
  src/lib/tinker.server.ts:1 does not export
  database; the sync part reads it
vp build: EXIT 1
## sync on, with auth: false
tinker(): sync needs auth, but auth is false;
  drop auth: false, or set sync: false
vp build: EXIT 1
```

### Not proven here

- A real Postgres server: the stand-in is PGlite,
  in memory, with no server.
- A tab's own stream use: that is 3b.
- `vp dev`: only builds were served.

## Q. The auth part, 0.4.0

Copied from `apps/start-scaffold`
(`src/scaffold/backend/auth.server.ts`,
`src/routes/api.auth.$.ts`); the scaffold is not changed.
It lives in `packages/start/src/parts/auth/`.

### What it is

- `tinker({ auth: true })` turns it on; it is off by default.
- Route `/api/auth/$` (GET and POST), only while on:
  `handleAuth`, ADR 0103's named exception,
  hands the request to the app's `auth.handler`.
- It reads `auth` and `readAccount` from
  `src/lib/tinker.server.ts`. The base reads
  `readAccount` from step 3, through sync's `getAccount`.
- `authSettings` reads `PUBLIC_ORIGIN` and `AUTH_SECRET`
  once; it is on `@tinker/start/server`,
  for the app's `auth` to build on.
  With auth on, the app root does not start
  while a key is unset or refused.
- Each part now names the entry modules it has,
  so `.tinker/parts.ts` exports no `auth`.

### Doctor

- Check 5 names a missing seam file,
  or each name the seam lacks. The build stops on it.
- Check 7 also takes a path under a base splat:
  `/api/auth/login` under `/api/auth/$`.
- Check 9 names an unset key as `.env`'s,
  unless `.env.example` lists it, and a refused one
  at its `.env` line. Listed keys now come
  in file order; `parseEnv` sorts them.

### Gates

```text
vp install: EXIT 0
vp run -r build: EXIT 0
vp check: EXIT 0
  0 errors, 28 warnings (as on main;
  none in packages/start)
vp run -r test: EXIT 0
  @tinker/start: 259 passed (236 before)
vp run prose: EXIT 0
break-each-check: 186 of 186 caught
  (108 logic, 78 message)
mutation: 87.97, EXIT 0
  2620 killed, 12 timed out, 307 survived,
  53 not covered, of 2992
  Kills alone: 87.57
  src/parts/auth: 23 of 25 killed, 92.00
```

The two auth survivors:

- The startup extension's label, `"auth"`:
  no trace or error shows it.
- `resource({})` for `authSettings`:
  the module fails to load, no test runs,
  and Stryker counts it as survived.

### Tests

- `tests/auth.test.ts`: `handleAuth` passes the request
  and its reply; only a request; a failing library;
  the two keys; unset, empty, and refused keys;
  the root that does not start; the off part; trace names.
- The glue and doctor tests: the switch, the mount,
  the parts files, check 5's seam lines,
  the build stop, check 7's splat, check 9's keys.
- A stand-in seam, `tests/fixtures/app.server.ts`,
  is `#tinker/app.server` for the tests and the base's
  type check. `tests/fixtures/routes.d.ts` declares
  the auth route, since apps/start-min's tree has auth off.

### Builds and serves

Log: `proof/13-auth-part.txt`, in a scratch copy
of apps/start-min with a stand-in seam.

```text
## auth on, with a stand-in seam
vp build: EXIT 0 · doctor: all checks pass
GET /api/auth/get-session:
  "handled":"GET /api/auth/get-session"
POST /api/auth/sign-in/email:
  {"handled":"POST /api/auth/sign-in/email",
   "origin":"http://127.0.0.1:4318"}
## auth off (the default)
export { auth } from "…/parts/auth/off";
doctor: all checks pass
GET /api/auth/get-session: the app takes it
## auth on, and the app's own /api/auth/$
src/routes/api.auth.$.ts:2 takes /api/auth/$,
  a base route; tinker({ auth: false }) frees it
vp build: EXIT 1
## auth on, a seam without readAccount
tinker doctor, named files:
  src/lib/tinker.server.ts:1 does not export
  readAccount; the auth part reads it
vp build: EXIT 1
## auth on, no seam at all
src/lib/tinker.server.ts is missing;
  the auth part reads auth and readAccount from it
vp build: EXIT 1
## auth on, a short secret and no origin
fail  9 env
  .env does not set PUBLIC_ORIGIN;
  the auth part needs it
  .env:2 sets AUTH_SECRET; the auth part
  needs at least 32 characters
```

### Not proven here

- A real auth library (better-auth with Postgres):
  that is the app's, and moves with the scaffold.
- `vp dev`: only builds were served.

## P. The telemetry part, 0.3.0

Copied from `apps/start-scaffold/src/scaffold/telemetry`;
the scaffold is not changed.
It lives in `packages/start/src/parts/telemetry/`.

### What changed from the scaffold

- Settings are a resource over the `env` tag,
  read once (ADR 0106). A bad URL stops the
  telemetry root at its start, naming each key.
- No pino. Core's log entry already holds
  each record field, and pino's browser build
  has no types, so the tab's path could not be
  tested through a scope.
  The server still prints one JSON line per record.
- The side (server, ssr, browser) picks the sender,
  not `createIsomorphicFn`, so both senders are tested.
- The ingest route's checks moved into a session
  resource, `telemetryEndpoint`; the route calls it.
  So the replies are tested through a scope.
- Dropped: the `history` cell and `frontendSpans` tag.
  Nothing read them.

### Gates

```text
vp install: EXIT 0
vp run -r build: EXIT 0
vp check: EXIT 0
  0 errors, 28 warnings (as on main;
  none in packages/start)
vp run -r test: EXIT 0
  @tinker/start: 236 passed (171 before)
vp run prose: EXIT 0
break-each-check: 172 of 172 caught
  (97 logic, 75 message)
```

Mutation, `flock /tmp/mutation.lock`,
alone, floor 85:

- First run: 83.11. It failed the floor:
  the scaffold's tests never sent a span
  through the wire rules, and left most
  queue bounds untested.
- After the new tests: 87.53.
  2536 killed, 12 timed out, 310 survived,
  53 not covered, of 2911.
  Kills alone: 87.12.
- Two queue lines no input reaches are gone:
  a health write after close stops publishing,
  and a closed check no flush can meet.

### Tests

- `tests/telemetry.test.ts`: export to storage,
  levels, cuts, retry, partial refusal,
  close, the server timer, a stuck send,
  queue bounds, the tab's sends, settings,
  the router's part, the off part.
- `tests/telemetry-ingest.test.ts`: the receive
  operation, each reply status, origins,
  a cut body, a torn body, a failed ingest,
  and a tab's batch reaching the telemetry root.
- `tests/parts.test.mjs` and the glue, prepare,
  routes, and env tests: the switch, the record,
  the parts files, the freed path, refused keys.
- None runs a build, a server, TanStack, or a browser.
  A fake `httpBackend` stands in for storage.

### Builds and serves

Log: `proof/12-telemetry-part.txt`.
A stand-in storage keeps each POST.

```text
## telemetry on (the default)
vp build: EXIT 0
doctor: all checks pass
<p>Hello, world.</p>
POST /api/telemetry, same origin: 202
POST /api/telemetry, other.test: 403
what storage got
      1 POST /logs
      1 POST /traces
spans: greet request.body
  telemetry.endpoint telemetry.receive
  tinker.health
{"time":1,"level":30,"msg":"from a tab",
  "service":"start-min","side":"browser"}

## telemetry off
// parts on: none.
export { telemetry } from
  "…/src/parts/telemetry/off";
doctor: all checks pass
POST /api/telemetry: 200
the app takes it

## telemetry on, and the app's own route
tinker doctor, routes:
  src/routes/api.telemetry.ts:2 takes
  /api/telemetry, a base route;
  tinker({ telemetry: false }) frees it
vp build: EXIT 1

## a bad storage URL in .env
fail  9 env
  .env:2 sets VICTORIA_TRACES_URL;
  the telemetry part needs an http(s) URL
```

### Not proven here

- A tab's own records in a real browser.
  start-min runs no work in the tab's scope:
  the page opens and hydrates (agent-browser),
  and storage gets no `browser` span.
  The tab's sender is tested through a scope.
- `vp dev`: only builds were served.

## 0. The package

### What moved

- `poc/start-base` to `packages/start`
  (`@tinker/start`; entries `.`, `./server`,
  `./vite`, and the `tinker` bin).
- `poc/app-min` to `apps/start-min`
  (package name `start-min`).
- `poc/PROOF.md` and `poc/proof/` to
  `docs/roadmap/start-base/`.
- `poc/scripts/curl-app.sh` and `proof-hardened.sh`
  to `packages/start/scripts/` (`proof.sh`).
- The 0.1.x release scripts stay at commit `d524069f`,
  where their patch applies.
- `pnpm-workspace.yaml` drops `poc/*`.

### Two follow-ups from the last review

Each has a test that fails on the code before it
(log `proof/package-tests-before.txt`: 4 fail).

- Check 4 reads each local file the `extends` list
  names after `./.tinker/tsconfig.json`.
  tsc reads the list in order, and the last file wins.
  So doctor names the file whose value tsc uses:

  ```text
  configs/strict.json:4 sets compilerOptions.paths;
    it replaces the base's #tinker/* and @/* paths,
    so remove it
  configs/strict.json:3 turns strict off;
    the base's files need strict
  ```

- In strict mode, `readJsonc` reports a byte order mark.
  `vp install` stops on one
  ("expected value at line 1 column 1").

  ```text
  package.json:1 starts with a byte order mark;
    vp cannot read it
  ```

  `--fix` never writes that file.
  `components.json` gets its parse line:
  `components.json:1 does not parse (ByteOrderMark)`.

### Lanes

- `vp run @tinker/start#test`: 23 files, 170 tests.
- `vp check` lints and formats `packages/start`.
- `vp run @tinker/start#mutate`: Stryker, floor 85.
  At commit `bd96bac8`: killed 1904, timeout 3,
  survived 203, no coverage 52.
  Score 88.21; 88.07 on kills alone
  (log `proof/mutation.txt`).
- `node packages/start/scripts/break-each-check.mjs`:
  148 of 148 breaks caught (76 logic, 72 message).
  The eight new breaks are the follow-ups.

The lane leaves out the files that only run inside
TanStack's runtime: `src/entry/server.ts`,
`router.tsx`, `start.ts`, `fallbacks.tsx`,
`src/routes/**`, and the four empty defaults they read.
No test may run TanStack (ADR 0106, Testing the base);
the build and serve proof covers them.
`tinker serve`'s Node host and the route-tree write
moved into `bin/tinker.mjs`, their one caller:
each starts a server or Vite.

Two code changes came with the lane:

- `checkTypes` found TypeScript through `createRequire`,
  which also reads `NODE_PATH`. A package manager's
  script run sets that to its own store, so an app
  with no `typescript` passed the check there.
  It now walks the app's `node_modules`, as Node does.
- `doctor()` returns its lines and exit code;
  `planUpgrade()` says what an upgrade does
  before it writes or installs. The CLI prints.

### The review round

The review found three small bugs; each has a test
that fails on the code before it
(log `proof/fix-round-2-tests-before.txt`: 3 fail,
and the `NODE_PATH` test below).

- Check 4 finds an extended file as tsc does:
  `./configs/strict` reads `configs/strict.json`.
- Check 4 follows each extended file's own `extends`
  chain, and reads a file once, so a loop ends:

  ```text
  configs/b.json:3 turns strict off;
    the base's files need strict
  ```

- The installed base is found in the app's
  `node_modules`, never through `NODE_PATH`.
  The test runs check 1 in a child process
  with `NODE_PATH` pointing at another base.

Cleanups: the request tests use no timer.
The forced-close test's operation waits on its signal.
The graceful one waits on a gate the test opens
once `closing` fires: the session's cleanup has not run
and the work sees no abort. That Core waits for the work
is proven in `packages/core/tests/closing.test.ts:193`.
The read-error test uses a self-linked file (`ELOOP`),
which fails for root too.

After the round: 23 files, 170 tests;
148 of 148 breaks caught (76 logic, 72 message);
mutation 88.21 at commit `bd96bac8`
(killed 1904, timeout 3, survived 203, no coverage 52;
88.07 on kills alone).

### apps/start-min

`packages/start/scripts/proof.sh`, on the workspace
link (log `proof/8-hardened-app-min.txt`):

```text
base folder: packages/start
vp build: EXIT 0
<p>Hello, world.</p>
HTTP/1.1 200 OK
{"ok":true,"base":"0.2.0"}
<main><h1>Tinker base</h1>…
server stopped: EXIT 0
$ tinker doctor
doctor: all checks pass
EXIT 0
```

The script's other logs (9, 10, 11) came out
byte for byte as in the 0.2.0 run.
Its first rerun caught one bug:
`pnpm pack` always ships `README.md`,
but `files.json` pinned only the `files` list.
So every installed base failed check 2 with
`node_modules/@tinker/start/README.md added`.
`README.md` is in `files` now, and a test
fails if a README or LICENSE is left out.

## 1. Gates, 0.2.0

From the repo root, each by exit code:

- `vp install`: EXIT 0.
- `vp run -r build`: EXIT 0. It builds app-min too,
  and that build runs doctor's build-start checks and `tsc`.
- `vp check`: EXIT 0. 0 errors, 28 warnings, none in `poc/`.
- `vp run -r test`: EXIT 0.
  `poc/start-base`: 21 files, 129 tests.
- `vp run prose`: EXIT 0.

## 2. Doctor's checks and messages

`tinker doctor` prints a status line per check,
then one line per finding.
`--fix` writes only base-owned and generated files.
Each check is one file: `packages/start/lib/checks/<name>.mjs`.
Its `say` table holds every message below.

### 1 base version

- `package.json:<line> <peer> is <found>, tested with <version>`
- `package.json:<line> pins <name> <spec>, but <found> is installed; run install`
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
- `.tinker/routeTree.gen.ts is missing; <next>`
- `.tinker/routeTree.gen.ts misses src/routes/<file>; <next>`
- `.tinker/routeTree.gen.ts:<line> imports <path>, which does not exist; <next>`
- `<next>` is `run tinker prepare`, or, while check 7 fails,
  `fix check 7 first, then run tinker prepare`.
- `.gitignore does not list .tinker/` (and `.tanstack/`)
- `this tinker is base <a>, the app resolves <b>; run the app's own tinker`
- `--fix`: `ran tinker prepare; added <lines> to .gitignore`

### 4 glue

`<config>` is the Vite config the app has:
`vite.config.ts`, `.mts`, `.js`, or `.mjs`.

- `vite.config.ts is missing; add one with plugins: [tinker()]`
- `<config>:1 does not import tinker from "@tinker/start/vite"`
- `<config>:<line> does not call tinker(); add plugins: [tinker()]`
- `<config>:<line> calls tinker() <n> times; call it once: plugins: [tinker()]`
- `<config>:<line> adds tanstackStart(); tinker() adds it already`
- `<config>:<line> imports @tailwindcss/vite; tinker() adds Tailwind already`
- `tsconfig.json:<line> does not parse (<code>); doctor never edits a file that does not parse`
  (and the same for `package.json` and each extended file)
- `package.json:1 starts with a byte order mark; vp cannot read it`
- `tsconfig.json:1 does not extend "./.tinker/tsconfig.json"`
- `<file>:<line> sets compilerOptions.paths; it replaces the base's #tinker/* and @/* paths, so remove it`
- `<file>:<line> turns strict off; the base's files need strict`
- `<file>` is `tsconfig.json`, or a local file its `extends`
  chain names after `./.tinker/tsconfig.json`.
  tsc applies a list in order, each file after its own chain,
  so the last file wins; doctor names the file whose value tsc uses.
  As tsc does, a name with no `.json` gets `.json` added
  when the file is missing.
- `package.json:1 has no "postinstall": "tinker prepare"; a fresh clone has no .tinker/`
- `--fix`: `wrote the extends line in tsconfig.json and the postinstall script in package.json`.
  It inserts those two keys and keeps every other byte.

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
- `<file>:<line> createFileRoute("<path>") does not match its file; set it to "<id>", or TanStack's generator rewrites it in src/`
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
- `components.json:1 sets no tailwind.css; set it to "src/style.css"`
- `components.json:<line> does not parse (<code>)`;
  a byte order mark is `(ByteOrderMark)` at line 1
- `src/style.css is missing; shadcn's files in <ui folder> need it, with @import "tailwindcss"`
- `src/style.css:1 does not @import "tailwindcss"; shadcn's files in <ui folder> need Tailwind`
- The last two only once a file sits in shadcn's `ui` folder.

### 9 env

- `.env.example:<line> lists <KEY>; set it in .env or the shell`

### 10 boundary

- `<file>:<line>:<col> imports "<path>" into client code (<rule>); call it through createServerFn, or import it only from server code`
- `skip` before any build.

### At build start

`vp build` runs checks 5 to 8 before TanStack's route generator,
and stops on a fail, each line led by `tinker doctor, <check>:`.
So a stop comes before the generator could write `src/`.
Checks 1 and 4 only warn, except a second `tinker()`
or a `tanstackStart()` in the Vite config: those stop it.
Then, at build start, the app's own `tsc`:

- `tsc found <n> type error(s); the build stops here:`
  then `<file>:<line>:<col> TS<code> <message>`
- `typescript is not installed in the app; vp build checks types with it, so add it to devDependencies`
- An unknown `tinker()` option:
  `tinker(): unknown option <key>; known: root, prerender, pages, spa, sitemap`

### tinker prepare

- `tinker prepare: check 7 fails, so the route generator did not run (it would stop, or write src/); fix the lines below:`
  then check 7's lines.
- `tinker prepare: the route generator left the tree stale; fix the lines below:`
  then the tree's gaps.
- Both exit 1, except as the `postinstall` script:
  there they print and exit 0, so a broken clone still installs.

## 3. Unit tests, and breaking each check

`packages/start/tests/`: 23 files, 170 tests.
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
- `buildChecks`, the function `tinker()` runs before the generator.
- `doctor()`'s printed lines and exit code, and
  `planUpgrade()`: its stop lines, pins, and notes.
- The Vite hooks' plain parts (`lib/hooks.mjs`):
  the boundary record and the dev restart rule.
  `errorDetail`: a production error page shows no text.
- `--fix` and the route generator: a fake `vite` package
  notes whether `tinker prepare` ran the generator.
  No Vite runs.
- Through a scope: `readResult`, the health operation,
  the `env` tag, the start extension and its middleware
  (the request session, its headers and stop signal,
  a forced close, a teardown error),
  the response body owner, the default server entry,
  and the dev error page.

`scripts/break-each-check.mjs` breaks one thing at a time
in a scratch copy, then runs the tests
(log `proof/break-each-check.txt`):

```text
control (no break): 0 failed test(s), 0 broken file(s)
caught    7 failed  check version always passes
caught    9 failed  check bytes always passes
caught    7 failed  tsconfig @/* goes back to ../src/*
…
148 of 148 breaks caught (76 logic, 72 message)
```

- 76 logic breaks: each check passes always,
  each `--fix` does nothing, each glue function lies.
- 72 message breaks: one mark in each `say` entry.
  So every doctor message has a test that reads it exactly.

The review round's tests, run against the code before it
(commit `42952102`, log `proof/fix-round-tests-before.txt`):
31 fail, and 2 files cannot load (their modules were new).
So each fix has a test that fails without it.

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

Router, server, and devloop first ran on the first 0.2.0 pack;
shadcn ran on both. Every case copy was then built again
on each later pack; the last sweep is below.

### The review round, rerun

A review found that `--fix` could erase or break user files.
After the fixes:

- The reviewer's own 22 mistakes, rerun on the final pack
  (`proof/review-cases-1.txt` to `-3.txt`).
  Each now stops the build, gets doctor's line, or passes,
  as it should. Some of them:

```text
B1 tsconfig with a comment, --fix:
   only "extends" added; comment kept
C1 .gitignore with no last newline, --fix:
   node_modules / dist / .tinker/ / .tanstack/
C9 tsconfig with a trailing comma: doctor passes
B2 export * in a seam file: build EXIT 0
B3 import { tinker as base }: build EXIT 0
B6 a leak, then tinker prepare:
   doctor still names it
B7 components.json:2 does not parse
   (PropertyNameExpected): build EXIT 1
B8 style.css?url only in a comment: build EXIT 1
B10 vite.config.mts: build EXIT 0
M2 createFileRoute("/abuot") in about.tsx:
   build EXIT 1, src/routes/about.tsx unchanged
M3 a pin with no install: package.json:16 named
C5 tinker prepare with a clash:
   check 7's line, prepare EXIT 1
C8 a local const named Outlet: build EXIT 1
```

- The four areas reran on the fix3 pack
  (each area's `Rerun 3` section in `proof/stress-<area>.txt`):
  router 18 WORKS; server 16 WORKS;
  shadcn 7 WORKS, 2 NOT SUPPORTED;
  devloop 38 WORKS, 3 NOT SUPPORTED; 0 REGRESSED.
  Their last findings went into the final pack:
  `components.json` read as strict JSON,
  "fix check 7 first" on every check 3 line,
  a postinstall that never blocks an install,
  `vite.config.mts` type-checked,
  and only TanStack's imported `Outlet` counts.
- The final pack, every case copy built again
  (`proof/stress-sweep-final.txt`):

```text
26 case apps   build=0 doctor=0
import-protection   build=1 doctor=1 (on purpose)
fail  10 boundary
```

- The ten devloop mistakes
  (`proof/stress-devloop-mistakes-final.txt`)
  and the five shadcn cases give the same lines as on fix3.

### Re-review, round 3

Three small bugs, each with a test that fails without its fix
(`proof/round3-tests-before.txt`: 6 fail on commit `65356502`):

- An `extends` array that holds `./.tinker/tsconfig.json`
  now passes check 4; `--fix` puts that file first in an
  array that lacks it, and never drops a file.
  The same array crashed check 8's alias read; now it is read
  as tsc reads it, the last file winning.
- The route tree's `import('./…')`, which a lazy route
  (`about.lazy.tsx`) gets, counts as in the tree.
- A tsconfig.json with a byte order mark parses;
  `--fix` keeps the mark, and the file's tabs and CRLF.

The reviewer's cases N1 to N6, on the new pack
(`proof/review-cases-round3.txt`):

```text
N1 tabs, CRLF, comment, no extends, --fix:
   one line added, with a tab and CRLF
N2 extends ["./.tinker/…", "./strict.json"]: passes
N3 a byte order mark: build EXIT 0, doctor passes
N4 package.json with a trailing comma: named,
   never written
N6 package.json with tabs, no scripts, --fix:
   "scripts" added with tabs; still strict JSON
```

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

- `vp dev` still runs TanStack's generator over a route file:
  it fills an empty one with a template,
  and rewrites a wrong `createFileRoute` path.
  `vp build`, `tinker prepare`, and `doctor --fix` do not.
- A type error in `tests/` alone stops `vp build`:
  the build checks the same files `tsc` does.
- Adding or removing the shell or a seam file
  while `vp dev` runs prints one error line,
  then the restart; the page is fine a second later.
- Every dev restart logs Vite's own
  "transport was disconnected".
- `tinker upgrade` from 0.1.x runs the old CLI,
  so its old pin rule rewrites a `file:` tarball peer.
- Check 4 sees `paths` and `strict: false`
  in the app tsconfig and in each local file
  its extends chain reads after `.tinker/`.
  A package it extends, and other overrides,
  it does not judge.
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
