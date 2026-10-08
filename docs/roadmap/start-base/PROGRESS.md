# Start base progress

## start/sync-test-warm

Owner: Sol writer; lead reviews and lands.
Next: lead review after the linked clean-commit fault proof.
Verify: the linked final fault log clears 75 on kills alone.

Each test file warms one PGlite database in `beforeAll`.
The base template includes the sync tables and wake trigger.
Each scope owns and closes its own `clone()`.
The file closes the template in `afterAll`.
The listener-refusal fixture now closes its client too.

The scaffold template stays empty.
Its tests still run the real migrate operation.
The two generated registry files copy that same test fixture.
No production source, test title, or test count changed.
No test, hook default, or Stryker timeout was raised.
Warm setup keeps the existing 60-second allowance.

Three verbose sync runs on each side ran beside the full test suite.
All twelve commands returned 0.
All runs kept 39 sync tests, 426 Start tests, and 25 scaffold tests.
The median test times were 1,499, 1,509, and 1,505 ms before.
They were 711, 746, and 735 ms after.
The slowest test fell from 4,238 to 2,049 ms across those runs.
[Every test time](proof/sync-test-warm-times.txt).

The original loaded runs and original fault dry run passed.
The old five-second timeout was not seen in this run.
No new regression test was added: the brief requires unchanged counts.
This proves less setup time under the tested load.
It does not prove every possible busy-host load fits five seconds.

Checks:

- Install, full build, and code check returned 0.
  Code check prints zero errors and the same 28 warnings.
- The full test suite and prose returned 0.
- The full scaffold check returned 0.
  All 90 emitted registry files match their source.
  Its real-service proof passed; nothing was published.
- `pnpm validate` returned 0; all 18 lanes passed.
- Three consecutive fault dry runs returned 0.
  Each ran all 426 Start tests.
- Jev pre-flight has zero flags.
  Start tests have zero flags among 186 entries.
  Scaffold tests have zero flags among 25 entries.
  Promise checks have zero gaps among 184 titles.
  There are 41 unsure titles, which need no label.
  TSDoc checks have zero rows; no labels were added.
- The strict style census returns 1 on this tree and on main.
  Its unchanged hits are `S16`, `T04`, and `T07`.
  It treats the scaffold's test fixture as source.
  Existing private imports and one error-text check still hit.
  No strict hit was added; cleanup stays outside this test-speed fix.

Assumptions and limits:

- No separate study or patch was supplied for this card.
  The Start server study covers other work.
- PGlite 0.5.8 has `clone()`; the copied databases stay isolated.
- The card exempts a timing queue verdict.
  The proof uses Vitest's own per-test times.
- Core feedback: none.

[Gate and judge proof](proof/sync-test-warm-gates.txt).
[Final clean-commit fault proof](proof/sync-test-warm-mutation.txt).
Only that fault log is committed after the full run.

## start/telemetry-fast

Owner: Sol writer; lead reviews and lands.
Next: lead review after the linked clean-commit fault proof.
Verify: each browser body is at most 32,000 UTF-8 bytes;
server records keep their 48,000-byte cap;
the built minimal client contains no zod.

The queue keeps each record's size from ingest.
One encoder is shared; flush never encodes records to size them.
Accepted records subtract their saved sizes from the queue total.
Queue health is published once per input batch.
The browser reserves its JSON envelope and commas.
A browser record over 31,976 bytes is dropped at ingest,
so an oversized record cannot stop the close drain.

Schemas moved to `records.server.ts`.
`records.ts` imports their types only.
The trusted ingest operation accepts records already made by the app.
The server route still checks outside data with zod.
Package `sideEffects: false` drops unused sync exports from the client.
The existing barrel exports and public types stay the same.
No upgrade note is needed.

The regression closes a browser-side scope with a backlog.
It uses non-ASCII records, a fitting large record, and an oversized one.
It checks every body and every record sent.
The test failed on clean `origin/main` at `df2a6da8`:
46,524 bytes exceeds 32,000.
It passes with the fix.

