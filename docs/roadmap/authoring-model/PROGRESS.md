# Authoring model

Date: 2026-09-30.
Status: Done; all checks passed; landed and pushed on main.
Owner: lead (authoring-model session).

Source checkpoint: `dfaad530`; tag: `core/tauthoring-model`.
Core: 16,373 bytes gzip under the approved 16,384-byte cap.
All 17 test tasks, 48 release lanes, and 14 fault lanes pass.

## Fixes authorized

The user asked to handle all five review findings on 2026-09-30.
The user then asked for one discriminated event object that is lazy and cheap.
Use `hooks: { run(event), close(event) }` beside the existing callback form.
The event contains `kind`, the call data, `next`, and owner-bound access.
Access is built when used; pass-through hooks do not need that context.
Named hooks keep dispatch limited to the kinds the extension uses.
Work in isolated checkouts; do not replace the active root-lifetime work.

## Tickets

- **t01 hook owners and lifetime** — blocked by: none.
  Model: Astra, xhigh; package: core.
  Hooks receive namespace-bound access to their actual owner.
  Waiting before or after `next` belongs to the run.
  Verify: inherited and explicit namespaces, tagged calls,
  resource holds, cleanup, graceful and forced close.
- **t02 Sync owners** — blocked by: t01 for integration.
  Model: Astra, xhigh; package: sync.
  One definition serves two roots and can restart after close.
  Verify: closing A preserves B's transport and data updates.
- **t03 Stack publisher owner** — blocked by: none.
  Model: Astra, xhigh; package: stack.
  A commit refreshes its own root's published data.
  Verify: reuse one publisher across two roots and POST only in A.
- **t04 persistence setup** — blocked by: t01.
  Model: Astra, xhigh; package: tinkerer.
  Namespace tags select transcript files; direct writes still save.
  Verify: direct writes before a turn, per-call namespaces,
  restored history, one watch per owner, and close cleanup.
- **t05 NATS instances** — blocked by: t01.
  Model: Astra, xhigh; package: nats.
  Namespace config selects a reusable connection resource.
  Verify: two namespaces use two connections and reuse one graph;
  one closed root cannot affect another root's connection.

## Impact before code

Public type: `Scope.Extension` gains optional object-form `hooks`.
Public type: `Scope.ExtensionEvent` is a union selected by `kind`.
Each event provides current owner access and `ns`.
Public type: `Resource.Ctx` gains the namespace chain used for its build.
NATS needs that chain to route incoming messages into the right session.
Existing top-level callbacks keep their arguments and result types.
Tagged calls enter their real child before run hooks, including legacy hooks.
This order gives new hooks the same owner as the body.
New callbacks get one event with payload, continuation, and lazy access.
Consumers: all extension declarations in core tests, Sync, Tinkerer,
Stack, NATS, Hono, MCP, and examples must still type-check.
NATS and persistence add namespace config tags while keeping existing
constructor calls working through their existing default settings.
SCIP references and full consumer tests are checked before completion.

## Progress on fixes

- Toolchain setup and frozen dependency install passed.
  `vp env doctor` now passes; the full main build passes.
- Main check passes with 0 errors and 29 warnings after formatting our docs.
- Stack owner regressions failed before the fix and pass afterward.
  Stack 65 and tracker 79 tests passed, with 48 validation lanes green.
  Writer commits: `0e911137`, `0a6905b8`.
- Core's event implementation passes 756 tests and the build/check gate.
  Writer commits: `aea80bca`, `444b7772`, `2b5c8cb5`.
  Final constructor: `fb4fd6c2`; callback-order note: `c6912392`.
  Review fixed early input parsing in a refused hook,
  caught and unreturned body failures, and a saved raise's origin.
  Final review caught saved `settle` calls throwing on closed admission.
  Two tests failed before `3011a93f`; they now return flat Results.
  The hot-name slot check passes at 252 names, last slot 254.
  The user approved a 16 KiB Core cap on 2026-09-30.
- Sync's four owner regressions failed before the fix and pass afterward.
  Writer commit: `fb34c18b`.
  Review added resource cleanup for failed boot; two more regressions prove it.
  Fix-round commit: `f8b5ac59`.
  The fix round passes 75 Sync tests and the build/check gate.
- Persistence keeps the legacy session-only behavior.
  Its new tagged API exposes a setup resource for non-ambient controller reads.
  Writer commit: `014938f6`; Tinkerer passes 97 tests.
- NATS keeps constructor settings as a fallback for namespace config tags.
  Its setup resource owns connections; the root driver opens message sessions.
  Writer commit: `fdb34ebf`; 28 tests use real NATS servers.
  Boundary tests in `94583f40` cover setup and shutdown without source changes.
  The extension's resolved sender remains available.

## Cost checks

Queue probes use clean checkouts, not hand timing.
The 61-pair no-hook probe compares `2700a440` and `444b7772`.
It measured medians 63.2 and 63.0 ns, with MAD 0.5 and 0.2 ns.
No speed gain is claimed from that result.

The first event pass-through probe was slower than legacy callbacks.
`benchctl ab` reported `b is slower`: 3018 versus 5866 ms
for ten million calls, a 94.4% increase.
The final run event uses direct fields on one object.
It makes no intermediate payload object or copy.

The final legacy/event probe reports `no difference we can see`.
Medians were 2822 and 2831 ms for ten million calls.
The paired change was 0.3%, with a 95% range of −137 to 221 ms.
The old/new event probe reports `b is faster`, a 49.1% reduction.

