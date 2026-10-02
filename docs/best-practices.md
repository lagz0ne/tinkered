# Authoring packages and apps

Declare the graph once.
A graph is the set of named units and their dependencies.
Reuse its declarations across roots and sessions.
Only Core and React are Tinker libraries.
Apps own their chosen integration source.

## Start with four forms

- **Tag** — fixed settings or facts injected by the entry.
  Put URLs, keys, paths, and mode choices here.
- **Data** — changing records, drafts, and visible progress.
  Write through its bound controller.
  Use a `kind` union when states carry different values.
- **Resource** — a reusable value with setup and cleanup.
  Declare its dependencies and release owned work with `ctx.defer`.
  Load native libraries inside its factory.
- **Operation** — an action with input and a result.
  Reads, writes, sends, retries, and sync actions use this form.
  Declare the input reader and let Core infer input and context types.

These four are the default for new app work.
Do not build a service factory or helper around a feature graph.
Its entry points are static units.
An action runs through an operation so Core can observe and stop it.
A resource may retain a native client and private work state.
Do not hide a feature action behind an unobserved resource method.
Saved records and visible progress belong in data.

The Start scaffold shows the filled-in form:

- [Database resource](../apps/start-scaffold/src/backend/database.ts).
- [Current-user resource](../apps/start-scaffold/src/backend/auth.ts).
- [Mail settings, client, and send action](../apps/start-scaffold/src/backend/mail.ts).
- [Todo actions](../apps/start-scaffold/src/backend/todos.ts).
- [Browser records and settings](../apps/start-scaffold/src/frontend/state.ts).
- [Todo view and its action state](../apps/start-scaffold/src/frontend/Todos.tsx).

## Challenge every other form

Before adding another form, explain why none of the four can own the work.
Put the reason in TSDoc beside the declaration.
Shorter code or a familiar class is not a reason.
Never pass a scope, session, or context bag to a helper.

Some code meets an outside contract:

- Framework entries and adapters connect native lifetime and callbacks.
- React components render data and invoke operations through hooks.
- Input readers validate raw values at the operation or network door.
- Error declarations, database schemas, and wire encoders describe values.

Value helpers have no app effects or mutable app state.
Review every other form against the four choices before keeping it.
Do not add a helper that runs or wires the graph.

## Keep lifetime with its owner

The precedent is request middleware and a database transaction.
Middleware opens a request session and keeps it until the response body ends.
An action owns its transaction until commit or rollback.
A root owns the resources shared by its sessions.
Factories open clients lazily; `ctx.defer` closes what they own.
Tables and feature actions stay in userland.

Resource targets choose sharing:

- `scope`: one value for the root.
- `namespace`: one value per namespace in that root.
- `session`: one value per session and namespace.

A namespace is a key with fixed tags; it chooses settings and keeps state apart.
It does not start or stop an instance.
End its scope or session to discard live state.
Keep watches, readers, queues, and pending work with that owner.
A reusable declaration must not retain them after close.

## Keep framework hooks in fixed setup

An extension connects work that must follow Core's lifetime or native hooks.
It is fixed setup, not another feature authoring form.
Its hooks live inside `hooks` and receive one bound event.
`next()` continues the chain; the event gives access to the current owner.
Resolve hooks wrap direct root reads only, not dependency or session reads.
Use a setup resource when those paths need readiness.

The [Start bridge](../apps/start-scaffold/src/scaffold/start.ts)
binds middleware to its scope and fails fast when unbound.
Start dedupes the shared middleware object.
The app uses native context at that bridge rather than a hidden current scope.
Feature modules receive declared dependencies, never the scope handle.

## Give observation its own graph

Observer callbacks receive spans and logs, not the scope that made them.
A separate telemetry root owns export work.
The app borrows its observer configuration.
Close the app first, then close telemetry to send the final records.
Leave observation off in telemetry to avoid tracing its own exports.

The [copied telemetry graph](../apps/start-scaffold/src/scaffold/telemetry/index.ts)
uses tags for settings, data for history and health, a queue resource,
and operations for ingest and export.
Its fixed hook binds Core observation.
Pino supplies logs; Victoria stores traces and logs.

## Keep the entry small

The entry reads process or browser inputs and wires the graph.
It owns output and stop signals.
Use Core's root lifetime: pass the original signal and await `closed`.
Do not close a root again after its `ready` rejects.
Do not pass its handle through app helpers.
An executable entry runs only inside `if (import.meta.main)`.
Framework entries use the filenames and exports their framework requires.
Declare domain operations and resources outside request bodies.

## Handle results at the right place

Use `run()` when failure should reach the owner.
Use `settle()` when the caller handles a failed or cancelled result.
Catching a run rejection does not recover that failure for the owner.

A call signal gives that action a child session.
Session resources and data writes stay with that child.
Work that uses `ctx.signal` stops when that call is cancelled.
The call waits for cleanup before answering.
Finish streamed work before returning from a signal-owned action.
The native response bridge owns work that must outlive the route return.

Saved records change through committed sync events.
Apply the saved change before completing the local execution wait.
Keep dirty text separate from saved records.
A partial result keeps committed data usable when later work fails.
See the [current data flow](roadmap/start-scaffold/STATE-SYNC.md).

## Check the public promise

A test creates a small scope and runs the exported operation or resource.
Feature tests do not boot the whole Start stack.
Use real dependencies or public fakes; never patch globals or mock code.
Control time with Core's test clock rather than sleeping.
A regression must fail before its fix.

Run build before check and consumer tests.
Run prose after changing Markdown.
Record observed proof on the board.
The starter copies its [authoring rules](../apps/start-scaffold/AGENTS.md)
so future feature work follows the same recipe.