The queue probe's ten-run verdict: **b is faster**.
A median 2,531 ms; B median 1,145 ms.
The median gap is 54.8 percent.
The built minimal entry drops from 493,762 to 401,027 bytes.
Python gzip at level 9 drops from 153,581 to 128,110 bytes.
Its source map drops from 18 zod modules to zero.
The probe and the size counts are in [the proof](PROOF.md#y-telemetry-queue-and-client-bytes).

Gate notes:

- Install, full build, and code check returned 0.
  Code check prints zero errors and 28 warnings, the same as main.
- All 405 Start tests passed with one worker and a 30-second limit.
- The final normal recursive test run returned 0: all ten tasks passed.
  It includes all 405 Start tests at the normal five-second limit.
  Earlier runs timed out on three sync tests.
  No test or config file was changed to extend that limit.
- The full test set also passed with a 30-second limit under each own config.
  The Node-only Jev suite ran separately, without Vitest flags.
- Prose returned 0, with no hits.
- The full scaffold check returned 0.
  Its real auth, SMTP, migrations, two-tab sync, and profile proof passed.
  Earlier runs met another writer's fixed-subnet proof network.
  No Docker config was changed; each proof removed only its own project.
- `pnpm validate` returned 0; all 18 lanes passed.
- Jev pre-flight has zero file flags.
  Six resource flags are labeled false with reasons in the bank.
  The changed queue's five labels are new; the endpoint label already existed.
  Test quality flags no test entry; promise checks find no gap.
  Calibration is committed.
- Main then added the playground vendor fix; this branch was rebased.
  Build, code check, and all ten normal test tasks passed after that rebase.
- The final fault log names the clean code commit.
  Only its header and summary table are saved afterward.

Assumptions and limits:

- The cap includes the JSON envelope, not only records.
- The package metadata change is needed to drop unused sync schemas.
- Existing console calls and private test imports are kept.
  The full strict census reports the same S06 and T04 hits on main.
  The queue and schema files pass the strict census.
- The optional BigInt timestamp change is not taken.
  It has no separate verdict here.
- No new Chrome run proves page-close delivery under other keepalive traffic.
- No claim is made that sync-enabled apps contain no zod.
- Core feedback: none; no new workaround was needed.

## start/ssr-telemetry-root

Owner: Codex writer, branch `start/ssr-telemetry-root`.
Next: lead review after the linked clean-commit fault proof.
Verify: render close does not wait on a held storage send;
two renders share the process queue with side `ssr`;
process close sends their records.

### What changed

The server entry keeps its existing process telemetry root.
Each render borrows its observer.
Only the browser tab keeps its own telemetry root.
The process root still closes last and sends what is left.
The observer and its settings use one `ssr` namespace.
The queue stays owned by the process root.
This card changes no queue, observer, or record implementation.

### Tests and assumptions

Three tests use scopes, without a server or browser.
A gate holds storage open while render close finishes.
Two closed renders leave four records in the process queue.
Process close sends both traces and both log records with side `ssr`.
Telemetry off needs no storage settings.
The two-render test fails on main `105e85a0`:
its records have side `server`.
Main received only the test file and test-entry exports for that run.
Test defaults let the old part run without new fields.
The base tree was restored before timing.

The server entry's existing process root is the one owner.
No second process root is added, unlike the study's throwaway patch.
Four test-entry exports let the tests use the public test seam.
The browser's close result keeps its existing error order.
No publish or push is part of this card.

### Proof

The branch was rebased onto main `105e85a0`.
That main includes `start/telemetry-fast`.
Only the board and progress notes had conflicts.
Both cards were kept.
The old-base mutation run was stopped and does not count.

- Fetch and rebase: EXIT 0.
  A second fetch before the final proof found no new main commit.
- Install and recursive build: EXIT 0.
- `vp check`: EXIT 0; 28 warnings, the same count as main.
- Recursive tests: EXIT 0, all 10 tasks with normal test limits.
  Start: all 408 tests in 37 files.
  The three new scope tests are included.
- The two-render test on main: EXIT 1.
  It expected `ssr` and received `server`.
- Prose: EXIT 0.
- Full scaffold check: EXIT 0.
  Its real auth, SMTP, migrations, two-tab sync, and profile proof passed.
  The proof stopped only its own servers and Docker project.
  No Docker, host, DNS, or tunnel setting was changed.
- `pnpm validate`: EXIT 0, all 18 lanes.
- Jev pre-flight: EXIT 0, no flags.
  New tests: 0 of 3 flagged.
  Promises: 0 of 179 gaps; 46 unsure.
  Final labels: none needed.
- Strict style census on the changed source and new tests: EXIT 0.
- The final mutation result and kills-only floor are in
  [the mutation proof](proof/ssr-telemetry-root-mutation.txt).
  Only its header and summary table are committed after that run.
- [Gate proof](proof/ssr-telemetry-root-gates.txt).

### Queue verdict

The fresh `benchctl ab` run returned 0: **b is faster**.
A is clean main `105e85a0`; B is clean fix `9b2cf375`.
Each side starts `start-min`, sends 300 warm-up requests,
then 1,000 requests with 16 at once, and stops the server by PID.
Eight rounds, one run per side per round.
The shared lock kept the run apart from mutation work.
A median: 8,945 ms; B median: 6,281 ms.
The whole-side time fell 29.8%.
The 95% range for the gap was -2,840.7 to -2,383.8 ms.
Only proof notes change after this timed commit.
[Timing proof](proof/ssr-telemetry-root-ab.txt).

### Limits and Core feedback

The timing result covers the local app, not a real remote store.
The held-send test proves render close without a time guess.
Core feedback: none.

## start/registry-no-overwrite

Owner: Sol writer; lead reviews and lands.
Next: review the saved code and local proof.
Verify: examples keep edited app files;
doctor prints switches and exact seam exports;
build, doctor, and local HTTP pass after the hand edits.

### What changed

Only `app` owns its template files.
The registry build refuses an example that targets any of them.
It also refuses two items that own the same target.
The demo owns a new `/demo` page and its own env sample.
It copies no Vite config, tsconfig, package file, or seam.
The user's first page and scripts stay theirs.
The copied demo's home links point at `/demo`.

Each example names `meta.parts` and `meta.seams`.
A copied `src/examples/<item>.tinker.json` file holds those needs.
Doctor's named-files check reads it with no network.
It prints each missing part switch and exact seam export line.
It also checks that the server extensions list joins
`databaseSetup`, or re-exports the copied demo's startup list.
These findings stop a build too.
Doctor never applies these edits to the user's files.

### Item needs

- `app`: no required part or seam name.
  Telemetry stays on by default.
- `runtime`: no required part or seam name.
  It remains package-only.
- `mail-example`: no required part or seam name.
  It owns mail and the demo's error declarations.
- `todos-example`: auth and sync; the demo seam names below.
- `profile-example`: auth and sync; the demo seam names below.
- `auth-pages-example`: auth and sync; the demo seam names below.
- `counter-example`: auth and sync; the demo seam names below.
- `example-wiring`: auth and sync; the demo seam names below.
- `postgres-auth-mail-example`: auth and sync;
  the demo seam names below.
- `starter`: auth and sync; the demo seam names below.

The server seam names are `extensions`, `database`,
`auth`, `readAccount`, and `bootstrap`.
The extensions list must include `databaseSetup`.
The browser seam names are `records`, `readSnapshot`,
`readBootstrap`, `readBatch`, and `streamMessage`.
The copied browser module also adds the demo's `Register` bodies.
SMTP settings are needed only when mail runs.
Auth needs `AUTH_SECRET` and `PUBLIC_ORIGIN`.
Live sync needs Postgres and the copied migrations.

### Assumptions and scope

The existing demo's feature bodies stay together.
Each feature item adds its own requirements file
and depends on the shared Postgres demo.
Mail alone still works without auth, sync, or Postgres.
Starter now adds tests and guides to an existing app.
Its tests use paths into that app, so its package name is free.
Its guides use direct commands instead of adding scripts.
No base file or public package symbol changes.
No release version, release script, or upgrade URL changes.

### Proof

[Section X](PROOF.md#x-examples-keep-the-users-app-files)
and its full logs show the real CLI adds and byte hashes.
Nine fresh apps each pass build, doctor, and local HTTP.
The protected files and package scripts survive every add.
Doctor first names the missing switches and exports.
The proof applies those lines, then runs the checks again.
It uses real Postgres for startup and the demo page.
It stops servers by PID and removes only its own Compose project.
Nothing is published or pushed.

Eight new check tests pass.
Eight planted doctor breaks are caught.
Jev finds no new test flag or promise gap.
The old Start file notes concern unchanged private imports
and helpers; they remain outside this card.
No new Jev label or calibration row is needed.
The final gates, release checks, and mutation counts
are saved in the linked logs.

The first two HTTP proof tries could not reach Docker services.
Docker's host loopback is outside this workspace.
The final run uses the same owned TCP relay as the source app proof.
A first copied-starter build found its old package-name imports.
The final registry rewrites those to the consumer's app paths.
It also adds PGlite through the item's dev dependency field.

The branch caught up with the local GitHub release work.
The final CLI proof uses the three packed 0.7.0 packages.
The release URLs and version rules stay as that writer left them.
The root test run passes 1704 tests, with one existing skip.
Start passes 401 tests; the source app passes 25.
All 17 release checks pass; lint has 28 warnings and no error.

An early mutation dry run hit an existing PGlite test timeout.
Its unchanged retry passed the kills-only floor.
Main then moved, so that run is not the final mutation proof.
The linked mutation log is rerun on the clean rebased code commit.
Only that log is saved after the final run.

Core feedback: none.

## start/shadcn-registry

Owner: writer on `start/shadcn-registry`; lead reviews and lands.
Next: review the saved local registry proof and gates.
Verify: an empty folder becomes a served page in one add;
examples build, doctor passes, diff and upgrade keep user files.

### What changed

The source registry has ten items.
`app` is the ten-file small app, written once.
`runtime` and `starter` remain for old users.
The base stays in its package and updates through `tinker upgrade`.
Examples are copied user files and update through `shadcn add --diff`.
`registry:build` reads source and writes all emitted items.
`test:registry` checks every item and the full registry index.
It refuses base targets and duplicate targets within an item.
It builds the small app and the complete demo in scratch folders.
The complete demo also passes its plain check there.
The real CLI proof runs as a script, outside scope tests.

### Assumptions

The existing demo's feature bodies and page links stay joined.
A feature item that needs sync depends on the complete demo.
It copies auth, sync wiring, features, and migrations together.
The config it copies is `tinker({ auth: true, sync: true })`.
It replaces the first page and empty seams at the first copy.
This needs `--overwrite`; later updates start with `--diff`.
The mail item alone needs neither auth, sync, nor Postgres.
It needs SMTP settings only when it sends mail.
The minimal env example has only optional commented settings.
This lets a new small app pass doctor without creating a secret.
The demo has the full env example and needs `.env` before doctor.
The upgrade target is a local version-bump fixture, 0.6.1.
No published release or new base behavior is claimed.
The proof keeps its scratch folder for review.

### Proof

[Section V](PROOF.md#v-one-local-shadcn-add-starts-an-app)
and the [full log](proof/18-shadcn-registry.txt)
show the CLI copy, package install, build, doctor, and HTTP 200.
They also show source diff, unchanged base bytes,
upgrade with unchanged source and config, and server cleanup.
Three raw NUL bytes from the HTTP reply are escaped in the text log.
No package or registry is published.

### Gates and retries

The final chain ran one step at a time and returned 0.
Build, check, all package tests, prose, and the app check passed.
The root tests passed 1840 checks, with one existing skip.
The app passed 25 scope tests.
The registry check matched 142 emitted files in ten items.
The real-service gate passed auth, SMTP, migrations,
two-tab todo sync, and profile save.
It stopped both browser sessions, its server and relay PIDs,
and removed only its own Compose project.
`pnpm validate` passed all 17 release checks.
Check has 28 warnings; the main check tree has the same 28.
Jev preflight returned 0 with no TypeScript source changes.
No TypeScript tests changed, so the test judges were not needed.
No labels or calibration changed.
No mutation run was needed: `packages/start` did not change.

An early test run hit the five-second tsc test timeout.
The retry passed without changing that test.
An early Compose gate overlapped the release size build,
which briefly removed Core's built files.
The final gate ran after those jobs ended and passed.
One main-check setup command ran in `/tmp` by mistake.
It made a package file and lockfile there.
Only those new files and the empty node_modules folder were removed.
Both affected main tests then passed, 11 checks in two files.
The main check worktree was removed after its checks.

### Core feedback

No Core change was needed.
The base host prints the requested port when it is zero,
instead of the real port chosen by the OS:

```bash
HOST=127.0.0.1 PORT=0 npx tinker serve
# Prints: tinker serve: http://127.0.0.1:0
```

The proof chooses a free fixed port before starting the host.
No base code or doctor check is changed by this card.

## start/scaffold-on-base, Step 1

Owner: Sol writer; lead reviews and lands.
Next: lead reviews and lands Step 1, then sends Step 2.
Verify: build, doctor, all package tests, and two tabs.

Assume Step 2 owns the old app check scripts and registry.
The flight reference keeps its own fixed copy for now.
No trial image is rebuilt.

### Impact before code

Add `httpRequest` to the base server entry.
Add the testing entry named by ADR 0106.
Export sync tables for the app queries and migrations.
Export base error types for app error guards.
The app, its tests, and the HTTP import proof use these.
The flight reference still uses its own copy.
No existing public symbol changes its shape.

### What changed

The app uses `tinker({ auth: true, sync: true })`.
Telemetry stays on by default.
Its tsconfig extends `.tinker/tsconfig.json`.
The copied driver, entries, and part routes are gone.
The page routes, examples, and migrations stay in the app.
The client and server seams export the app's units.
App settings read the base's injected env tag.
Settings failures keep the managed `BadSettings` error.

The base now exports `httpRequest`, request headers,
sync tables, error types, and the testing entry.
The HTTP resource and tests moved from the app to the base.
The generated parts use the real installed package path.
This keeps one sync Register in a linked workspace.
Auth settings now import JSON with its native Node attribute.
The old named JSON import blocked the public server entry.
Its plain import fails without this fix and passes with it.
The writer import test now uses the public entry itself.

The new prepare test fails without that fix.
It passes with the fix.

### Dropped app tests

All replacement paths below start at `packages/start/tests/`.

- `transport.test.ts`: `server.test.ts` and `requests.test.mjs`.
  They cover scope binding, reply ownership, and body cancel.
  The missing active-work cancel case moved to the base too.
- `telemetry.test.ts`: `telemetry.test.ts`
  and `telemetry-ingest.test.ts`.
  They cover storage sends, retries, budgets, and ingest.
- `tab-lifetime.test.ts`: `sync-client.test.ts`.
  It covers tab close and sibling tab ownership.
- `protocol-wire.test.ts`: `telemetry-ingest.test.ts`,
  `sync.test.ts`, and `auth.test.ts`.
  They cover the part routes' replies and owned bodies.
- `protocol-params.test.ts`: `telemetry-ingest.test.ts`
  and `sync.test.ts`.
  They cover origin, malformed input, and stream rules.
- `http.test.ts`: moved to base `http.test.ts`
  and `span-tree.test.ts`; its cases were kept.

Six app suites stay: backend, todos, sync, sse,
sync-client, and waste.
They call app units through a scope with test data sources.
They run no framework, build, server, or browser.

### Check split for Step 2

No new doctor check was added in Step 1.
The old scripts are still named app checks pending Step 2.
These are their targets and reasons:

- `scripts/check-seam.mjs`: doctor 5 and 6.
  The base now owns its seam names and legal imports.
  Rewrite the old scan of `src/scaffold/`.
- `scripts/check-boundary.mjs`: doctor 10.
  The plugin owns browser and server import rules.
  Its old proof reads the deleted app router.
- `scripts/check-plain.mjs`: keep the named app check.
  Strict app forms and business code are app rules.
  Replace its copied-driver symbol paths with base exports.
- `scripts/check-schema.mjs`: keep the named app check.
  The app owns the migrations and wake trigger.
  Its copied fixture must run prepare first.
  Current run fails because `.tinker/tsconfig.json` is absent.
- `maintain/check-imports.mjs`: keep the named app check.
  Loading the app backend must not start its services.
  The public server entry loads in native Node now.
  The current run fails on loaded drizzle schema modules.
  The library-load rule must allow base schema declarations.
- `maintain/check-middleware.mjs`: keep the named app proof.
  The app's SSR and server functions must share middleware.
  Replace deleted start, server, and sync route paths.
- `maintain/check-serve.mjs`: keep the named app proof.
  A built app must serve with its own seams.
  Use `tinker serve` in place of the deleted app entry.
- `maintain/check-seam-fixture.mjs`: keep the named app proof.
  An app with other record bodies must work too.
  Install the base and prepare, rather than copy the driver.
- `maintain/check-registry.mjs`: keep the named app proof.
  Example install and update rules belong to the registry.
  The removed runtime item must become a base dependency.
- `maintain/check-compose.mjs`: keep the named app proof.
  Real Postgres and SMTP are this app's dependencies.
  Replace its old serve command and copied entry paths.

### Outside users

- `tools/jev/plain.test.mjs` reads the base HTTP backend.
  Fixed old-path examples stay as check input text.
- `tools/jev/plain.mjs` now gives HTTP advice using
  `@tinker/start/server`.
- `tools/jev/http-fix.test.mjs` checks that filled-in advice
  in a small plain TypeScript tree using the base types.
  It does not copy or build the app.
- `tools/jev/lifetime.test.mjs` needs no change.
  Its old path is plain input text, not a file it loads.
- `tools/writer-trial/flight-import.test.mjs` imports
  `@tinker/start/server` in plain Node.
  Its former Vite build inside a test is gone.
- `tools/flight-trial/reference` keeps its own fixed copy.
  Its self-imports resolve there, rather than into this app.
  Build, types, tests, and plain check pass in a temp copy.
  Its route types need the normal build before typecheck.
- Old gate JSON files are records of past runs.
  Their old paths remain true for the recorded commits.
- Pinned runner trees were not touched.

### trial/base-image follow-up

`tools/writer-trial/flight-image.mjs` still reads the old
runtime registry item and hashes its source files.
It cannot make an image from this Step 1 tree.
No image was rebuilt.
The follow-up must:

- Pack and install `@tinker/start` with Core and React.
- Take the base's peer pins and file hashes in the image.
- Replace the runtime copy and `scaffold.json` hash guard
  with doctor check 2, run on the packed base.
- Run prepare after an install that skips postinstall.
- Ignore generated `.tinker/` and `.tanstack/` files.
- Port the fixed reference's imports, tests, and plain check
  when that reference next moves onto the base.

`registry.json` still lists deleted copied-driver files,
entries, routes, and tests.
`maintain/build-registry.mjs` cannot read those files.
Step 2 must remove the runtime copy item;
`start/shadcn-registry` then adds template and example items.
Their dependencies must install the base package.
No registry was built in this step.

### Proof and limits

[PROOF section T](PROOF.md#t-the-scaffold-runs-on-the-base)
links the real build, doctor, auth, mail, and two-tab run.
The proof cleans up its own PIDs and Compose project.
Two browser sessions stand in for two targets in one browser,
because Lightpanda accepts only one target per session.
A temp network and owned relays work around host networking.
Packed hashes, telemetry storage, and email clicks were not proved.

The graph gate allows only the HTTP wire span from ADR 0102.
The two-hands gate now names Start as a driver package.
The old gate also failed on a clean main worktree.
Main and this branch both have 28 lint warnings.
No Core code changed. Core feedback: none.

### Gates seen

- Fetch and rebase: exit 0.
- Install: exit 0.
- Recursive build: exit 0, 11 tasks.
- Check: exit 0, 28 warnings, as on main.
- Recursive tests: exit 0, 1,838 passed, one old skip.
  Core 856; React 118; Start 387; scaffold 25.
  Jev 148; blueprint 148; flight trial 87.
  Core example 4; React example 64; playground 1.
- Writer tools: exit 0, 92 tests.
- Fixed flight reference: build, types, tests, plain, exit 0.
  The reference has three flight HTTP tests.
- Validate: exit 0, all 17 lanes.
- Real proof: exit 0; build and doctor pass.
- Style census and TSDoc: exit 0.
- Prose: exit 0, no hits.
- SCIP: Start index and public export refs, exit 0.
- New doctor breaks: none; no doctor check was added.

Jev flags about env settings, module loads, and cleanup
were labeled false with reasons.
Settings come from the env tag;
module loads start no service work;
mail and database stay open for committed work to finish.
Database cleanup is registered with defer before return.
A request's URL and method are input, not app settings.

The changed tests have zero model or plain quality flags.
The last focused run covers 48 seam titles and four request titles.
Unchanged base suites still have old private import notes,
and the old large fixture notes in sync-client,
sync-tab, and sync.
They are outside this move; no new private test import was added.
The HTTP and late-account promise gaps were filled in the README.
The app has no promise gap.
Calibration is saved with the labeled bank.
The final mutation log must name clean code HEAD;
only that log is committed after the run.

## start/scaffold-on-base, Step 2

Owner: Codex writer; lead reviews and lands.
Branch: `start/scaffold-on-base-2`, from `fc276a61`.
Next: review this saved step; do not publish the registry.
Verify: all named checks, registry build, doctor breaks,
repo gates, and a clean-commit mutation run.

### Assumptions

Follow the brief's split for plain and schema checks.
ADR 0106's older plan put plain in doctor;
the brief keeps this app rule as a named check.
The source registry prepares the current full demo.
A separate app template and a real registry CLI install
belong to `start/shadcn-registry`.
No trial image is rebuilt.

### Check owners

- `scripts/check-seam.mjs`: removed.
  Doctor 5 already checks the names read from both seams.
  Doctor 6 already reverses the old copied-folder rule:
  app imports use only the base's public entries.
  Add its missing module declaration, import-equals,
  and absolute base path rules.
  Two direct check tests fail without these fixes.
  Three planted breaks are caught.
- `scripts/check-boundary.mjs`: removed.
  The plugin already enforces browser and server imports.
  Doctor 10 reports the last build's violations.
  No new boundary rule or duplicate proof is needed.
- `scripts/check-plain.mjs`: named `check:plain`.
  App forms and app HTTP rules stay app rules.
  Resolve base symbols from the installed package.
  Remove copied-folder and app-root exceptions.
  Regenerate the list: ten app functions, cap 17.
- `scripts/check-schema.mjs`: named `test:schema`.
  App migrations remain app files.
  Prepare the copied app before schema generation.
- `maintain/check-imports.mjs`: named `test:imports`.
  Service clients load only inside factories.
  Drizzle table declarations may load at import.
- `maintain/check-middleware.mjs`: named `test:middleware`.
  App SSR, routes, and server functions share one session.
  Use the public base entries and named Start file.
- `maintain/check-serve.mjs`: named `test:serve`.
  The base host must serve the app's native JSON reply.
  It runs `tinker serve`; the copied host script is gone.
- `maintain/check-seam-fixture.mjs`: named
  `test:seam:fixture`.
  Notes compile on the base with their own Register bodies.
  It prepares fresh paths and copies no demo feature.
- `maintain/check-registry.mjs`: named `test:registry`.
  Emitted files must match their live source.
  The complete copied app must build and pass plain.
- `maintain/check-compose.mjs`: named `test:compose`.
  Real Postgres, auth, SMTP, and browser sync need a proof.
  It uses the owned Compose proof, with PID cleanup.
  The proof now saves a profile through its split page.

`vp run @tinker-start-scaffold#check` runs them all.
It builds the registry before checking the emitted files.
These proof scripts run outside unit tests.

### Example ownership

Nine items are built locally.
`runtime` has zero files and installs `@tinker/start`.
Todos, profile, auth pages, mail, and counter
have separate copy-in items.
`example-wiring` owns shared state, UI, sync, and migrations.
The full example and starter join those items.
Each file has one owner and keeps its app path.
Auth and profile forms and actions now have separate files.
The old action entry re-exports them for existing users.
Examples name their needed parts in their metadata.
They do not pin the base again during an example update.

The registry check uses the installed workspace dependencies.
It does not prove an independent package install,
a shadcn CLI add, or a base upgrade across releases.
Those proofs stay with the publishing card.

### Outside users

No outside consumer source changes in this step.
The fixed flight reference keeps its old copied runtime
and its own plain check; its package tests stay green.
Jev's import snippet still uses the public base server entry.
Writer import tests still read the app's shipped guides.
Those guides now name the base's public entries.

`trial/base-image` must pack and install Start with Core
and React, using `@tinker/start: file:./start.tgz`.
It must replace the empty runtime-file hash list with
packed base bytes and run its trusted doctor.
Replace copied seam and folder checks in `flight-check.mjs`.
Ignore `.tinker/` and `.tanstack/`, not a route tree in src.
Use a new image tag; never change a pinned runner tree.
The new source registry alone does not make that image work.

### Proof

[PROOF section U](PROOF.md#u-the-app-checks-and-example-items)
links the check, regression, and real-service logs.
No public API changes across packages.
Core feedback: none.

## trial/base-image

The Flight image installs packed Start, Core, and React.
Start is `0.6.0`; its four tested peers match.
The image runs `tinker prepare` after installing with scripts off.
Generated `.tinker/`, `.tanstack/`, and route files are ignored.
The seed copies app source without reading the registry.

The gate uses the image's trusted Start CLI.
It runs prepare and doctor on the submitted app.
Doctor check 2 checks the installed base's packed file hashes.
A planted edit to `src/routes/tinker.tsx` is named and blocked.
The old `scaffold.json` check and copied seam checker are gone.
The trusted plain check stays.
Doctor 10 skips before the first build;
the following builds enforce browser and server imports.

### Saved image

- Tag: `tinker-writer-flight:20261007.base.1`.
- ID: `sha256:ac92a1f0d212037d39eced87b347b61d73b8166c835e9c8409e1a93d6968e06a`.
- Keeper: `tinker-flight-keep-20261007.base.1-app`.
- Tar: `/home/paseo/.local/share/tinker-writer-trial/image-20261007.base.1/image.tar.gz`.
- Services stay `tinker-flight-services:20261004160855439`.
- Old images, keepers, and tarballs stay saved.

### Round proof

Trial `flight-base-20261007-base-1-pass` staged round 1.
The fixed reference was ported at proof time.
Its historical source was kept.
No model writer ran.
The seed passed doctor and build offline without an install.
The reference passed 28 app tests and three browser cases.

```text
ROUND 1 machine-pass; own 0; teacher 0; Jev 0
```

The score has one passed round and no failed round.
Its status is pending because rounds 2 through 5 were not run.
Normal cleanup removed the trial's containers and volumes.
Saved results remain outside the temporary project.

Proof runner: `tools/writer-trial/harness/prove-base-image.mjs`.
[Build, round, isolation, and check log](proof/19-trial-base-image.txt).
The writer-trial README lists the new image flow and proof command.

### Checks and limits

Build, check, package tests, prose, and writer tests returned 0.
Full test run: 1,840 passed and one skipped.
That includes 1,692 package tests and 148 plain-rule tests.
Writer-trial tests: 93 passed.
The doctor gate test fails with the old gate and passes with this gate.
The isolation proof passed and removed its own containers.
All 17 deterministic budget lanes passed.
Jev preflight: zero flags.
Jev test review: zero flags across 38 entries.
No label lines were needed.
The promises tool only reads package TypeScript tests;
it cannot read these tool `.mjs` tests.
No package tests or Start package files changed.
No mutation lane was needed.

### Assumptions and deviations

Round 1 is the requested single-round proof.
The reference port uses the current base's auth, database, and mail setup.
It keeps the Flight tables and migrations from the fixed answer.
It removes old framework entry files and unused seed form helpers.
The checked-in reference remains unchanged.
An early grade caught a missing Flight schema path;
the port was fixed, then a fresh trial passed.
An early parallel package run hit a five-second type-check timeout.
The retry passed; the last run schedules one package at a time.
Rounds 2 through 5 and real model writers remain unproven.
Nothing was pushed or published.
Core feedback: none.

## start/github-release

Writer: Sol, branch `start/github-release`.
Core, React, and Start now share `0.7.0`.
One tag names the set tested together.
Core and React changed only their package versions.
The registry file lists did not change.

The dry release script builds and packs three tarballs.
It writes asset sizes and sha256 in `manifest.json`.
It fills app packages and registry links with GitHub URLs.
The script has no publish mode and never calls `gh` or git.
Upgrade writes three release URLs and installs the set.
It still refuses edited base bytes before a package write.
The new base's tested peers are read before install.
This avoids an old exact peer making npm refuse the new base.
All three Tinker specs stay release URLs during that peer rewrite.

Proof: [20-github-release.txt](proof/20-github-release.txt).
The local mirror keeps GitHub paths and changes origins only.
Its packed upgrade code uses the local origin too;
its byte pins are made again, only for this proof.
The original dry tarballs stay untouched.
The proof checks their byte pins before its URL edit.
A single shadcn add in an empty folder passed.
Install, build, doctor, GET /, and a version-only upgrade passed.
All user files stayed the same; every server stopped by PID.
The three new URL specs have plain function tests.
The upgrade test failed against the old upgrade code.

Assumptions: all three share Start's next version, `0.7.0`.
`0.7.1` is a dry fixture, not a code change or a public release.
The README keeps the requested shadcn command on one line.
Gates: [20-github-release-gates.txt](proof/20-github-release-gates.txt).
Fetch, rebase, install, full build, check, all package tests,
prose, scaffold check, and all 17 validate lanes returned 0.
Check printed 0 errors and 28 warnings.
The root test tasks passed 1,844 tests, with one skipped.
Start passed 393 tests; 12 are the upgrade and URL function tests.
The regression log shows the new URL test failing on the old code:
[20-github-release-regression.txt](proof/20-github-release-regression.txt).

Jev preflight: zero flags; it does not read `.mjs` files.
Jev checked the two changed `.mjs` test files by path:
zero flags across 12 entries.
The package test review's notes are in old TypeScript tests.
No TypeScript file changed here.
The strict census prints the same T04 and T07 hits on main.
The promises tool reads TypeScript tests only.
Two old README gaps were filled; the last run has zero gaps,
with 44 unsure answers below its 70% floor.
No judge label lines were needed.

Final clean-commit mutation proof:
[20-github-release-mutation.txt](proof/20-github-release-mutation.txt).
That log names the code commit and records kills alone.
Only that log is committed after the last mutation run.

The final HTTP proof ran alone.
An earlier overlapping build failed; the gate passed,
and the proof was rerun after the gate ended.
No Core feedback: this work adds release paths, not Core behavior.
Nothing was tagged, pushed, or published.

## start/serve-fast

- Owner: Codex, branch `start/serve-fast`.
- Scope: built files, host compression, client compile hint.
- Assumption: the build stays fixed until the host restarts.
- Assumption: build output may run before prerendered HTML
  exists; HTML without a build copy uses stream compression.
- The file set replaces failed filesystem reads on page misses.
- The client build writes Brotli and gzip copies.
- The host compresses JS, CSS, and HTML by accepted encoding.
- Hashed assets keep a one-year cache; other files revalidate.
- The entry hint changes the output hash and shifts source maps.
  `tinker({ compileHints: false })` turns it off.
- Tests are plain glue tests; no server or browser in a test.
- Wire and Chrome proof below ran before telemetry-fast landed.
  The byte and trace counts describe that earlier bundle.
- Curl, default start-min build:
  - JS: 493,719 B before; gzip 153,948 B; Brotli 133,123 B.
  - HTML: 2,063 B before; gzip 1,092 B; Brotli 1,038 B.
  - The 1 B CSS file grows to 21 B gzip or 5 B Brotli.
    Small files can grow when compressed.
  - JS and CSS keep the one-year cache.
    JS, CSS, and HTML vary by accepted encoding.
  - HEAD has no body and keeps the chosen encoding.
- Queue: **verdict: b is faster**.
  Eight pairs, one run per side; 5,000 page-file misses.
  A: clean `origin/main` tree at `105e85a0`.
  B: clean tree at `84adba42`.
  A median: 956 ms; B median: 132 ms.
  This measures file lookup, not the whole app request.
- Chrome: three cold loads per side, fresh browser each time.
  Main-thread lazy functions: median 872 before, 17 after.
  `V8.CompileCode`: median 429.1 ms before, 1.0 ms after.
  Each load showed Hello, world and finished hydration.
  The shared host was busy; total page speed is not proven.
- A source-map build also passes:
  the entry starts with the hint, and its map starts with
  an empty line; 145 source files are mapped.
- Thirteen new glue tests; four old-behavior checks fail
  with main's serving code behind a call-shape adapter.
  They cover the fixed file list, cache and HEAD rules,
  on-demand compression, and use of the built copy.
- A public gzip download keeps its raw bytes and has no
  response encoding, even when the client accepts Brotli.
  Its new test failed with the first guard and passes now.
- Package tests: 417 pass with a 60 s default timeout
  and two workers; changed glue tests: 30 pass unchanged.
  After telemetry-fast landed, all 418 package tests pass
  in the whole default test run.
- Gates: build 0, check 0, tests 0, prose 0,
  scaffold 0, validate 0 (18 lanes).
  The first rebased run hit the known supplier timeout.
  Its full retry passes.
  Earlier flight and typecheck timeouts also ran on main;
  the final whole run passes without raised timeouts.
- Scaffold check: first run 1, Postgres health check failed;
  full reruns 0; main's compose check also passes.
- Jev: preflight 0; tests 0 flags; promises 0 gaps.
  No labels were added.
  The source judge and promise list skip `.mjs` files;
  the test judge read the changed `.mjs` tests by path.
- The old-base mutation passed but does not count.
  The final mutation runs on the rebased clean HEAD.
- Mutation: read the clean-tree header and table in
  `proof/serve-fast-mutation.txt`; floor 75 on kills alone.
- [Receipts](proof/serve-fast-gates.txt).
- Kept the study's entry-only hint and map shift.
  Added a hash contribution so the hint changes the URL.
  Brotli quality is 11 at build and 4 while serving.
- No Core feedback: this change uses plain host glue.
- Held: total SSR speed, Chrome memory, other browsers,
  and prerendered HTML created after the output hook.

## start/sync-fast

Writer: Codex, branch `start/sync-fast`.
The study patches share one row read at each cursor and wake.
Each session keeps its own account check.
A page of fewer than 100 rows skips the next empty read.
Read failures leave the shared map so a later stream can try again.
The map is released at each wake and when its last stream closes.

The request owns a watch loop even while its client stops reading.
It checks the account at wakes and at each 10 s heartbeat.
It closes at the 30 s lease before sending another heartbeat.
Heartbeat frames wait for a pull and never build up for a stalled client.
The request stops and awaits the loop on close.
A shared symbol stops waits without building an exception stack.

The scaffold's home loader still awaits its snapshot.
It returns no data, so only the sync store sends the snapshot.
No component reads home loader data.

The lease and stalled sign-out tests both failed before the fix.
All 38 sync tests passed before the final retry test was added.
The two stalled-client tests and the retry test pass too.
The home page changed from 9,268 to 9,193 bytes.
Its visible body stayed the same, and one snapshot copy is gone.
All normal test tasks pass: Start has 426 tests, including 39 sync tests.
The first full run hit the 5 s limit in the new shared-read test.
The five new database tests now have a 30 s limit, with no sleep waits.
Source census passes; seven private imports and one error-message check
in the old glue test file are the same on clean main.
Jev found no source-file flags and no test-entry flags.
Four resource flags were labeled false with ownership and close checks.
The two changed judges were calibrated; the other scores are retained.
The promise check has no gap and 39 unsure answers.
Proof: [regressions](proof/23-sync-fast-regression.txt),
[HTML](proof/23-sync-fast-html.txt),
and [Jev](proof/23-sync-fast-jev.txt).
The 100-stream queue verdict is `b is faster`.
Whole-probe medians: 11,670 ms before, 7,824 ms after.
The 1,000-stream queue verdict is `b is faster` too.
Whole-probe medians: 15,295 ms before, 8,773 ms after.
Both runs use five rounds and one timed run per side in each round.
Both roots use a test clock so the lease cannot end the probe.
The probe keeps PGlite account reads on, one per session per wake.
A separate queued count at 1,000 streams saw 2,000 event reads become one.
Opening reads changed from 1,000 to one.
Account reads stayed at 1,000 per commit; both sides sent 1,000 frames.
Proof: [queue verdicts](proof/23-sync-fast-bench.txt)
and [gates](proof/23-sync-fast-gates.txt).
Main moved during the first mutation run, so that run was stopped.
The branch was rebased onto `871b5a92`; no sync code or test changed.
Install, build, and every normal gate passed again after the rebase.
The scaffold's plain proof caught all 177 planted cases.
Its doctor needs local settings and passes with `.env.example` values.
No local services or secret values were added for that doctor check.
After the serve card landed, the branch was rebased onto `4423d86e`.
Both progress notes were kept; sync code and test limits stayed the same.
Install, build, and every normal gate passed again on this base.
Required final proof: a clean code commit and mutation kills alone at least 75%.
The commit and result go in [the mutation log](proof/23-sync-fast-mutation.txt).
Only that log is committed after the final mutation run.
Real Postgres speed and a shared heartbeat timer are not proven.
Assumption: keep account reads per session and timers per stream.
The optional shared heartbeat timer is not part of this card.
Core feedback: none.

## start/lazy-modules

Graph code takes outside libraries from lazy modules (ADR 0107).
Ticket 1 of 2: the base and the checker.
Ticket 2, `scaffold/lazy-modules`, starts on this branch.
[Brief](LAZY-MODULES-BRIEF.md).

```impact start/lazy-modules
start  drizzleOrm  src/modules.server.ts src/server.ts src/parts/sync/history.server.ts src/parts/sync/stream.server.ts
```

A library's error must not cross into graph code (user, 2026-10-08).
Read with the non-throwing form, such as `schema.safeParse`, and check `.success`.
So `ZodError` is never thrown or named inside a body.
Build each schema at top level; the body only calls its methods.
No lazy module for zod: zod stays a top-level import.

### Writer assumptions

- Each src root uses its nearest TypeScript config.
- Checks share installed packages with this worktree.
- The red proof uses a clean, detached checkout of `main`.
  It sits inside this worktree and is removed after the run.
- Keep Vite's locked TypeScript 7 peer choice.
  The checker alone imports the TypeScript 5.9 alias.
- The impact check is `scripts/scip.sh refs drizzleOrm start`.
  The brief names no old symbol to remove.