A final no-hook probe reports `b is faster`.
Medians were 3901 and 3821 ms for fifty million calls.
No speed gain is promised; these checks found no slowdown.

Before the remote merge, Core was 16,147 bytes gzip.
The old cap was 15,360 bytes, leaving 787 bytes to resolve.
The user chose a 16 KiB cap, 16,384 bytes, on 2026-09-30.
The cap and release-check label now use that limit.
The final size review found no small cut that recovers all 787 bytes.
Sharing more context or cleanup code needs new lifetime and cost checks.

Core constructor follow-up: `fb4fd6c2`.

## Fault checks

Full package mutation lanes run alone under `/tmp/mutation.lock`.
The required floor remains 85 for every package.

- Stack: 88.29, exit 0.
- Sync: 85.43, exit 0.
- Tinkerer: 95.19, exit 0.
- NATS first run: 78.40, exit 1.
  Public setup and close tests were added for shipped promises.
  Final run: 85.80, exit 0; 139 killed, 18 survived, 5 uncovered.
- Core first run: 85.12, exit 0.
  Final run: 85.36, exit 0, after the saved-settle fix.
  Counts: 2898 killed, 30 timed out, 476 survived, 26 uncovered, 3 errors.

## Gates before the size choice

- Full build: exit 0.
- Code check: exit 0, 0 errors and 29 baseline warnings.
- Recursive package and app tests: exit 0, all 17 tasks pass.
- Prose lint: exit 0, 0 hits in 150 tracked files.
  The three new decisions also pass when checked outside the frozen path.
  All six new notes have no wide fenced lines or table rows.
- Release validation: 47 of 48 lanes pass, exit 1.
  The only failure is Core size, 16,147 bytes against 15,360.
- Core ticket gate: exit 1 at the same size check.
  Its code check and recursive tests pass.
  It made no checkpoint, tag, or landing.
- Full fault lanes pass for all five changed packages.
- Final queued event probe: no difference we can see versus legacy hooks.
- New source and tests add no style hits.
  Existing Core and Tinkerer strict hits were also reproduced on main.

Logs are saved under `/tmp/tinkered-authoring-final*`.
The ticket log is `/tmp/tinkered-authoring-final-ticket.log`.
The release log is `/tmp/tinkered-authoring-final-validate.log`.
These results are from before the approved cap change and remote merge.
The final landing results are recorded below.

## Lead review

The source and test diffs were reviewed.
New Core access keeps resources held and work tracked.
Sync also has resource cleanup for failed startup.
Stack deliberately keeps post-commit publication on the root.
NATS keeps its resolved sender and old config fallback.
Persistence states its explicit setup rule before direct reads.

Jev review could not read the large Core file in one call.
The lead read its diff; unit preflight was also completed.
The combined review flagged commit overclaim using a shortened diff.
The full diff and passing tests support the recorded changes.
Core adds 15 ownership labels; calibration completed at `54c5b7e7`.

SCIP indexes were refreshed for the five changed packages.
Refs confirm Extension types and Resource.Ctx.ns use across consumers.
Full consumer build and tests passed together.
Check reports 0 errors and the same 29 baseline warnings.

Integration used branch `authoring/model-fixes` in its own checkout.
That checkout and branch were removed after landing.

Current shape: [Extension access, derived from cases](EXTENSION-SHAPE.md).
ADR 0089 records the accepted object API.
The implementation landed and all final gates passed.

Current review: [module findings and proof](REVIEW.md).
The review reproduced Sync owner leaks and early close during a run hook.
It also found a Stack owner capture, a gap in the persistence sketch,
and NATS wiring that still selects factory instances instead of namespaces.
The original focused checks passed 174 tests before the new regressions.
The five findings now have saved fixes and passing focused checks.

## Starting point

The notes below record the design discussion and probes before the fixes.
The current implementation and gate results are above.

The user proposes three roles:

- Tags, resources, operations, and data form the public API.
- An extension runs the work needed by a module.
- A namespace supplies settings and separates instances.

The existing precedents are a keyed service map for namespaces
and a system that starts and stops services for extensions.
See ADR 0059, ADR 0060, and ADR 0064.
ADR 0081 already keeps outside libraries behind authoring units.

## Agreed roles

User clarification, 2026-09-30:

- Tags provide static values.
  Different namespaces may bind different values.
- Data is mutable state by design: read, watch, set, and update.
- Resources provide reusable values with a managed lifetime and cleanup.
- Operations are actions.
- Extensions must know which namespace they are handling.
- Namespace tags tell an extension what to manage.
- Extensions must be able to control that instance's state.
- Keep the authored graph and namespace bindings immutable.
  Reuse declarations; data values change within scopes and sessions.
- Close the owning session to discard an instance's session-owned state.
  Shared dependencies can outlive that session.
  This replaces the proposed namespace disposal API (ADR 0088).
- Isolation means multiple instances with separate settings and state.
  GitHub and Cloudflare HTTP clients use different namespaces.
  They may share the same directory management.
- A module needs the public promise listed below.

These are design requirements, not claims that the missing hooks exist.
Keep ADR 0070's rule: a status has one writer, its owner.
That decision already uses the controller precedent: watch state and act.
How extensions discover namespaces is still open.

## What the code adds to this picture

```text
Scope — extensions and shared resources
├─ GitHub session — GitHub namespace
└─ Cloudflare session — Cloudflare namespace
   Same fixed graph; separate live state.
```

