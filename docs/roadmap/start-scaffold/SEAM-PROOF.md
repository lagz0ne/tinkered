# Start seam proof

Branch: `start/seam`.
Worktree: `/home/paseo/next/tinkered-start-seam`.
Status: lead fix round saved for review.

## What changed

Fixed setup reaches user values through two alias imports.
The browser seam also fills the scaffold's open `Register`.
The sync tables, envelope schemas, fixed errors, and database handle moved into setup.
The database handle names no feature schema.
Telemetry's span-reader tag moved into setup.
Visible tool rows remain app data.
The feature transport now owns receipt error messages.
The fixed frontend entry no longer exports app data.
Seam files only export values and declare the type fill-in.
Resource nodes stay in declared dependencies; no tag carries one.
Core and React source did not change.

Code commits:

- `3bf7d3da`: isolate scaffold behind value and type seams.
- `8b177bfe`: enable shadcn seam alias rewriting and protect updates.
- `4eb2e263`: generate sync tables once and check schema stability.
- `c2fc3395`: guard every scaffold import form and prove refusals.
- `d1c12f09`: use static proof presets and complete contract 3 notes.

## Seam check: red, then green

The check reads `source` for an `import("...")` type expression.
It also checks import declarations, exports, and dynamic imports.
String module declarations and import-equals paths get the same path check.
The app's package name is read from `package.json` and refused.
Subpath imports starting with `#` are refused.
Glob imports are refused in the fixed folder.
Triple-slash reference paths must stay inside that folder.

The original tree failed on its outside server-entry import.
Historical log: `/tmp/start-seam-before.log`.
The fix-round proof plants one form at a time in a scratch copy.
Each forbidden form exits 1 and names its path:

- Relative export: `../errors.ts`.
- Type import: `../backend/database.ts`.
- Dynamic import: `../backend/database.ts`.
- Import-type expression: `../frontend/state.ts`.
- Self package: `@tinker-start-scaffold`.
- Self package frontend: `@tinker-start-scaffold/frontend`.
- Self package backend: `@tinker-start-scaffold/backend`.
- Self package proof: `@tinker-start-scaffold/proof`.
- Subpath import: `#frontend`.
- String module declaration: `../frontend/state.ts`.
- Import-equals: `../errors.ts`.
- Glob: `../backend/*.ts`.
- Triple-slash reference: `../backend/auth.ts`.

This legal type expression exits 0:

```ts
export type S = import("@tinker/core").Scope;
```

The real tree passes for all 28 scaffold files with exit 0.
Log: `/tmp/start-seam-review-final-seam.log`.
Each planted form also has its own log under
`/tmp/start-seam-review-proof-<form>.log`.
The legal log is `/tmp/start-seam-review-proof-legal-import-type.log`.
No scaffold type names profile, todo, or counter.

## Schema generation: red, then green

The old user sync-schema file re-exported the fixed tables.
Drizzle's config also loaded those tables from the fixed file.
The generator read each sync table twice.
The new copied-app check failed before the fix with exit 1.
It named duplicate `sync_event`, `sync_execution`, and `sync_stream` tables.
Red log: `/tmp/start-seam-review-schema-red.log`.

The user schema now defines only the feature counter table.
User operations import fixed sync tables directly.
The schema config keeps one owner per table.
The check copies schemas, config, migrations, and toolchain setup into a temp app.
It borrows `node_modules` and runs the installed `drizzle-kit generate`.
The fixed app exits 0 and says `No schema changes`.
No migration file or folder is added.
Green log: `/tmp/start-seam-review-schema-green.log`.
Final repeat: `/tmp/start-seam-review-final-schema.log`.
No SQL migration was needed.

## Different app proof

The fixture copies only `src/scaffold/` from the starter.
It supplies its own graph, records, two seams, route tree, and type fill-in.
Its change is `{ text: string }`.
Its result is `{ kind: "saved"; text: string }`.
Its snapshots carry a note, with no example feature bodies.
It imports no starter feature source.
`tsc --noEmit` returns 0.
Log: `/tmp/start-seam-review-final-fixture.log`.
This is a compile proof, not a live service proof.

## Alias and update proof

The installed shadcn 4.21.0 skips import rewriting for `registry:file`.
A real install under `@/app-lib` failed the import comparison with exit 1.
The unchanged import was `@/lib/tinker.server`.
Log: `/tmp/start-seam-registry-file-red.log`.
The installed CLI source inspection is saved too.
Log: `/tmp/start-seam-shadcn-source.log`.

Eight fixed files now use `registry:lib`.
Explicit targets keep those files under `src/scaffold/`.
The seam files keep `registry:file` and use alias targets:

- `@lib/tinker.ts`.
- `@lib/tinker.server.ts`.

shadcn puts them in the consumer's `src/app-lib/` folder.
Seam imports become `@/app-lib/...`.
All 90 copied files match source after that alias change.
Dry run changes no consumer file.
Runtime overwrite restores setup and keeps the edited feature file.
It keeps both edited seam files byte for byte.
Consumer build and types return 0.
The source version is `0.4.0`; setup contract is 3.
Before updating an older app's runtime:

- Add both seams and fill `Register` with its feature types.
- Import `readReceipt` from the app's own transport file.
- Stop defining sync tables in user code.
  Import the fixed sync tables directly.
- Build feature readers on the fixed envelopes.

