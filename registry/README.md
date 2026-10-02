# Copyable Tinker source

Core and React are the two Tinker libraries.
The other source lives here for apps to copy and own.
No app depends on this private workspace.

## Files

- `src/<item>` holds the source to copy.
- `tests/<item>` keeps its behavior checks.
- `registry.json` names the files and fixed source graph.
- `public/r/<item>.json` is the built shadcn item.
- `catalog.json` keeps native versions and check settings.
- `configs/<item>.stryker.json` keeps each fault test lane.
- `docs/<item>.md` keeps the old behavior promises.

The source items are auth, drizzle, harness, hono, http,
jobs, mail, mcp, nats, process, stack, sync, and tinkerer.
Items keep the same public functions.
Each app receives one copy of each selected item.
Imports between items use sibling paths.
Core tags and nodes keep one identity per app.

## Ownership

An app owns `src/tinker/<item>` after copying it.
Its feature code stays in other folders.
Tags carry fixed settings.
Data holds mutable values.
Resources own reusable values and their cleanup.
Operations perform actions.
Entry files own scopes and stop signals.

Core and React must already be available to the app.
They are not released to npm yet.
Registry items add their native dependencies.
They do not add another Tinker library.

## Checks

From the repository root:

```bash
vp run -r build
vp check
vp run -r test
vp run source-registry#size
vp run source-registry#test:registry
```

Each source item runs in its own test process.
This keeps the old test isolation.
Build output exists only for source size and import checks.
It is not a library entry for apps.

The registry check uses the real shadcn CLI.
It serves the built items over local HTTP.
It installs tinkerer and its HTTP source in a fresh folder.
It checks the copied TypeScript outside this repo.
It proves that an update leaves feature files alone.
Core comes from a local built archive in this check.
Native dependencies install in that fresh folder.

## Copy from the preview

The development items are served by the Start app.
The link is temporary, not a versioned release.
From an app with shadcn settings and Core available:

```bash
SOURCE_HOST=p-50f124fdfa9c.preview.tini.works
SOURCE_ITEMS="https://$SOURCE_HOST/r/source/{name}.json"
vp dlx -- shadcn@4.21.0 registry add \
  "@tinker-source=$SOURCE_ITEMS"
vp dlx -- shadcn@4.21.0 add @tinker-source/http
```

The copied entry is `src/tinker/http/index.ts`.
Selected items add only their fixed source graph and native dependencies.
Review an update before copying it:

```bash
vp dlx -- shadcn@4.21.0 add \
  @tinker-source/http --dry-run --diff
vp dlx -- shadcn@4.21.0 add \
  @tinker-source/http --overwrite
```

App feature files stay outside the copied item.
The old issue tracker and its dependent examples were removed.
The Start scaffold remains the application sample.