- Core supplies controllers.
  Operations receive them through `depends`.
  An extension can use them, but need not exist for them to work.
  Source: `packages/core/src/index.ts`, `Scope.SlotValue` and `Scope.Handle`.
- A namespace selects settings and storage.
  Its public shape has only an identity and tag bindings.
  Source: `packages/core/src/index.ts`, `Namespace` and `namespace`.
- Scopes and sessions own lifetime.
  A resource's target chooses sharing within that lifetime.
  Source: `packages/core/README.md`, Namespaces.
- Plain operations can drive other operations through `depends`.
  The two-agent relay already does this without an extension.
  Source: `packages/harness/tests/namespaces.test.ts`.

## Code gaps and rules to settle

### 1. How an engine serves an instance

An extension starts once per installed entry.
Its start value is stored by extension identity, not namespace.
Creating a namespace does not install or start an extension.
Source: `packages/core/src/index.ts`, `extendHandle` and `resolveExtension`.

Case: two mail accounts share one send operation.
The root must say which engine serves each account.
It must also decide when each account's settings are checked.
ADR 0081 checks a piece's config at start; core has no list of namespaces
whose settings every extension must check.

Agreed: tags on a namespace tell an extension what to control.
Open: how that namespace reaches the extension, and when settings are checked.
Session-target resources belong to the disposable session.
Namespace-target resources remain root-owned and outlive a child session.

### 2. Which instance a hook is handling

Run hooks receive the caller's input object.
An inherited namespace need not appear in that object.
Write and resolve hooks receive no namespace argument.
Source: `packages/core/src/index.ts`, `Scope.Extension`,
`operationController`, and `writeWithHooks`.

Case: two agents write the same declared status cell.
A hook receives the cell and value but cannot tell the namespace.
Per-instance limits or write rules need that context.
Also, resolve hooks still wrap root reads only, while run and write hooks
reach child sessions and operation dependencies.
Source: `resolveThrough` and `packages/core/tests/ext-hooks-layers.test.ts`.

Agreed: the extension must know the active namespace and control its state.
Open: the hook context, which reads it covers, and how its controllers
keep the active session as well as the namespace.

### 3. Close the session that owns the state

Agreed: use session lifetime to discard live state.
The authored graph and namespace key remain reusable.
`session.close()` already cleans its own values and resources.
Source: `packages/core/src/index.ts`, `Scope.Handle` and `Resource.Handle`.

Choose resource targets by their intended owner:

- `session`: this session's client, freed when the session closes.
- `scope`: a shared directory service, kept until the root closes.
- `namespace`: a root-owned value per key, also kept past child close.

The last target is not suitable for a client that must die with a session.
A request child also gets its own session-target resources; an instance
session is not an automatic parent cache for those child resources.
ADR 0064's ownership rule still applies.

### 4. How separate instances share a dependency

`ns: [agent, tenant]` is a fallback search.
It does not assign tenant resources to the tenant automatically.
A fresh namespace-target resource builds under the first key.
Source: ADR 0064, Decided: where a chain keeps a build.

Case: agents A and B need separate histories and one tenant database pool.
The design needs an explicit way to keep that pool under the tenant key
while their other state stays under their agent keys.
This can begin as a wiring recipe; no new primitive is agreed.

### 5. What isolation promises

Namespace reads can fall back to another key or the default.
A call can explicitly select another namespace.
Scope-target resources are shared across namespaces.
Source: `packages/core/README.md`, Namespaces.

Agreed: isolation means support for multiple instances.
The user's example is GitHub and Cloudflare clients in separate namespaces
with shared directory management.
Access control and strict no-fallback reads are outside this requirement.

### 6. What a module promises its callers

The unit kinds exist, but a module still needs to state:

- Which settings are required.
- Which operations callers may run.
- Which data callers may read or write.
- Which failures callers should handle.
- Which resources are shared and who closes them.
- How it connects to another module or an outside event.

Existing tools cover much of this: exports, `depends`, tag readers,
error registries, resource targets, and driver wiring rows.
See ADR 0051 and ADR 0081.
The missing part is one authoring recipe that puts these rules together.
No module container API is agreed.

## Static graph, disposable session

The user clarified: throw away the session and keep the graph immutable.
ADR 0088 replaces ADR 0087's proposed namespace disposal rule.

At the composition root, using existing API:

```ts
const githubSession = scope.createSession({ ns: github });
const cloudflareSession = scope.createSession({
  ns: cloudflare,
});

await githubSession.close();
```

GitHub's session-owned state and resources are freed.
Cloudflare and the shared scope-owned directory service stay live.
The graph and both namespace keys remain unchanged.
This uses the existing close rules, including graceful close when requested.

The graph is fixed, but values can still be built lazily.
Creating a session does not create new unit declarations or dependency edges.
Extensions operate on live state in the right session and namespace.

One existing limit still needs care: passing `ns` changes the storage key
within the current session; it does not jump to a persistent sibling session.
The cross-instance relay case from ADR 0059 must keep that distinction.
Next: settle state ownership across requests and calls before choosing
the extension context API.

## What the next probes found

Checked on 2026-09-30 through the core entry.
These are limits of the current rules, not claims that shipped tests fail.

### A session is a lifetime, not another name for a namespace

Several namespaces can share a session and end together.
Separate sessions are useful when their lifetimes differ.
Do not turn the earlier two-session example into a one-to-one rule.

Two cases need a clear owner rule before the hook API is fixed.

**Requests using one live instance:**

