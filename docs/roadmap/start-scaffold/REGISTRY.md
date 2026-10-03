# Copy chosen graphs with a shadcn registry

Date: 2026-10-02.
Status: full source copy, setup update, consumer build, and types pass.

## What the registry does

A registry distributes source files rather than hiding them in another runtime.
shadcn supports components, routes, config, and other project files.
Each file can have an exact target path.
The [registry guide](https://ui.shadcn.com/docs/registry)
and [item format](https://ui.shadcn.com/docs/registry/registry-item-json)
describe these contracts.

Use the registry to choose a concrete graph at install time.
The Postgres item contains a Postgres resource and Drizzle setup.
There is no SQLite item, database picker, or driver framework.
SMTP and Better Auth are concrete graphs too.
PGlite runs the Postgres proof; recorded mail belongs to proof wiring.
Those proof choices stay outside the production resource factories.

## Fixed setup and userland

The fixed setup lives under `src/scaffold/`.
It owns host lifetime, the native Start bridge, sync transport, and execution waits.
Userland owns records, database resources, feature tables, input readers, actions, cells, and views.
Fixed setup owns sync tables and envelope schemas.
Small entry files connect those parts at the names Start expects.

An update item contains only the fixed setup files.
It has no registry dependency on userland items.
Install-only items contain entries, chosen services, and sample features.
A starter item can compose them for first setup.
Updating fixed setup must not copy sample features over the user's own files.

Fixed setup still has a public contract with userland exports.
Changes to that contract need release notes and a stated migration.
A folder split does not make a breaking update safe by itself.
Keep that contract small; do not invent dynamic slots for unused integrations.

## Build and install

The checked CLI version is `shadcn@4.21.0`.
Build static JSON from the actual app source using the official CLI.
Serve it through Start's existing public directory.
There is no registry server or registry dependency in the app runtime.
The [build guide](https://ui.shadcn.com/docs/registry/getting-started)
describes static output under `public/r`.

This proof uses the workspace's Core and React packages.
It does not claim a published npm release for those packages.
Registry installation starts from a Start project with those packages available.

Use a namespace for related items, so dependencies resolve to the same registry.
Use versioned item addresses when publishing a release.
Metadata records the setup version and which files it owns.
No automatic merge of edited source is assumed.

Review an update using the CLI's dry run and diff before copying it.
The [CLI guide](https://ui.shadcn.com/docs/cli)
documents `--dry-run`, `--diff`, and explicit overwrite.
Overwrite only the fixed setup item when updating setup.

## Proof needed

- The built payloads contain the actual selected source files.
- The real shadcn CLI installs them into a fresh consumer folder.
- A dry run leaves that consumer's files unchanged.
- A fixed setup update leaves an edited feature file unchanged.
- The runtime still builds and both page kinds pass their operation seams.

The three items are served by the [app preview](https://p-50f124fdfa9c.preview.tini.works).
The address is a development preview, not a versioned release.

Register the namespace in a Start project with the package prerequisites:

```bash
START_HOST=p-50f124fdfa9c.preview.tini.works
START_ITEMS="https://$START_HOST/r/{name}.json"
vp dlx -- shadcn@4.21.0 registry add \
  "@tinker-start=$START_ITEMS"
```

Copy the first setup into that project:

```bash
vp dlx -- shadcn@4.21.0 add \
  @tinker-start/starter
```

Review a later setup update:

```bash
vp dlx -- shadcn@4.21.0 add \
  @tinker-start/runtime --dry-run --diff
```

Copy it after reviewing the diff:

```bash
vp dlx -- shadcn@4.21.0 add \
  @tinker-start/runtime --overwrite
```

Do not overwrite `postgres-auth-mail-example` to update setup.
That item contains the chosen services and your feature files.
The `runtime` item has no registry dependencies and owns only `src/scaffold/`.
Native entry and config files belong to the install-only `starter` item.
The current setup contract is version 4; the source item version is `0.6.0`.
The shipped README names the entry and lib changes required before a runtime update.
SSE needs the database resource's native `listen` method and the new notify migration.
The starter also installs the SSE and telemetry route entries and local Victoria Compose file.
For a fresh app, install the new starter.
For an existing app, follow the shipped README.

The consumer proof borrows the app's installed dependencies.
It copies `package.json`, `components.json`, and `tsconfig.json` as prerequisites.
Core and React must already be available and built.
It does not claim npm dependency installation or an external Core release.

## Small copy and update proof

The real `shadcn@4.21.0` CLI built a registry item from the current Start entry.
It installed that file into a fresh folder at its exact target path.
The built payload and installed file both matched the source bytes.
A changed setup version appeared in the CLI diff.
Dry run left every consumer file unchanged.
Explicit setup overwrite copied the new setup while keeping an edited feature intact.

Proof output: `/tmp/tinkered-registry-lab/proof.json`.
This proves the copy/update format, not yet the full app's registry items.

## Full app copy and update proof

The actual registry contains three items and 90 files.
The official CLI builds their payloads from the selected source files.
Every built payload matches the source bytes.
Copied files match after the consumer's lib alias is rewritten.
The CLI resolves both namespaced dependencies into a fresh consumer folder.
An exact-file dry run shows the setup change and changes no consumer file.
Overwriting `runtime` restores setup and keeps an edited todo feature intact.
Both edited seam files also stay unchanged.
The installed consumer builds and passes its TypeScript check.
The prior release passed all three HTTPS item checks.
The seam change is local until the lead publishes it.

Run the proof again with:

```bash
vp run @tinker-start-scaffold#registry:build
vp run @tinker-start-scaffold#test:registry
```

Proof output: `/tmp/start-seam-registry-proof.json`.
The test runs a local HTTP server only for the real CLI copy check.
That server and its temporary consumer close after the check.
The registry itself is static JSON under `public/r/`.
The Node host serves it at `/r/` with JSON headers and no stale release cache.

## Plain authoring

Only Core and React remain Tinker libraries.
The Start registry keeps the three items above.
Feature code uses data, tags, resources, and operations by default.
The fixed native bridge owns middleware and scope lifetime.
The starter copies `AGENTS.md` to the app root.
Its rules require a TSDoc reason for work outside the four forms.

## Setup contract 3: two value seams

`src/scaffold/` imports user values only through these names:

- `@/lib/tinker`: browser values and feature input readers.
- `@/lib/tinker.server`: server graph values and proof presets.

`@/routeTree.gen` is the generated Router tree.
User code fills the scaffold's open `Register` in the browser seam.
It supplies change, result, public snapshot, and private snapshot types.
The fixed database handle names no feature schema.
The sync tables retain unknown bodies.
Feature readers check those bodies at the app's network and storage doors.
Feature transport maps its own errors to messages.

The two seam files belong to the install-once example item.
Their targets are `@lib/tinker.ts` and `@lib/tinker.server.ts`.
shadcn puts them under the consumer's configured lib folder.
`runtime` owns neither seam file.
Before updating an older install:

- Add both seams and fill `Register` once.
- Import `readReceipt` from your own transport file.
- Keep sync table definitions only in `src/scaffold/backend/sync.schema.ts`.
  Feature files import those fixed tables directly.
- Build feature readers on the setup envelopes.

Review the three files together: both seams and the runtime dry run.
There is no automatic change to an older app's graph.

The checked shadcn 4.21.0 skips import rewriting for `registry:file`.
A real install with a different lib alias proved that skip.
Eight fixed TypeScript files use `registry:lib` to get import rewriting.
Their explicit targets keep them under `src/scaffold/`.
Other fixed files keep `registry:file`.
A real install uses `@/app-lib` and puts the seams in `src/app-lib/`.
Seam imports are rewritten.
That consumer builds and passes types.
Both edited seams survive an explicit runtime overwrite.

The server seam imports the proof preset module with the other server values.
The entry selects those presets only in proof mode.
PGlite still loads inside its factory, when that preset runs.
