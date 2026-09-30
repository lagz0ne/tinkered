# Authoring rules across packages and apps

Date: 2026-09-30.
Status: Doing; source review in progress.
Owner: lead (authoring session).
Writer model: Astra, xhigh; one package per writer.

## Goal

Check every current package against the settled authoring rules.
Fix the gaps that the code and public tests show.
Check the same rules in the apps.
Provide a working Harness example for GitHub and Cloudflare.

The user authorized this work on 2026-09-30.
The existing decisions remain the design.
Use resource ownership and middleware as the precedent.

## Rules checked

- Tags hold static settings and labels.
- Data holds mutable state.
- Resources own reusable values, setup, and cleanup.
- Operations are actions.
- Extensions control work through owner-bound events.
- Namespace keys select settings and separate instances.
- Scopes and sessions own lifetime.
- Declare each graph once and reuse it across instances.
- Keep live state off reusable definitions.
- Pure helpers may take and return values.
- The root wires the graph and owns process inputs and outputs.

## Work

- **t06 package coverage** — blocked by: none.
  Read each public graph and its owner and namespace tests.
  Record what fits and fix each proven gap.
  Verify: all 14 packages have source paths and a checked result.
- **t07 app coverage** — blocked by: none.
  Apply the same rules to app-owned state and work.
  Keep comparison demos and build-time page tools in their own role.
  Verify: all three apps have a checked result; affected app tests pass.
- **t08 service example** — blocked by: the Harness and HTTP review.
  One agent calls GitHub and Cloudflare through declared tools.
  Service namespaces select separate HTTP settings.
  Verify: both tools run through Harness with no token mix-up;
  include exact commands and a test that needs no live account.
- **t09 Harness turns** — blocked by: none.
  Keep the SDK server, but bind its tools to the current turn.
  Verify: a tool in each of two turns belongs to that turn's span.
- **t10 Sync startup** — blocked by: none.
  Close an opened wire when setup fails.
  Handle a transport that was already closed before setup.
  Verify: both public regressions fail first, then pass.
- **t11 Stack namespaces** — blocked by: none.
  Keep post-commit publication with the root and the request namespace.
  Keep live refresh in the namespace that received the message.
  Verify: one root can publish and refresh two namespace instances.
- **t12 React owners** — blocked by: none.
  Recover a handled run failure through Core's `settle` result.
  Drop old-owner UI results after the provider changes.
  Show a synchronous resource failure with `suspense: false`.
  Verify: public hook tests fail first and pass after each fix.
- **t13 Blueprint model** — blocked by: none.
  Describe namespace resources and extension writers.
  Read direct named controller and resolve calls from object hooks.
  Verify: real source matches the new nodes; wrong targets still fail.
- **t14 controller waits** — blocked by: none.
  Check Tinkerer's steering while a stream or HTTP response waits.
  Fix only the public steering promise proved broken by a test.
- **t15 request lifetime** — blocked by: other work reviewed first.
  Check Hono's already-aborted requests and synchronous stream failures.
  Check Process's existing early-abort card against the root lifetime rule.
- **t16 trace wiring** — blocked by: none.
  Give each root its own observer and queue.
  Keep the reusable graph free of live queues.
- **t17 call cancellation** — blocked by: none.
  The user picked `Scope.Invocation.signal` on 2026-09-30.
  A signal gives one call a child owner and stops only that work.
  Verify: HTTP waits, retry waits, cleanup, namespaces, and recovery;
  all consumers pass and Core stays within 16,384 bytes gzip.

## Impact before code

The user approved one Core API change: per-call cancellation in t17.
The 16 KiB Core cap stays in force.
Any public symbol or lifetime change gets its caller list here before code.
Existing constructor forms remain valid unless the user settles a change.

### t09: unchanged Harness API; turn ownership changes

Callers: tracker `src/server/draft.ts` and draft tests;
`examples/harness/{basic,approvals,codex,real,tools}.ts`.
The SDK server remains reusable.
Its tool controllers must stop retaining a completed turn.

### t10: unchanged Sync API; failed setup now finishes cleanup

Callers: tracker client connection and server routes;
`examples/sync/{basic,hono}.ts`; Stack integration tests.
A closed transport rejects readiness with `SyncNotReady`.
A conflicting setup closes its borrowed wire before readiness rejects.

The family directory shares namespace identities across roots.
That matches ADR 0048; it does not add graph nodes or edges.
Keep the API and document the shared directory.
Verify that each root keeps its own values after the other root closes.
No public signature or lifetime change is needed for that check.

### t11: unchanged Stack API; owner namespace reaches publication