```text
Scope — shared directories
├─ GitHub session — client and state
│  ├─ Request A — temporary work
│  └─ Request B — temporary work
└─ Cloudflare session — client and state
```

This picture describes the intended sharing, not current resource lookup.
The probe built a session-target client in the GitHub session.
A request child built another client.
Writing a data cell in the child did not update the GitHub session's cell.
The owner still read 10 after the child wrote 11 and closed.
Existing cell shadowing is useful for request data, but it cannot also mean
that every write changes long-lived instance state.

**One operation calling two live instances:**

The probe wrote 10 and 20 in two sibling sessions under different namespaces.
A relay at the root called the same read operation once per namespace.
It read `[0, 0]`, not `[10, 20]`.
Direct reads from the two sessions still gave `[10, 20]`.
`ns` chooses a storage key in the current session; it does not find a sibling.
Keep ADR 0059's cross-instance call case when designing ownership.

Source: `packages/core/tests/namespaces.test.ts`,
`packages/harness/tests/namespaces.test.ts`, and the direct entry probe.

### Hooks need the effective context

The probe ran one operation in two sessions with different ambient namespaces.
Both run hooks received `call?.ns === undefined`.
Two writes of the same value to the same declared cell gave identical
write-hook arguments despite writing different namespace stores.
An extension cannot choose the right instance from those arguments alone.

Proposed requirement: expose the effective namespace and tags, the calling
session, and controllers bound to the intended state owner.
The owner rule comes first; a hook that only gets the caller can still write
the wrong store.
Source: `packages/core/src/index.ts`, `Scope.Extension` and `operationController`.

### Fixed declarations; mutable data

The user clarified the boundary: tags are static, data is mutable,
resources provide lifecycle and reuse, and operations are actions.
The fixed graph describes those units and how they depend on one another.
Its data values are expected to change.

This removes data immutability from the list of missing design capabilities.
Data already provides `get`, `set`, `update`, and `watch` through a controller.
Resource creation and cleanup already follow the selected owner.
The remaining question is which namespace and session those controllers use.

The probes also found that bindings retain config object references and cells
can share an initial object until written.
Those facts describe the current implementation; they do not change these roles
or establish a new requirement to freeze or copy all values.
Source: `packages/core/src/index.ts`, `tag`, `namespace`, and `data`.

### Selection, readiness, and writers still need rules

- Tags say which extension applies, but do not register a namespace with it.
  Settle when it sees the instance and validates its settings.
- If initialization must finish before use, define where callers wait.
  Root `ready` alone does not describe instances created after boot.
- Keep one owner for each state cell (ADR 0070).
  Two extensions matching the same namespace must not compete for that cell.
- A controller's own write must not cause it to repeat forever.
  A rule for observing changes must distinguish them from requesting changes.
- Watches and background work must end with their owner.
  Closing one instance must not close a shared dependency still in use.

These are design checks; the probes above did not demonstrate new failures
for extension readiness, competing writers, or cleanup.

## Initial checks

- The follow-up entry probes confirmed request-client duplication, local child
  writes, sibling-session separation, missing hook context, and shared mutable
  config or initial values.
  All assertions matched the current behavior.
- A direct probe through the core entry passed on 2026-09-30:
  closing GitHub's session freed its client; Cloudflare and the shared resource
  stayed live; a fresh session reused the same namespace with fresh state;
  root close cleaned the remaining resources.
  This proves ownership with in-memory resources, not a live HTTP integration.
- `vp run prose`: passed, 0 hits in 147 tracked files.
- The new note's direct prose check: passed, 0 hits.
- Core namespace, release, and extension tests: 115 passed in 4 files.
  Command from `packages/core`:

  ```bash
  vp test tests/namespaces.test.ts \
    tests/named-release.test.ts tests/extensions.test.ts \
    tests/ext-hooks-layers.test.ts
  ```

The workspace build failed in `@tinker/react` with TS2688:
`Cannot find type definition file for 'node'`.
Log: `/tmp/tinkered-authoring-model-build.log`.

- `vp check`: failed, 54 errors and 29 warnings in unchanged code.
  Format check passed.
  Log: `/tmp/tinkered-authoring-model-check.log`.
- `vp run -r test`: failed; Jev cannot import `@microsoft/tsdoc`.
  The full test run did not complete.
  Log: `/tmp/tinkered-authoring-model-tests.log`.

`vp env doctor` also failed: missing command shims.
Its suggested command is `vp env setup`.
Node resolves to `/usr/local/bin/node`, not a Vite+ shim.
This was inspected only; setup was not changed.

The glossary's extension row had said session calls and dependency writes
bypass hooks; corrected to a short meaning matching current behavior.
Source comments repeat that old limit and remain follow-up work.

## Landing after the size choice

The user chose 16 KiB and asked to finish landing on 2026-09-30.
The remote branch had 31 newer commits at `37d87dca`.
The integration merge keeps RootLifetime and the NATS trace work.
Core recognizes both hook forms on the new root path.
A signal-root object-hook regression failed before the route fix.
Both Jev label banks were kept; the final bank has 1,794 labeled cases.
Calibration passed, exit 0; its updated report is in the checkpoint.
Final gates follow the merge; earlier fault scores do not cover it.