The README and registry notes carry this complete contract 3 list.
The server entry uses the static `proofDatabase` and `proofMail` imports.
The preset module loads with the server seam, also in production.
PGlite loads inside the proof factory and runs only in proof mode.
The starter metadata and README state that distinction.
The unused `streamEnvelope` export was removed.
Repeated seam imports were merged.
The two promise lines now sit in the README's list of guarantees.

Proof: `/tmp/start-seam-registry-proof.json`.
Registry log: `/tmp/start-seam-review-final-registry.log`.
Consumer build log: `/tmp/start-seam-consumer-build.log`.
Consumer types log: `/tmp/start-seam-consumer-types.log`.

## Gates

Every current gate below returned 0 after the lead fix round.
The machine-readable list is [SEAM-GATES.json](SEAM-GATES.json).
Check reports zero errors and the same 28 warnings.
All 30 app tests pass.
Validate reports all 16 lanes pass.
The earlier writer round also passed all eight workspace test tasks.
The browser guard rejects both backend and server-seam imports.
The native middleware, SSE, account, and idle-close proof passes.

- **build**: exit 0.
  Log: `/tmp/start-seam-review-final-build.log`.
- **check**: exit 0.
  Log: `/tmp/start-seam-review-final-check.log`.
- **app-tests**: exit 0.
  Log: `/tmp/start-seam-review-final-app-tests.log`.
- **seam**: exit 0.
  Log: `/tmp/start-seam-review-final-seam.log`.
- **fixture**: exit 0.
  Log: `/tmp/start-seam-review-final-fixture.log`.
- **schema**: exit 0.
  Log: `/tmp/start-seam-review-final-schema.log`.
- **boundary**: exit 0.
  Log: `/tmp/start-seam-review-final-boundary.log`.
- **middleware**: exit 0.
  Log: `/tmp/start-seam-review-final-middleware.log`.
- **imports**: exit 0.
  Log: `/tmp/start-seam-review-final-imports.log`.
- **registry-build**: exit 0.
  Log: `/tmp/start-seam-review-final-registry-build.log`.
- **registry**: exit 0.
  Log: `/tmp/start-seam-review-final-registry.log`.
- **census**: exit 0.
  Log: `/tmp/start-seam-review-final-census.log`.
- **tsdoc**: exit 0.
  Log: `/tmp/start-seam-review-final-tsdoc.log`.
- **prose**: exit 0.
  Log: `/tmp/start-seam-review-final-prose.log`.
- **validate**: exit 0.
  Log: `/tmp/start-seam-review-final-validate.log`.
- **diff**: exit 0.
  Log: `/tmp/start-seam-review-final-diff.log`.

The strict census covers the nine TypeScript files changed since `dee04040`.
No changed TypeScript needs an exception.
TSDoc parsing reports zero errors.
The earlier full-source census kept the prior generated-file and proof-preset exceptions.

## Jev

Fix-round preflight returns 0 across the nine changed source files.
Log: `/tmp/start-seam-review-jev.log`.
Five repeat findings are labeled false with a reason.
They concern the retained process root, completed receipts,
and resource state used to hold pending work.
At landing, all 20 labels joined the shared bank in
[cases.jsonl](../../../tools/jev/cases.jsonl).
Printed label lines: `/tmp/start-seam-review-labels.log`.
No test file changed in this fix round.
The earlier test and promise judge results remain recorded in their original logs.

The ticket limits edits to the app, this track, and the lockfile.
That takes priority over the fixed brief's shared label-bank path.
The labels are kept here for the lead to merge at landing.
The lead must then run calibration as the landing rule requires.
No shared Jev tool or bank was changed.

## Assumptions and choices

- The supplied install and built dependencies are the starting point.
  No pull or dependency change needed another install.
- Feature readers remain app-owned and travel through the browser seam.
  They extend the fixed envelope schemas and check feature bodies once at each door.
- The counter table stays in user code.
  Fixed sync tables have one owner and are imported directly by feature code.
- Moving schemas changes ownership, not SQL.
  The generator proves no schema changes and no new migration files or folders.
  Stored notification bodies are unknown in fixed tables and checked by the app mail input.
- The span-reader tag is fixed setup.
  Visible telemetry rows stay in app data because the app displays them.
- The real CLI behavior overrides the brief's `registry:file` rewrite guess.
  Use `registry:lib` only for the eight fixed files that need import rewriting.
  Use `@lib/...` targets to place the install-once seams.
- The fixture proves types only.
  The registry consumer borrows installed dependencies and built Core/React.
  Package installation and external production services are outside these checks.
- Keep the prior full-source census exceptions for generated files and proof presets.
  The fix-round census checks only changed TypeScript; it needs no exception.
- Keep labels in this track because the ticket bars changes to shared tools.
  The lead merges and calibrates them when landing.
- Bump setup contract to 3 because older installs now need the seams.
  Source item version is `0.4.0`.
  This is a fix round on the unpublished draft, so its version stays the same.
  Nothing was pushed or published.
- The preset module is a static server import, as the lead requested.
  Only selecting the preset and loading PGlite remain tied to proof mode.
- The schema check owns its scratch app and removes it when finished.
  Native dependency installation and external services stay outside this check.

## Core feedback

No new Core friction was found.
No Core workaround or new API is needed for these seams.
The fixed graph still lists each resource in its dependencies.

## Next

The lead reviews the saved diff and the labels.
The lead lands the branch and publishes the rebuilt registry.
The board card was left for the lead; this writer did not mark it Done.