Callers: tracker `src/server/{publish,main}.ts`;
Stack publish, live-update, and span-tree tests.
The publisher still reads root state after commit.
The namespace must come from the action or incoming message.

### t12: unchanged React API; results follow the current owner

Callers: tracker client main, App, and DraftView;
playground main, App, Editor, SourcePicker, and bench runners;
React examples and writer-trial fixtures.
A handled run failure stays in the view and does not fail the root.
A result from the old provider does not update the new view.
A non-suspense resource reports its error in its query state.

### t13: Blueprint kinds and targets expand

Public symbols: `Blueprint.Node`, `Unit`, `Template`, `NodeState`.
Callers: package CLI, source checks, tests, corpus, and eval files.
No package outside Blueprint imports these types today.
Keep all old nodes and YAML valid.
Add `extension` as a kind and `namespace` as a resource target.
Direct named access in an object hook supplies its static dependencies.
Dynamic access remains a limit of source checks, stated in the README.
Run SCIP refs before and after the public type change.

### t15: unchanged Hono API; every request owns its cleanup

Callers: tracker server routes, draft streams, and sync streams;
Hono and Sync examples; Stack request tests.
An already-aborted request must not start live request work.
A synchronous stream body failure must release its session.
The other team's `stack/t17` changes the same middleware.
Work in an isolated tree and preserve its commit-before-response work.
Recheck both sets of promises after merging main.

### t14: unchanged Tinkerer API; steering wakes a waiting step

Callers: `examples/tinkerer/real.ts`;
Tinkerer command, files, gate, inbox, log, namespace, persistence,
span-tree, tools, and turn tests.
Persistence watches messages through `src/persist.ts`.
No production package outside Tinkerer imports its turn today.
ADR 0053 promises that steering interrupts an in-flight step.
The wakeup and stream cleanup belong to that turn's owner.
Keep messages, tool results, and namespace state in their existing cells.

### t15 Process: finish the existing early-abort card

Callers: Process `run` and `main`; Process tests;
`examples/process-cli/basic.ts` and package CLI entry files.
The public `execute` signature and forced-stop exit code stay unchanged.
Inline root creation instead of returning a scope from `rootFor`.
Use a completion signal and `closed` for the root's graceful end.
An external command abort still force-cancels its active work.
Check an abort fired during start immediately after attaching its listener.
Do not call close again after failed readiness.
Verify: startup abort returns 130 without running the command;
failed setup finishes its close hooks once.
This completes `process/early-abort` already on the board.

### t16: trace extension stays at the center

User steering: the observer needs its own graph, possibly its own scope.
Add `traceSink()` as a reusable extension resolved to `Observe.Config`.
The extension exposes its fixed settings tag.
Its telemetry scope owns the queue, export actions, and cleanup.
The observed app borrows its callback config.
Close the app first, then close telemetry to flush the last app spans.
Keep observation off inside telemetry by default, to avoid exporting itself.
Keep `traceSink(wiring)` valid as the legacy root-wiring form.

```ts
const tracing = traceSink();
const telemetryStop = new AbortController();
const telemetry = createScope({
  signal: telemetryStop.signal,
  tags: tracing.config({
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      OTEL_SERVICE_NAME: "service-tools",
    },
    write: (line) => process.stdout.write(`${line}\n`),
  }),
  extensions: [tracing],
});
await telemetry.ready;
const appStop = new AbortController();
const app = createScope({
  signal: appStop.signal,
  observe: telemetry.resolve(tracing),
});
await app.closed;
telemetryStop.abort();
await telemetry.closed;
```

Callers: Stack trace and trace-failure tests and the Stack README.
There are no production callers of `traceSink` today.
Public symbols: `traceSink`, `TraceSink.Extension`, its config tag.
List their SCIP callers before code and after the change.
The extension may be reused; each telemetry root owns its own graph values.
Prove two telemetry roots send to their own collectors.
Prove closing A preserves B and the final app-close spans reach telemetry.
Prove bad setup cleans up and cannot stop another root's queue.
Public callbacks remain the existing `Observe.Config` shape.
No Core observer API change or automatic private root is needed.

### t17: Core invocation and call argument types gain a signal

Public symbols: `Scope.Invocation`, `ProvideInput`, `CallArgs`,
`TaggedArgs`, inline call arguments, and operation controller overloads.
Callers: every package and app that runs or settles an action;
Core extension events and subflows; all examples.
Index all 14 packages and check SCIP references before and after code.
The explicit consumer is Tinkerer's in-flight step and HTTP retries.
Logger, observer, and devtools actions may use the same boundary.

