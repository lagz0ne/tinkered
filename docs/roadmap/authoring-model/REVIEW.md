# Authoring model review

Date: 2026-09-30.
Status: fixes reviewed and landed; all final checks passed.

The proposed context addresses a real access gap.
It does not by itself give live state the right owner.
All five cases have passing tests on main at `dfaad530`.
The final gates are recorded in [the progress log](PROGRESS.md).
The finding paths below describe the reviewed baseline, `2700a440`.

## Fixes checked

- Sync stores stop state in each root's resource.
  Six owner and failed-boot regressions failed before their fixes.
- Core owns the whole run hook and its resource holds.
  Namespace, close, input, and failure tests pass.
- Stack keeps the publisher controller on its root.
  A two-root POST regression failed before its fix.
- Persistence exposes file tags and a transcript setup resource.
  Direct writes, saved history, two keys, and close cleanup pass.
- NATS owns connections per root and namespace.
  Real-server tests cover publish routing and incoming sessions.

The first landing attempt failed the old 15 KiB cap.
The user then chose 16 KiB; all merged fault checks passed.
The first event cost probe led to a simpler run-event constructor.
The final probe found no difference between legacy and object hooks.
Before the merge, all five changed packages passed the fault-check floor.
After the merge, all 14 package fault scores meet the floor of 85.
All 48 merged release lanes now pass.
Core is 16,373 bytes gzip against the approved 16,384-byte cap.

## Findings

### 1. High: Sync can close another scope's connection

Source: `packages/sync/src/index.ts:203`, `:235`, and `:284`.

`closeSource` lives on the extension definition.
Each scope's start replaces it with a function for that scope.
Install the same definition in scopes A and B, then close A:
the close hook runs B's function.

A public-entry probe used `source` and `memoryPair`.
After closing A, it printed:

```text
closedA: false
closedB: true
```

The subscriber has the same ownership fault at `:318` and `:403`.
Its `closing` flag also survives a closed scope.
A second probe started and closed a subscription with no cells,
then installed that same definition in a new scope.
The new scope's `ready` rejected with `SyncNotReady`.

Needed: each root owns its stop function and closing state.
An owner-bound close context must reach that existing state before cleanup.
Test both simultaneous roots and reuse after close.

### 2. High: graceful close does not wait for a root run hook

Source: `packages/core/src/index.ts:2794`.

The promise returned by a run hook is tracked only when `caller` exists.
A run started through the root handle has no caller.
If its hook waits before `next()`, graceful close can finish first.

A public-entry probe paused a hook on a promise, closed the scope,
then let the hook continue.
It printed:

```text
hook
closed:success
run rejected: Disposed
```

The operation body did not run.
The bug is the successful graceful close while accepted work still waits.
This breaks the draft's setup-before-action case.

Needed: own the whole hook call, including waits before and after `next()`.
Test graceful and forced close while setup waits.
The draft already names this rule; this probe shows the missing behavior.

### 3. High, source finding: Stack can publish into another root

Source: `packages/stack/src/publish.ts:57`, `:62`, and `:87`.

`republish` lives on the extension definition and captures the last root
whose start assigned it.
Reuse one `publishAfterCommit(publish)` definition in roots A and B.
A successful POST session in A then runs the captured publish call in B.

That can leave A's published cells stale and update B's cells instead.
The source shows the same ownership fault as Sync.
The public-entry probe could not run: importing Stack failed because
`@hono/node-server` is missing in this checkout.

Needed: keep the publisher in a root-owned resource.
The session hook must deliberately call its own root's publisher after commit.
Merely using the session's new `ctx.run` would run at the wrong layer.
Test two roots with distinct published values and a POST only in A.

### 4. Medium: the persistence sketch drops writes before a turn

Source: `EXTENSION-SHAPE.md:145` and `packages/tinkerer/src/persist.ts:26`.

Current persistence watches messages when the session opens.
The proposed resource is first resolved when `coder.turn` runs.
Direct writes to the public messages cell before that turn have no watcher.
If a file already exists, the later restore can replace those new messages.

A public-entry probe of current behavior created a session and set messages.
No turn ran.
The file contained:

```json
{ "role": "user", "content": "saved without a turn" }
```

Needed: decide and test when a session starts managing a transcript.
Keep saving direct writes if the public cell stays writable.
Also cover two namespaces used through per-call `ns` in one session.
A session hook that only checks the ambient namespace misses that case.
An async restore cannot be slipped into a synchronous write hook.

The resource is still the right owner for the watch.
The draft's turn-only trigger is not a complete replacement for `persist`.

### 5. Medium, model mismatch: NATS selects a factory instance

Source: `packages/nats/src/index.ts:29`, `:69`, and `:126`.

