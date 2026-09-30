# Authoring packages and apps

Declare the graph once.
A graph is the set of named units and their dependencies.
Reuse it across roots, sessions, and namespace instances.

A graph builder such as `harness()` or `drizzleStore()` is valid.
Call it once for the authored configuration.
It must leave live state with the instance that owns it.

## Pick the unit by what it does

- **Tag** — fixed settings and labels.
  Bind URLs, tokens, paths, and mode choices here.
- **Data** — mutable state that callers read or watch.
  Operations and extensions write it through bound controllers.
- **Resource** — a reusable value with setup and cleanup.
  Declare dependencies and release owned work with `defer`.
- **Operation** — an action with input and a result.
  Validate outside input once, then use typed facts.
- **Extension** — the engine that drives a module's goal.
  Wrap work, act on state, and use the current owner and namespace.
- **Namespace** — a key with fixed tags.
  It selects settings and keeps instance state apart.

A pure helper may take and return values.
View state and editor handles may belong to their mounted view.
Do not add an extension to a pure helper or a thin view adapter.

## Keep lifetime with its owner

The precedent is request middleware and a database transaction.
A request opens a session; its end commits or rolls back its work.
A root owns the resources shared by its sessions.

Resource targets choose sharing:

- `scope`: one value for the root.
- `namespace`: one value per namespace in that root.
- `session`: one value per session and namespace.

A namespace does not start or stop an instance.
End its scope or session to discard live state.
Keep watches, readers, queues, and tool controllers with that owner.
A reusable definition must not retain them after close.

## Give extensions bound access

Object hooks receive one lazy event.
Its `kind` selects the payload; `next()` continues the chain.
Access follows the actual owner and namespace of the work.

```ts
const managed = tag({
  label: "managed",
  default: false,
});
const calls = data({ label: "calls", initial: 0 });
const engine = extension({
  label: "service.engine",
  hooks: {
    run(event) {
      if (event.resolve(managed)) {
        event.controller(calls).update((n) => n + 1);
      }
      return event.next();
    },
  },
});
const github = namespace({ tags: managed(true) });
```

A run hook can wait before or after `next()` and own cleanup.
Use `event.resolve(resource)` for setup the engine needs.
Resolve hooks wrap direct root reads only.
They do not cover dependency or session reads.
Use an explicit setup resource when those paths need readiness.

Declare all extension hooks inside `hooks`.
Each hook takes one bound event.

## Observation has its own graph

Observer callbacks accept spans and logs.
They do not receive the owner that created that work.
Give a queued observer its own telemetry scope.

That scope owns the trace extension, queue resource, and export actions.
The app borrows the observer config resolved by the extension.
Close the app first, then close telemetry to send the final spans.
Leave observation off in telemetry unless self-observation is intended.

```ts
const tracing = traceSink();
const toolStop = new AbortController();
const telemetry = createScope({
  signal: toolStop.signal,
  extensions: [tracing],
  tags: tracing.config({
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      OTEL_SERVICE_NAME: "service-tools",
    },
    write: (line) => process.stdout.write(`${line}\n`),
  }),
});
await telemetry.ready;
const appStop = new AbortController();
const app = createScope({
  signal: appStop.signal,
  observe: telemetry.resolve(tracing),
});
appStop.abort();
await app.closed;
toolStop.abort();
await telemetry.closed;
```

Import `traceSink` from `@tinker/stack`.
Logger and devtools graphs may use the same ownership rule.
They keep their own extension, resources, state, and actions.

## One agent, two services

Keep the conversation in one session.
Select the service namespace on each HTTP call.
Both services use the same `send` declaration.

```ts
const github = namespace({
  tags: httpConfig({
    baseUrl: "https://api.github.com",
    headers: { authorization: "Bearer github-token" },
  }),
});
const cloudflare = namespace({
  tags: httpConfig({
    baseUrl: "https://api.cloudflare.com/client/v4",
    headers: { authorization: "Bearer cloudflare-token" },
  }),
});
await send.run({
  ns: github,
  input: HttpRequest.get("/repos/octocat/Hello-World"),
});
await send.run({
  ns: cloudflare,
  input: HttpRequest.get("/zones"),
});
```

These are separate settings, with one HTTP graph.
They may share a root-owned workspace resource.
See the complete [Harness example](../examples/harness/SERVICES.md).

## Keep the root small

The entry file reads process or browser inputs and wires the graph.
It owns output and stop signals.
Use Core's root lifetime: pass a signal and await `closed`.
Do not close a root again after its `ready` rejects.
Do not pass its handle through app helpers.

Declare domain operations and resources outside request bodies.
Helpers over values may parse, format, or transform those values.
A driver receives the root through its extension event.
App code calls declared actions through dependencies.

## Handle results at the right place

Use `run()` when failure should reach the owner.
Use `settle()` when the caller handles a failed or cancelled result.
Catching a run rejection does not recover that failure for the owner.

Give one action a call signal when it must stop on its own.
The call gets a child session, as a tagged call does.
Session resources and data writes stay with that child.
Namespaces still select the settings for that work.

```ts
const stepStop = new AbortController();
const pending = step.settle({
  input: "check the services",
  signal: stepStop.signal,
});
stepStop.abort();
const result = await pending;
if (result.status === "failed") throw result.error;
```

Abort stops child work that uses `ctx.signal`, including HTTP retries.
The call waits for cleanup before answering.
A handled cancelled result keeps the parent conversation alive.
Keep conversation cells in the parent and consume the step's result there.
Finish streamed work before returning from a signal-owned action.

After a commit, publish from committed storage through a root controller.
Keep the request namespace on that controller.
Do not publish from the session's draft cells.

## Check the public promise

A test creates its own root, runs the public action, and reads the result.
A regression must fail before its fix.
Use real dependencies or public fakes; do not patch globals or mock code.

An app test presets the app's endpoint operation.
An HTTP integration test may bind a recording backend.
The service example checks the real HTTP graph through that backend.
Use a controlled clock for time; do not sleep to wait for state.

Run build before check and consumer tests.
Run prose after changing Markdown.
Record the observed proof on the board.

The [package and app review](roadmap/authoring-model/PACKAGES.md)
tracks the current source paths, fixes, and checks.
