# Start base progress

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
