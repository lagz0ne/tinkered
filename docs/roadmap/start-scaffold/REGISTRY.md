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
Userland owns records, database resources, tables, input readers, actions, cells, and views.
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
The current setup contract is version 2; the source item version is `0.3.0`.
SSE needs the database resource's native `listen` method and the new notify migration.
The starter also installs the SSE and telemetry route entries and local Victoria Compose file.
For this fresh scaffold, install the new starter; no old app migration is provided.

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

The actual registry contains three items and 81 files.
The official CLI builds their payloads from the selected source files.
Every built payload and copied file matches the source bytes.
The CLI resolves both namespaced dependencies into a fresh consumer folder.
An exact-file dry run shows the setup change and changes no consumer file.
Overwriting `runtime` restores setup and keeps an edited todo feature intact.
The installed consumer builds and passes its TypeScript check.
All three HTTPS item addresses return 200 and match the built payloads.

Run the proof again with:

```bash
vp run @tinker-start-scaffold#registry:build
vp run @tinker-start-scaffold#test:registry
```

Proof output: `/tmp/tinkered-start-registry-proof.json`.
The test runs a local HTTP server only for the real CLI copy check.
That server and its temporary consumer close after the check.
The registry itself is static JSON under `public/r/`.
The Node host serves it at `/r/` with JSON headers and no stale release cache.

## Other copied integrations

Only Core and React remain Tinker libraries.
The [source catalog](../../../registry/README.md) keeps 13 integration items.
Each app owns its selected `src/tinker/<item>/` files.
Items declare a fixed graph and the native dependencies they use.
The Start scaffold does not import that catalog or another integration package.
Its setup already lives in copied `src/scaffold/` files.
