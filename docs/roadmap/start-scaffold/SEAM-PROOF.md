# Start seam proof

Branch: `start/seam`.
Worktree: `/home/paseo/next/tinkered-start-seam`.
Status: saved for lead review.

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

## Seam check: red, then green

The check parses imports, exports, dynamic imports, and import types.
It refuses relative paths outside the copied scaffold.
It permits only the two user aliases, the generated route tree, and package imports.

The actual old tree failed with exit 1.
It named `../../backend/index.ts` in the server entry.
Log: `/tmp/start-seam-before.log`.

The repeatable proof plants this export in a copied scaffold:

```ts
export { fail } from "../errors.ts";
```

That check exits 1 and names the outside path.
Log: `/tmp/start-seam-planted-red.log`.
The real tree passes for all 28 scaffold files with exit 0.
Log: `/tmp/start-seam-final-seam.log`.
No scaffold type names profile, todo, or counter.

## Different app proof

The fixture copies only `src/scaffold/` from the starter.
It supplies its own graph, records, two seams, route tree, and type fill-in.
Its change is `{ text: string }`.
Its result is `{ kind: "saved"; text: string }`.
Its snapshots carry a note, with no example feature bodies.
It imports no starter feature source.
`tsc --noEmit` returns 0.
Log: `/tmp/start-seam-final-fixture.log`.
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
Static and dynamic seam imports become `@/app-lib/...`.
All 90 copied files match source after that alias change.
Dry run changes no consumer file.
Runtime overwrite restores setup and keeps the edited feature file.
It keeps both edited seam files byte for byte.
Consumer build and types return 0.
The source version is `0.4.0`; setup contract is 3.
An older app needs both seams and its type fill-in before updating runtime.

Proof: `/tmp/start-seam-registry-proof.json`.
Registry log: `/tmp/start-seam-final-registry.log`.
Consumer build log: `/tmp/start-seam-consumer-build.log`.
Consumer types log: `/tmp/start-seam-consumer-types.log`.

## Gates

Every gate below returned 0.
The machine-readable list is [SEAM-GATES.json](SEAM-GATES.json).
Check reports zero errors and the same 28 warnings.
All eight workspace test tasks pass, including all 30 app tests.
The existing Blueprint live-key test stays skipped.
Validate reports all 16 lanes pass.
The browser guard rejects both backend and server-seam imports.
The native middleware, SSE, account, and idle-close proof passes.

- **build**: exit 0.
  Log: `/tmp/start-seam-final-build.log`.
- **check**: exit 0.
  Log: `/tmp/start-seam-final-check.log`.
- **workspace-tests**: exit 0.
  Log: `/tmp/start-seam-final-workspace-tests.log`.
- **boundary**: exit 0.
  Log: `/tmp/start-seam-final-boundary.log`.
- **middleware**: exit 0.
  Log: `/tmp/start-seam-final-middleware.log`.
- **imports**: exit 0.
  Log: `/tmp/start-seam-final-imports.log`.
- **seam**: exit 0.
  Log: `/tmp/start-seam-final-seam.log`.
- **fixture**: exit 0.
  Log: `/tmp/start-seam-final-fixture.log`.
- **registry-build**: exit 0.
  Log: `/tmp/start-seam-final-registry-build.log`.
- **registry**: exit 0.
  Log: `/tmp/start-seam-final-registry.log`.
- **app-types**: exit 0.
  Log: `/tmp/start-seam-final-app-types.log`.
- **census**: exit 0.
  Log: `/tmp/start-seam-final-census.log`.
- **tsdoc**: exit 0.
  Log: `/tmp/start-seam-final-tsdoc.log`.
- **prose**: exit 0.
  Log: `/tmp/start-seam-final-prose.log`.
- **validate**: exit 0.
  Log: `/tmp/start-seam-final-validate.log`.
- **diff**: exit 0.
  Log: `/tmp/start-seam-final-diff.log`.

The strict census covers all authored app source and tests.
It keeps the prior exceptions: generated auth schema comments and the two proof presets.
The generated route tree is excluded too.
No changed TypeScript needs an exception.
TSDoc parsing reports zero errors.

## Jev

Preflight returns 0.
Log: `/tmp/start-seam-jev-preflight.log`.
The changed test file returns 0, with no flags.
Log: `/tmp/start-seam-jev-tests.log`.
Two README promise gaps were filled.
The final promise check returns 0, with zero gaps and one unsure note.
Log: `/tmp/start-seam-jev-promises-final.log`.

All 18 source findings are labeled false with a reason.
They concern existing driver leases, fixed wire constants, root ownership,
and resource state used to hold pending work.
The exact judge states and reasons are in
[SEAM-JEV-LABELS.jsonl](SEAM-JEV-LABELS.jsonl).
Printed label lines: `/tmp/start-seam-jev-labels.log`.

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
  The old sync-schema path re-exports the moved fixed tables for existing callers.
- Moving schemas changes ownership, not SQL.
  No database migration is needed.
  Stored notification bodies are unknown in fixed tables and checked by the app mail input.
- The span-reader tag is fixed setup.
  Visible telemetry rows stay in app data because the app displays them.
- The real CLI behavior overrides the brief's `registry:file` rewrite guess.
  Use `registry:lib` only for the eight fixed files that need import rewriting.
  Use `@lib/...` targets to place the install-once seams.
- The fixture proves types only.
  The registry consumer borrows installed dependencies and built Core/React.
  Package installation and external production services are outside these checks.
- Keep the prior generated-source and explicit proof-preset census exceptions.
  No new source exception was added.
- Keep labels in this track because the ticket bars changes to shared tools.
  The lead merges and calibrates them when landing.
- Bump setup contract to 3 because older installs now need the seams.
  Source item version is `0.4.0`.
  Nothing was pushed or published.

## Core feedback

No new Core friction was found.
No Core workaround or new API is needed for these seams.
The fixed graph still lists each resource in its dependencies.

## Next

The lead reviews the saved diff and the labels.
The lead lands the branch and publishes the rebuilt registry.
The board card was left for the lead; this writer did not mark it Done.