Merged build: exit 0.
Merged code check: exit 0, 0 errors and 28 existing warnings.
All 17 package and app test tasks pass, exit 0.
Core passes 776 tests; NATS 33; Stack 94; Sync 75; Tinkerer 97.
Release validation: all 48 lanes pass, exit 0.
Core is 16,373 bytes gzip against the approved 16,384-byte cap.
The merge cut a single-use getter while keeping resource read order.
The pass-through event and no-hook paths did not change in that cut.
SCIP indexes and references were refreshed after the merge.
The review covers the root signal path and NATS's optional span argument.
The Core ticket gate passed, exit 0, and made `core/tauthoring-model`.
Its fault lanes ran one package at a time under `/tmp/mutation.lock`.
Merged Core fault score: 85.55, above the required floor of 85.

All 14 fault lanes passed their own floor check:

- Core: 85.55.
- NATS: 87.67.
- Stack: 85.36.
- Sync: 85.22.
- Tinkerer: 95.19.
- Utils: 100.00.
- MCP: 98.51.
- HTTP: 89.70.
- Drizzle: 93.86.
- Hono: 86.09.
- React: 93.16.
- Process: 96.10.
- Harness: 85.29.
- Blueprint: 86.27.

Main fast-forwarded to `dfaad530` and was pushed with the checkpoint tag.
Source and test hashes match the fault-checked checkout for all 14 packages.
Main's fresh frozen install, build, check, tests, prose, and size passed.
Its check reports 0 errors and the same 28 existing warnings.
Its size check reports 16,373 bytes against the 16,384-byte cap.
Only the eight task checkouts and their eight branches were removed.

Merged logs:

- `/tmp/tinkered-authoring-merged-build.log`
- `/tmp/tinkered-authoring-merged-check.log`
- `/tmp/tinkered-authoring-merged-tests.log`
- `/tmp/tinkered-authoring-merged-validate.log`
- `/tmp/tinkered-authoring-landing-ticket.log`
- `/tmp/tinkered-authoring-landing-scip-refs.log`
- `/tmp/tinkered-authoring-landing-final-calibration.log`
- `/tmp/tinkered-authoring-landing-mutation-results.json`
- `/tmp/tinkered-authoring-landed-install.log`
- `/tmp/tinkered-authoring-landed-build.log`
- `/tmp/tinkered-authoring-landed-check.log`
- `/tmp/tinkered-authoring-landed-tests.log`
- `/tmp/tinkered-authoring-landed-prose.log`
- `/tmp/tinkered-authoring-landed-size.log`

## Playground build proof

The playground release branch includes checkpoint `dfaad530`.
Its build copies the checked Core and React files into the browser vendor files.
A browser probe runs an object hook with the correct namespace.
It returns 42 and closes with success.

## All current packages and apps — done

The user asked for this round on 2026-09-30.
Scope: all 14 packages, all three apps, and a Harness service example.
The package-by-package audit and impact lists are in
[PACKAGES.md](PACKAGES.md).

Saved changes fix Harness turn ownership, Sync setup cleanup,
Stack namespace publication, React owner results, Blueprint source checks,
Hono request cleanup, Process startup abort, and Tinkerer stream steering.
Trace is a reusable extension with a separate telemetry graph.
Each root owns its queue, export work, timer, and final flush.
Missing or invalid trace settings now let the root finish closing.

The user picked a signal on one Core call.
That call owns a child session and all its waits and retries.
Cancel waits for cleanup and keeps the caller's owner alive.
Tinkerer's stream action consumes the response inside that child lifetime.
Conversation cells remain with the parent.
No-signal calls keep their existing result and resource targets.

Source `da27c9cc` passed full build, check, all 18 test tasks, and prose.
Check: 0 errors and 28 existing warnings in 500 files.
Release validation: all 48 deterministic lanes pass.
Core size: 16,382 bytes gzip against the 16,384-byte cap.
The size funder keeps reads, promise boundaries, and cleanup order.
SCIP references before and after cover all 14 packages.

The example gives one Harness conversation two declared tools.
GitHub and Cloudflare use separate HTTP namespaces and tokens.
Both share the Harness working-directory setting.
Six service tests cover two turns, token separation, root reuse,
URL validation, response limits, and failed responses.
No live service account was called.
The example also keeps the existing React form test task.

Queued timing: A `1c5c82fe`, B `145353bc`, 61 pairs per path.
The same probe reads both built entries; each row used batch mode.
Paired sign test: two-sided p below 0.01 means a seen difference.
`op`, `run`, `session`, and `lifecycle`: no difference we can see.
`tagged`: B slower in the first check; the follow-up below removes that cost.
These five paths do not claim coverage of all timing paths.

Main landed React namespace resets at `49635a5d` during this review.
Both sets of React promises are kept; all 87 React tests pass.
The shared Jev case bank keeps both teams' labels.
The labels concern graph-owned state, cleanup, and typed defaults.
Constructor nodes stay inside builders when their identities link one graph.
Whole-range review compared a mixed diff with one commit title;
the Process source and its red test were reviewed directly.
Old promise and census notes outside changed cases remain follow-up work.

Follow-up source `577e7f6c`, integrated as `db6d53bf`, keeps the body callback
out of the ordinary tagged path.
Call reads and cleanup order remain unchanged.
Four small close/outcome helpers fund that cold body helper.
Core is now 16,384 bytes gzip, exactly at the cap.
The last hot slot is 251, leaving four names.
Merged build, check, all 18 test tasks, prose, and 48 release lanes pass.
Check: 0 errors and 28 existing warnings in 506 files.