The URL comes from constructor wiring.
The publish operation depends on the extension's one start value.
Changing `ns` on the publish call cannot select another connection.
Two connections currently require two calls to `nats`, with two publish handles.

The module also explicitly limits each piece to one live root at a time.
That guard is a stated contract, not an unnoticed cross-root leak.
It differs from the proposed reusable definition and namespace-selected instance.

Needed if NATS adopts that model: a config tag and a resource per connection.
Publishing depends on the resource; the extension runs the incoming subscriptions.
State the connection's owner and shutdown order before changing the module.
Adding a hook argument alone does not make this migration happen.

## What already fits

- **HTTP:** static config tags and send/attempt operations.
  No engine is needed just to make two configured calls.
  Source: `packages/http/src/client.ts:177`.
- **Drizzle:** the resource targets state the correct lifetime.
  The public frame builder still hides the authored resource declarations.
  The user rejected that wrapper on 2026-10-01.
  The correction declares config, database, and transaction units directly.
  See [the current impact block](HOOKS.md).
- **Harness:** shared SDK resources, a session-owned thread, and mutable output cells.
  Its two-agent namespace test passes.
  Source: `packages/harness/src/index.ts:215` and `tests/namespaces.test.ts:9`.
- **Hono and Stack server:** live listener state is created inside each start.
  Their defers close that start's listener.
  Source: `packages/hono/src/index.ts:190` and `packages/stack/src/server.ts:31`.
- **MCP:** the driver creates the server; the transport extension owns connection cleanup.
  That split is explicit in its example and two-server tests.
  Source: `packages/mcp/src/index.ts:115` and `packages/mcp/README.md:59`.
- **Stack migrate:** boot work uses the supplied database resource.
  It does not keep a changing root handle on the definition.
  Source: `packages/stack/src/migrate.ts:26`.

A module factory may still declare a different graph, such as different tools.
Using namespaces for live instances does not ban those factories.
Likewise, a shared SDK module resource is not shared conversation state.

## What this means for the context

The precedent is existing resource ownership and middleware around an action.
ADR 0063 already keeps a resource alive while a run uses it.
Extend that promise through the whole hook call.

```text
httpEngine: fixed definition
└─ scope
   ├─ directories: shared resource
   └─ GitHub session + github namespace
      ├─ active: mutable data
      └─ client: resource and cleanup
```

Keep `ctx.ns`, tag reads, controllers, resource access, and action calls.
Before accepting the shape, prove these rules:

- **Owner:** access selects both the current session and namespace.
  A namespace alone does not route into a sibling session.
- **Live state:** closing one owner cannot touch another owner's state.
  Reusing a definition after close starts fresh.
- **Waiting:** the hook's work and cleanup belong to the active run.
  A resource used across a wait stays alive until that use ends.
- **Setup:** name every public event that requires setup.
  A turn-only trigger does not cover all data writes.
- **Read coverage:** state which reads enter a resolve hook.
  Today it wraps root handle reads, not all child and dependency reads.
  Source: `packages/core/src/index.ts:5362`.
- **Shutdown:** stop new outside work before draining current work.
  The existing root-close tickets still own that rule.

My pick: prove owner isolation and hook lifetime first.
Use Sync and persistence as the first module cases.
Keep the current hook signatures until the replacement has a migration plan;
inserting `ctx` before `next` changes every existing callback.

## Checks

Public-entry probes imported the current core source.
For modules, a Node import hook mapped `@tinker/core` to that source.
The probes used the real in-memory transport, promise gates, and a temporary file.
No server, network request, sleep, or mocked implementation was needed.

Observed results:

- Sync cross-root close: reproduced.
- Sync subscription reuse after close: reproduced.
- Core graceful close before a waiting run hook ends: reproduced.
- Persistence saves a direct write without a turn: confirmed.
- Stack public-entry probe: blocked by missing `@hono/node-server`.

Existing tests passed, 174 total:

- Core: namespaces, extensions, hook layers, named release; 115 tests.
- Sync: `tests/sync.test.ts`; 52 tests.
- Tinkerer: `tests/persist.test.ts`; 6 tests.
- Harness: `tests/namespaces.test.ts`; 1 test.

These existing tests do not cover the newly reproduced failures.
The review did not change runtime code or add regression tests.

Style census over the reviewed sources exited 1.
It reports one existing S14 hit at `packages/core/src/index.ts:2199`.
Prose lint passed for tracked Markdown and all three authoring track files.
`git diff --check` passed.
Jev pre-flight found no changed source files and reported no flags.
The prior full-build, lint, and dependency failures remain recorded in
[the progress notes](PROGRESS.md#checks).
