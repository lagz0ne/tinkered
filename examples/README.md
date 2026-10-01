# Stand-alone examples

Each folder is its own private project.
It owns its dependencies, config, checks, and run steps.
It imports libraries by their public names.
No example imports another example or a library's source.

## Run in this repo

Build the libraries first:

```bash
vp install --frozen-lockfile
vp run -r build
```

Then run one example from its own folder:

```bash
cd examples/core
vp run check
vp run test
vp run start
```

The React example starts with `vp run dev`.
Its `vp run build` command makes a browser build.
Each README lists the other commands and the output to expect.
The default runs use local data or public fakes.
Live AI and service commands need your own account settings.

## Write an entry

Declare graph units at module scope and export them through `index.ts`.
Put the executable body inside `if (import.meta.main)`.
Imports start no work and add no process listeners.
Do not export a helper that runs the whole example and returns its answer.
Tests create their own roots from the exported units.

The main entry owns its stop signal.
It handles SIGINT and SIGTERM, then removes its listeners on exit.
Its `finally` block stops the root and awaits `closed`.
Check the close result so a cleanup error fails a successful command.
Process command entries use `main(shell)` for the same ownership.
Browser entries use their component's lifetime.

## Run outside this repo

The libraries are not on npm yet.
Export one project with the built libraries beside it:

```bash
vp run example:export -- core /tmp/tinker-core
cd /tmp/tinker-core
vp install
vp run check
vp run test
vp run start
```

Choose a new folder outside the repo.
The export copies that example and packs its required libraries.
The copy uses local archives in `vendor/`.
It has no dependency on this repo, its catalog, or a sibling example.
It skips local installs, build output, and secret env files.
The original examples keep workspace links for correct build order.
This follows [pnpm's packing rules](https://pnpm.io/workspaces).

## Choose an example

- [Core](core/README.md): data, operations, resources, and a clock.
- [HTTP](http/README.md): requests, endpoints, and call tags.
- [Hono](hono/README.md): routes and a session per request.
- [Drizzle](drizzle/README.md): a local PGlite database.
- [Process](process/README.md): commands, streams, and stop signals.
- [Process CLI](process-cli/README.md): a command entry and lazy loads.
- [Harness](harness/README.md): conversations, tools, and approvals.
  [Two services](harness/SERVICES.md) uses separate HTTP settings.
- [MCP](mcp/README.md): tools over memory or stdio.
- [Sync](sync/README.md): data updates over memory or an event stream.
- [React](react/README.md): a counter, profile, and draft form.
- [Tinkerer](tinkerer/README.md): two agents with separate settings.

The full [issue tracker](../apps/issue-tracker/README.md) combines these ideas.

## Check every copy

```bash
vp run example:check
```

This exports each example into a fresh folder outside the repo.
It installs, checks, tests, and runs that copy.
It also builds and serves the React browser entry.
The log gives the copy's path so you can inspect it.

Authoring rules: [best-practices.md](../docs/best-practices.md).
Package layout: [ADR 0092](../docs/decisions/0092-each-example-is-a-stand-alone-package.md).