Queued recheck: A `1c5c82fe`, B `b2fe2204`, 61 pairs per path.
Every checked path reports no difference we can see.
The [learnings entry](../../../research/learnings/2026-09-30-authoring-call-signal.md)
records the limits and links both raw CSV files.
All 14 fault lanes run one at a time under `/tmp/mutation.lock`.
The Core ticket's advisory diff had no uncommitted source to judge;
its commit-title flag does not contradict the reviewed source diff.
Its impact lookup does not find this track's compound checkpoint name.
The impact blocks above and in PACKAGES.md were written before source changes.
SCIP indexes and public references were refreshed for all 14 packages.
Lead review of `main..HEAD` has 0 source flags.
Core exceeds the judge's file-size limit and was reviewed by changed function.

Both label banks were kept; the merged bank has 1,827 cases.
Full calibration and the two changed Core-flag calibrations pass.
The new false labels name owned Layer state and the tracked close promise.

The Core ticket script ran all 14 fault lanes one at a time.
Thirteen passed; Stack scored 83.84, below its floor of 85.
The script's best-effort mutation step hid that failure and made a checkpoint.
The lead checked all scores and removed the unpublished checkpoint tag.
Nothing was pushed.

Stack patch `46bf1f74` changes only tests, their collector fixture, and README.
Trace setup now runs inside registered tests, so a broken factory fails a test.
Public cases check failed-span output and promised drop warnings.
The focused check caught 13 previously missed faults.
Stack has 106 passing tests; tracker has 79.
The full Stack fault rerun passed, exit 0, with score 85.95.
Source, test, and config hashes match the other 13 passing runs.
Only four Stack test inputs changed across 374 checked files.
Runtime source did not change after the first full fault run.
The [fault proof](package-fault-proof.json) records each score and its input hash.

All 14 final scores pass the floor of 85:

- Blueprint: 86.00.
- Core: 85.55.
- Drizzle: 93.86.
- Harness: 85.64.
- Hono: 86.43.
- HTTP: 89.70.
- MCP: 98.51.
- NATS: 87.67.
- Process: 94.61.
- React: 92.75.
- Stack: 85.95.
- Sync: 86.31.
- Tinkerer: 91.82.
- Utils: 100.00.

Final build, check, all 18 test tasks, and prose pass, exit 0.
Release validation: all 48 deterministic lanes pass, exit 0.
Core size: 16,384 bytes gzip; cap: 16,384.
Stack's strict style census passes; TSDoc has 0 rows.
The final whole-range review has 0 source flags.
Its one commit-title flag was checked against the mixed source diff.
No new Jev labels were added after the passing calibration.

Observed final logs:

- `/tmp/tinkered-authoring-packages-final-build.log`
- `/tmp/tinkered-authoring-packages-final-check.log`
- `/tmp/tinkered-authoring-packages-final-tests.log`
- `/tmp/tinkered-authoring-packages-final-prose.log`
- `/tmp/tinkered-authoring-packages-final-validate.log`
- `/tmp/tinkered-authoring-packages-final-size.log`
- `/tmp/tinkered-authoring-packages-stack-mutate-final.log`
- `/tmp/tinkered-authoring-packages-final-mutation-results.json`

Main fast-forwarded to proof checkpoint `8db3aede`.
Its fresh frozen install, build, check, all 18 test tasks, prose, and size pass.
Code check: 0 errors and 28 existing warnings in 506 files.
Core size: 16,384 bytes gzip at the 16,384-byte cap.
All 374 checked source, test, and config inputs match the fault-tested checkout.
The final checkpoint tag is `core/tauthoring-packages`.
The card moved from Review to Done after this proof was observed.

Main verification logs:

- `/tmp/tinkered-authoring-packages-landed-install.log`
- `/tmp/tinkered-authoring-packages-landed-build.log`
- `/tmp/tinkered-authoring-packages-landed-check.log`
- `/tmp/tinkered-authoring-packages-landed-tests.log`
- `/tmp/tinkered-authoring-packages-landed-prose.log`
- `/tmp/tinkered-authoring-packages-landed-size.log`

## Existing Process card completed

The `process/early-abort` card is covered by source `5b7a0cd5`.
A signal aborted during startup used to miss the attached listener.
The public regression failed before the fix.
It now returns 130 without running the command.
Failed readiness finishes close hooks once.
Root completion passes a signal and waits for `closed`.
Process: 50 tests pass; fault score 94.61, above the floor of 85.
The merged code check passes with 0 errors and 28 existing warnings.
The existing card moved from Ready to Done; no duplicate card was added.

## Remove positional extension hooks — final merge checks

The user asked for this migration after the package review landed.
The impact block and package briefs are in [HOOKS.md](HOOKS.md).
ADR 0093 replaces ADR 0089's compatibility rule with one event hook form.
The graph, namespace, ownership, and middleware behavior stay the same.
The 16 KiB Core cap stays in force.
All current packages, apps, examples, and behavior tests use event hooks.
Historical decisions and past proof retain the API they recorded.

The hooks-only start-log probe still drops both lines around `event.next()`.
This migration does not close `core/start-log`.

The lead kept main's 11 standalone examples and stack/t17's new behavior.
Source checkpoint `87280748` passes build, check, all 28 test tasks, and prose.
Code check: 0 errors and 28 existing warnings in 558 files.
All 48 release lanes pass; Core is 16,275 bytes gzip at the 16,384-byte cap.
The final audit checks 205 extension calls across 404 current files.
All use a literal config with no positional hook or spread.
SCIP indexes all 14 packages and finds no reference to the six removed methods.