Reuse the tagged-call child lifetime as the precedent.
The namespace key stays fixed; the new child owns work and cleanup.
Only calls with a signal need this extra owner.
An already-aborted signal starts no body or backend.
Cancel stops the call's signal, waits for cleanup, and detaches listeners.
`settle` reports cancellation without failing the caller's owner.
Do not add an HTTP-only stop setting or a private hidden root.
Do not change no-signal invocation results or resource targets.
The existing 16 KiB Core budget remains a hard gate.
Use the existing ticket checks and queue for any measured cost claim.

### Writer handoff

Each writer reads `docs/roadmap/contributor-brief.md` and the coding skill.
Each writer edits one package in its own worktree.
Lead owns the board, shared proof, full release checks, and mutation queue.
Writers run build, check, package and consumer tests, and advisory checks.
Writers commit source and their package promise lines by explicit path.
Do not edit shared Jev labels while another writer is running.
Report any flags so the lead can label and calibrate them together.
No timing change or claim is part of these tickets.

## Review results

- **Core** — `src/index.ts` and `tests/extension-context.test.ts`.
  The event carries owner and namespace access.
  Existing tests cover tags, state, waits, cleanup, and reuse.
  No new Core API is needed.
- **HTTP** — `src/client.ts` and `tests/endpoints.test.ts`.
  Shared declarations fit: config and backend tags, send and attempt actions.
  The README's two-session example hides namespace-based service wiring.
  The Harness example will check that wiring through the public send action.
- **Utils** — `src/index.ts`.
  One pure string helper; no live state or owner to fix.
- **MCP** — `src/index.ts`.
  Static tool rows name operations.
  Each root owns its server; each call owns its session.
  No source fix found.
- **Drizzle** — `src/index.ts`, namespace and transaction tests.
  The reusable DB belongs to a root or namespace.
  Each transaction belongs to a session and cleans up on close.
  No source fix found.
- **NATS** — `src/index.ts` and namespace and reuse tests.
  Namespace config chooses a root-owned connection.
  Incoming calls keep that connection's namespace.
  No further source fix found.
- **Harness** — `src/claude.ts`, tool and span-tree tests.
  Fixed first-turn controllers retained by the reused SDK server.
  Writer checkpoint: `e1aeef2b`; lead review passed.
- **Sync** — `src/index.ts` and startup tests.
  Fixed preclosed-wire readiness and failed-setup cleanup.
  Writer checkpoint: `5bdaa90f`; lead review passed.
  Family shares a namespace-key directory by its public contract.
  It creates one cell; new keys do not add graph nodes or edges.
  Each root owns its values, listeners, and transports.
- **Stack** — `src/publish.ts` and namespace tests.
  Fixed default-namespace controllers in post-commit and live refresh.
  Writer checkpoint: `5d37b496`; lead review passed.
  Trace queue wiring remains under review.
- **React** — `src/index.ts` and hook owner tests.
  Three proven owner/error gaps are being fixed in t12.
- **Blueprint** — `src/blueprint.ts`, `src/extract.ts`, and corpus.
  Namespace targets and extension writers are missing.
  t13 adds their accepted authoring shape.
- **Tinkerer** — `src/index.ts` and inbox tests.
  Tags, cells, tools, and persistence fit.
  Steering during a stalled read needs a public regression check.
- **Hono** — `src/index.ts` and stream tests.
  A pre-aborted request and synchronous body failure miss cleanup.
  t15 proves and fixes those paths.
- **Process** — `src/index.ts` and the existing early-abort card.
  Process inputs are root tags; commands are actions.
  The root helper and missed startup abort need t15's lifetime check.

## App coverage

- **Issue tracker** — `src/shared/issues.ts`, `src/server/operations.ts`,
  `src/client/actions.ts`, `src/client/services.ts`, and `src/client/drafter.ts`.
  Shared cells hold state; operations handle actions.
  Resources own DBs, watches, readers, and request state.
  Server and client entry files wire the root.
  Its root stop helper is being replaced by the other team's `stack/t18`.
  Preserve that change and recheck all 79 app tests after integration.
- **Playground** — `src/state.ts`, `src/actions.ts`, and `src/services.ts`.
  State is in cells; setup, watches, and cleanup belong to resources.
  Editor handles and React view state belong to their mounted views.
  Comparison runners keep the APIs of the libraries they compare.
  Root entry and compiler helpers do not need a forced extension layer.
- **Website** — `src/main.ts` and `src/counter.ts`.
  This is the Vite starter, with no Tinker module or shared graph.
  Its counter belongs to one DOM button.
  No framework migration is needed for that local view state.

## Proof

Pending: build, code check, tests, fault checks for changed packages, and prose.
