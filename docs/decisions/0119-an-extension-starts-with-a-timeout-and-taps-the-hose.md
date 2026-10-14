# 0119 An extension starts with a timeout and taps the hose

Date: 2026-10-14. Status: proposed.
Builds on: 0050, 0059, 0064, 0091, 0093, 0104.

- User, 2026-10-14: "This is not an fi everything
  tool and doesn't need to be. The user runs the
  code, they just need to know what are those."
- User: "simplest form would be an async init
  script, with timeout to protect the scope, in
  the middleware style for closure."
- User: "The most important part is performance."
- User: "Default like fastify should be good
  already."

## Context

Tools such as an OTEL reporter or devtools want
their own space.
They should not slow the main flow.
They should not leak into tests.
Their startup work should not touch app state.

Today a tool gets a separate root (ADR 0091).
The entry wires it by hand: tool root first,
app root second, tool closes last.
The entry is now user code, so each user would
write that order once per tool.

A probe on main (fef10e4) put one tool in its
own namespace on the app root:

- data cells: isolated (tool 2, app 0);
- `namespace`-target resources: isolated;
- close order: the tool's queue, built first,
  closed last (LIFO);
- `scope`-target resources: shared with the app;
- the app observer traced the tool's builds;
- the `run` hook still ran on every call.

So the namespace gives state and close order.
It does not give quiet traces or speed.

## Precedent

- **Fastify plugins.** A plugin is an async
  function. `pluginTimeout` (default 10 s) stops
  a plugin that never finishes. `onClose` cleans
  up.
- **Node `diagnostics_channel`.** A publisher
  checks `hasSubscribers`; with none it does no
  work. Many subscribers may listen.
- **OTEL.** `addSpanProcessor` adds a sink; every
  sink gets every span. `suppressTracing` stops an
  exporter from tracing its own sends.

Where we are simpler: the `start` hook already is
the async init, and `event.defer` already is the
close.

## Decision

### 1. Init is the `start` hook, with a timeout

No new hook.
Setup runs before `await next()`.
Cleanup goes to `event.defer`; the root runs it
in LIFO order, so a tool built first closes last.

```ts
const otel = extension({
  label: "otel",
  hooks: {
    async start(e) {
      const sink = e.resolve(observer, { ns: otelNs });
      e.tap(sink);
      await e.next();
    },
  },
});
```

- `createScope({ startTimeout })` sets the limit.
- Default: 10 000 ms, as Fastify.
- The timer reads the scope's clock, so a test
  clock can fire it (ADR 0113).
- On timeout, `ready` rejects with a managed
  error that names the extension's label.
  The scope then closes.

### 2. A tool keeps its state in its own namespace

The tool mints its own namespace.
Core adds no field for it.

- Data and `namespace`-target resources stay
  out of the app's default bucket.
- A `scope`-target resource is shared on purpose.
  That is how a tool adds a lifetime resource to
  the app. The tool's docs must name it.

### 3. Observe and logs are one hose

Core owns one stream of spans and log lines.
A tap is an `Observe.Config`.

- `createScope({ observe })` is one tap.
- `event.tap(config)` in `start` adds one more.
- Every tap gets every record.
- Hose level: the lowest tap level.
  Each tap still filters to its own level.
- History: the largest tap history.
- A tap added in `start` misses records made
  before it.

### 4. Performance comes first

The hot path keeps one flag check (`obs.on`).

- No tap: the flag stays off. No span is made.
- One tap: the hose calls it directly.
- Two or more: only then does the hose loop.
- `namespace({ observe: false })`: work in that
  namespace makes no records. A tool uses it so
  its own sends are not traced.

## Consequences

- ADR 0091's hand wiring becomes optional.
  The entry may drop the tool root.
- Telemetry moves to one entry in `extensions`.
- Hooks still run inline. A hook that must be
  cheap copies the event and hands it off.
- `run`, `write`, `resolve`, `session` hooks do
  not change.