The full ticket gate passes at `67444b81`; all 707 initial inputs still match.
Both merged package reruns pass: Hono 91.38 and Stack 86.00.
All 14 package scores pass the floor of 85.
The other 12 packages keep identical source, tests, config, and built modules.
All 777 merged inputs match after the final fault lanes finish.
The complete scores and checked hashes are in [hook-fault-proof.json](hook-fault-proof.json).
The final code review has 0 flags; the full calibration run finishes with exit 0.
The unchanged Core `panics[0]` census row stays outside this migration.

Main fast-forwards to checked checkpoint `debbc428` while keeping local review notes.
Its fresh install, build, check, all 28 test tasks, prose, and size pass, exit 0.
All frozen source, test, and config inputs still match the fault-tested code.
The card moves to Done; the final checkpoint tag is `core/tauthoring-hooks`.

Remote main lands stack/t18 before the hooks push.
The final merge keeps its root signal, exit helper, and every new behavior check.
Source `7782bf97` passes build, check, all 28 test tasks, prose, and 48 release lanes.
The final caller scan finds 207 calls, all in the event form.
Core remains 16,275 bytes gzip at the 16,384-byte cap.
The other 13 package inputs and built modules match their checked versions.
Remaining: the fresh isolated Stack fault gate, main verification, and push.

## Drizzle public API correction

The user found that `drizzleStore` still hides resources inside a frame.
The initial review accepted that shape; this correction removes it.
Author database config, database, and transaction declarations directly.
Namespaces choose database instances; session lifetime decides transaction outcome.
The library keeps logger and transaction adapters inside resource factories.
The impact block, caller list, and checks are in [HOOKS.md](HOOKS.md).
The obsolete Stack-only fault waiter ended before it acquired the lock.
The package and callers now use native static resources and config tags.
Database instances use namespaces; transactions use sessions.
Build, check, all 28 test tasks, and all 48 release lanes pass, exit 0.
Core stays at 16,275 bytes gzip under the 16 KiB cap.
The extra tracker browser-helper run passes all 7 tests.
The final scan finds 207 event hook calls and no public frame imports.
SCIP indexes all 14 packages with no removed symbol refs.
All 777 code inputs are frozen; the other 11 packages match their checked inputs.
The fresh fault gate passes, exit 0: Drizzle 96.77, Hono 93.01, and Stack 85.91.
All 14 package scores pass the floor of 85.
All 777 code inputs still match after the runs.
[hook-fault-proof.json](hook-fault-proof.json) records the scores and checked hashes.
The full calibration run passes and preserves all earlier bank rows.
Main's fresh install, build, check, and prose pass, exit 0.
Its code inputs match the full test and fault checked source.
The board-only upstream update is kept; other local review notes remain untouched.
The final tag is `core/tauthoring-hooks`.
Start logs still reach no sink; the separate `core/start-log` fix must rebase after this.

## PGlite public graph follow-up

The user found that Drizzle still exports only helper functions.
The approved follow-up publishes static driver units.
PGlite is the first driver, checked against the tracker and standalone example.
[Scope, impact, and proof](PGLITE.md).

The static PGlite graph, tracker caller, and standalone example are complete.
Opus review is READY with no blocking bugs.
Build, check, all 28 test tasks, browser-helper 7, and 48 release checks pass.
The fresh isolated Drizzle fault lane passes: 87.97, exit 0, floor 85.
All 336 frozen inputs match; the other 13 package proofs remain valid.
The runner uses a test-process flag for the observed Node 24 Wasm cleanup crash.
The first crash and successful retry are both recorded in [PGLITE.md](PGLITE.md).

Main fast-forwards to `f3e94f84`; local peer notes stay untouched.
Its fresh install, build, check, and prose pass, exit 0.
All 336 code inputs and built modules match the test and fault checked source.

The first push met upstream's auth and jobs landings.
Both tracks and every review label are retained in the final merge.
Its install, build, check, 30 test tasks, prose, and 52 release checks pass.
Drizzle, its Core runtime, and both SDK versions still match the fault run.
The original frozen proof describes `3d61241c`; upstream owns the new Hono,
Stack, Auth, and Jobs proof shown in the package proof's integration row.

## Example app entries

All ten command examples now export static graph units.
Executable bodies sit inside main guards and own their cleanup.
Tests create their own roots; importing an entry starts nothing.
[Scope, impact, and proof](ENTRIES.md).

Source `6de99118` has a READY Opus review with no bugs left.
Build, check, all 30 test tasks, prose, and 52 release lanes pass.
All ten changed examples also pass as fresh copies outside the repo.
Thirty imports start no work and add no signal listeners.
Strict style census and TSDoc checks pass.

The stop probes found a separate Core graceful-close bug.
Live entries keep the current reply, skip the next call, then close.
Their recorded response probes pass without live account use.
Harness preserves a failed reply's exit code after a stop request.
The Core fix stays Ready as `core/graceful-writes`.
No package runtime, package tests, or package build settings changed.
Their existing fault and timing proofs remain valid.

Main fast-forwards to `82dff2f6` and keeps the pending peer notes.
Its fresh install, build, code check, and prose pass, exit 0.
Its example and package code matches the checked source `6de99118`.

## Process review from its basic jobs

The user asked for a fresh review of Process's complexity.
The review follows a command, a stream, and an MCP service.
[Findings, exact source links, and proposed shape](PROCESS-REVIEW.md).

Build, check, all 50 package tests, and strict style census pass.
Real public-entry probes still show lost output and ignored cleanup errors.
The selected loader also stays outside the stop path.
The proposal keeps process tags and lazy routes, removes live output
collection, and lets extensions and Core own service lifetime.
No runtime code or settled decision changed in this review.

## Thin Process entries — checked 2026-10-01

The user approved the smaller Process model.
[Contract, impact, and full proof](PROCESS.md).
Routes load a command action or a service's extension graph.
`run` takes one object and returns a code; its caller owns the output.
`main` reads the host facts and leaves final exit to the guarded app entry.
Core owns start, stop, and cleanup on one root.
All Blueprint, Tinkerer, tracker, Process, Process CLI, and MCP callers moved.
No old public Result, executor, shell builder, or waiting action remains.

Opus high reviewed the runtime and final test changes: READY.
The lead's full build, check, and all 31 test tasks pass.
The check has 0 errors and 28 existing warnings.
The final Process suite passes 48 tests.
Strict census and TSDoc pass on all 32 changed TypeScript files.
Prose and the phone-width check pass on all 16 touched Markdown files.
Jev lead review has 0 flags; no new label state was added.
Three outside-repo example copies pass install, checks, tests, and run.

Fresh full fault lanes pass: Process 86.00, Blueprint 86.23, Tinkerer 91.82.
Every lane keeps the 85 floor and ran alone under the mutation lock.
The final Process lane skipped no faults.
Its 10 timeouts remove required setup or cleanup or create endless waits or loops.
Targeted stop and failure checks killed all 23 faults without a timeout.
All 54 deterministic release checks pass, exit 0.
Fault source, test, and config hashes still match the saved inputs.

Main fast-forwarded to `a2d25d8d` after the checked fault lanes.
Its fresh install, build, check, 48 Process tests, and prose pass, exit 0.
All fault input hashes match main too.
The other pending notes keep their saved bytes; no peer work was staged.

## Process is app entry support

The user settled Process's role after a review of its public API and callers.
It is a CLI host adapter, connecting the app's graph to a command line entry.
The app declares operations, resources, and extensions.
Process supplies routes, process tags, signals, and one root's lifetime wiring.
Core performs startup, work, and cleanup.
Process returns an exit code after that cleanup and lets pending output finish.

The authoring guide now names graph modules, host adapters, and helper libraries.
A helper-only library does not earn a `@tinker/*` package.
Graph builders count by the units they declare.
Process and React qualify through their Core host bindings.
Tags alone do not justify a graph module.

The Process README and glossary record the settled role.
ADR 0096 and the public API keep their existing meaning.
No runtime, test, package name, or import path changed.

Proof: `vp run prose` passes with 0 hits across all 174 tracked docs.
The phone-width check passes all five touched docs with 0 wide rows or lines.
`git diff --check` passes.
The lead's Process review passed all 48 tests and the strict style census.

## Package roles across the workspace

The user approved applying the settled roles to every current package.
[Package list, source links, and proof](PACKAGE-ROLES.md).
The review covers Core, 13 graph modules, and the Process and React host adapters.
Every surviving package exposes Core itself, reusable graph units, or host bindings.

The unused `utils` starter and its one lockfile entry are removed.
It had no source callers or workspace dependents.
All surviving runtime source, tests, and public APIs keep their saved bytes.
Drizzle's README names its driver graph entry and its shared resource helpers.
React's README names its view host adapter role.
The authoring guide links the complete package list.

Opus high review is READY on the removal and all 16 roles.
The lead applied its wording fix for Hono's `stream()` helper.
The Astra writer's install, full build, and check pass.
The check reports 0 errors and 28 existing warnings.
The lockfile diff removes only the starter importer.
The lead's local link check resolves all 32 links in the touched guides.
Jev lead review reports 0 flags; no labels or calibration state changed.
Writer preflight treated deleted paths as an empty file list and scanned unrelated source.
The writer stopped that advisory run; no unrelated fixes were made.

The lead's full build and check pass, exit 0.
All 29 package and example test suites pass, exit 0.
All 54 release checks pass, exit 0.
All six touched docs pass prose and phone-width checks.
Prose reports 0 hits across 174 tracked docs.
Focused strict census passes.
All 728 surviving package, app, and example inputs match current-main base `7e75db1b`,
except the two README role notes; existing runtime fault proof remains valid.
The first full gate used `5487051b`.
After the rebase, install, full build, and check pass again.
Hono passes 93 tests; Stack 136; Jobs 26; tracker 87.
Final prose and phone-width checks pass on all six touched docs.

## UI state exit, 2026-10-02

The user chose to ask state-owned work to stop on state exit.
Late replies must not change the shared context.
The model uses resources for states, data for context, and operations for actions.

Each state resource instance owns a fresh `AbortController`.
Each call carries that instance's signal, as in ADR 0090.
The exit operation aborts it before the driver releases the resource.
Before publishing a reply, the operation checks `ctx.signal.aborted`.
Resource cleanup also aborts the controller.
Cleanup alone is too late while a call still uses the resource.

The state resource keeps the context controller it resolved.
Accepted replies write through that controller into the shared context.
A signalled call's own data writes would stay in its child session.

Proof: a public-API probe imported current Core source with Node's type stripping.
The old call received its stop signal but returned a reply later.
A new state instance published its reply before that old reply arrived.
Every assertion passed, exit 0.

```json
{
  "oldStopRequested": true,
  "newStateStillActive": true,
  "oldOutcome": "cancelled",
  "newOutcome": "success",
  "published": ["new"],
  "context": "new"
}
```

No Core source or public API changed.

Checks: `vp run prose` passes with 0 hits across 176 tracked docs.
The lead read the doc diff; `git diff --check` passes.
