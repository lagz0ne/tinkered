# One extension hook shape

Date: 2026-09-30.
Status: Done; event hooks and the static Drizzle resource API pass all gates.
Owner: lead (authoring session).
Writer model: Astra, xhigh; one package per writer.

## Goal

The user asked to remove legacy hooks and migrate all current extensions.
Use the existing object hook shape as the single API.
Keep middleware order, namespace access, results, and cleanup behavior.
Keep the fixed graph and lazy event rules.
Core's 16 KiB gzip cap remains in force.

```ts
const boot = extension({
  label: "boot",
  hooks: {
    async start(event) {
      await event.next();
    },
  },
});
```

## Impact before code

Public symbols: `extension`, `Scope.Extension`, and `Scope.Hooks`.
Remove top-level `start`, `resolve`, `run`, `write`, `close`, and `session`.
Keep those six verbs inside `hooks`, each taking one bound event.
Remove legacy dispatch and precedence branches from Core.
This is an intentional source API break authorized by the user.

Callers to migrate:

- Core's extension, session, lifetime, namespace, and signal tests.
  Its hook probe must stop constructing a legacy extension.
- MCP's driver and server tests.
- Hono's driver and lifetime tests.
- Stack's server, migrations, publication, and legacy trace wiring.
  Keep `traceSink(wiring)` itself; only its hook declarations change.
- NATS, Sync, Process, and Tinkerer tests.
  Their already-migrated runtime hooks stay unchanged.
- The tracker tool entry and client test.
- MCP and Process examples.
- Blueprint source fixtures and Jev authored-code fixtures, when found.
  Jev's existing body reader must find `hooks.start` for its same clock checks.
  Update that API path and its fixtures; keep the rule and judge questions unchanged.
- Current README and authoring guide examples.

Check named and imported aliases through SCIP before and after code.
Check object literals returned as `Scope.Extension`, too.
Historical decision records and past proof remain history.
Other teams' unpublished worktrees stay untouched.
The saved `core/start-log` branch changes the same dispatch area;
its next merge must use the object hook API.

## Writer brief

Read `docs/roadmap/contributor-brief.md` and the coding skill first.
Use one package per writer, in a private worktree based on this plan.
Lead owns docs, board, shared labels, integration, and all fault lanes.
Do not push or change a mutation setting or threshold.
Do not start mutation or timing; the lead runs those alone.
Do not edit shared Jev labels; report flags for the lead to judge together.

Migrate existing public behavior tests instead of adding duplicate cases.
Delete only tests whose sole promise is legacy compatibility or precedence.
Keep their useful behavior checks under the object form.
Do not replace `event.scope.resolve` with `event.resolve` blindly:
the first can enter root resolve middleware; the second bypasses it.
Keep scope and session payload handles when their behavior is needed.

Build first, then check and run the package and its consumer tests.
Core may report unmigrated consumers temporarily; name exact files.
Run strict style census, TSDoc, and advisory checks on changed units.
Do not fix old unrelated source or tests just to clear advisory notes.

## Proof

The source migration is saved and reviewed.
Core removes all six old type members and dispatch paths.
MCP, Hono, Stack, NATS, Sync, and Process use event hooks throughout.
The tracker and current MCP and Process examples use event hooks, too.
Already-migrated runtime code keeps its existing hook shape.

The literal audit checked 203 extension calls in 343 current source and doc files.
All 203 calls use a literal config; none declares a positional hook.
SCIP indexed all 14 packages after the build.
None references the six removed `Scope.Extension` methods.
Current docs describe only the event form.
Historical records and traceSink's constructor remain unchanged.

Frozen install, build, and code check pass, exit 0.
Code check: 0 errors and 28 existing warnings in 508 files.
Core size: 16,275 bytes gzip, below the 16,384-byte cap.
All 48 release lanes pass, exit 0.
Prose has 0 hits; the two edited package READMEs have no wide fenced lines.
Changed source TSDoc has 0 rows.
The source census has one unchanged Core S14 read: `panics[0]`.
No changed source line adds a strict census hit.

The first full test run failed two tracker child-start tests.
Release validation was rebuilding their package files in parallel.
Their helper hides child stderr, so the exact child error was not saved.
With package files stable, all five config tests pass, exit 0.
The final full test run finished before the size rebuild; all 18 tasks pass, exit 0.

The whole-range Jev review has 0 flags.
Core exceeds its file-size limit; the lead read the changed functions instead.
Three changed-unit flags were labelled false with reasons.
They describe root-owned Core bookkeeping, not state on a reusable definition.
The two existing judges were calibrated and their result was saved.
Writer test reviews found no new test-quality flags.
Old unrelated flags and helper-size notes stay outside this migration.

The start-log probe emits no sink lines before or after `event.next()`.
Removing old hooks does not fix `core/start-log`; that card still has work.
Proof: `/tmp/tinkered-hooks-start-log-probe.log`.

The shared fault queue is reserved for stack/t17's Hono and Stack lanes first.
The hooks gate ended only its own lock wait, PID 923144.
It requeues after `/home/paseo/.cache/tinkered-briefs/t17-mutation.done` exists.
Remaining: final full gate, all 14 isolated fault lanes, and landing.

## Landed t17 impact before the merge

Upstream `870beab4` lands stack/t17 while the first fault gate runs.
Its Hono and Stack code shares the start-hook area changed here.
Keep t17's commit-before-answer behavior, close handling, and regression tests.
Migrate any positional declarations it adds or preserves to the event form.
Public `extension`, `Scope.Extension`, and `Scope.Hooks` still use one form.
Merge in a separate checkout so running fault lanes keep stable source files.
Hono and Stack need fresh normal tests and isolated fault scores on the merged code.
The final caller audit, build, check, consumer tests, and release lanes must rerun.
Other packages may reuse completed lanes only if their checked inputs and runtime dependencies match.

## Landed examples impact before the merge

Main `600992f7` splits the examples into 11 runnable projects.
Keep its project layout, exports, checks, and tests.
The MCP and Process examples share hook code changed here.
Merge both changes and migrate every current example to event hooks.
Use a separate checkout while the first fault gate runs.
The final build, code check, example tests, and caller audit must include these projects.
Package fault scores can carry forward only where package inputs and runtime dependencies match.

## Merged source review

Hono `d5c54a85` keeps t17's request-close behavior and tests.
Stack `12d3703f` keeps t17's server ownership and port-close behavior.
Compared with t17, their source and tests differ only in hook shape and wording.
The root scope read, cleanup order, and bound close handle stay the same.
Examples `c6899cde` keep all 11 projects byte-for-byte as main `600992f7`.
The lead read both package diffs and the example merge before integration.

The merged checkout passes frozen install, build, and code check, exit 0.
Code check: 0 errors and 28 existing warnings in 558 files.
All 28 test tasks pass; all 48 release lanes pass, exit 0.
Core size: 16,275 bytes gzip; cap: 16,384.
Prose: 0 hits in 167 files; changed-source TSDoc: 0 rows in 60 files.
The source census still finds only the unchanged Core `panics[0]` read.

The final literal audit scans 404 current source and doc files.
All 205 extension calls use literal configs with no positional hook or spread.
SCIP indexes all 14 packages and finds no reference to the six removed methods.
The merged review bank keeps all 1,842 unique cases from all three inputs.
No case is missing and no label changed during the union.
The full calibration run finishes with exit 0 and its result is saved.

The other 12 packages have identical source, test, config, and built module files.
Their runtime dependencies do not use Hono or Stack in a fault lane.
External lock entries also match; only project entries change.
Hono and Stack are queued for fresh isolated fault scores on this merged code.
Proof files: `/tmp/tinkered-hooks-land-package-input-comparison.json` and
`/tmp/tinkered-hooks-land-frozen-inputs.json`.

## First ticket gate completed

The full ticket gate finishes with exit 0 at checkpoint `67444b81`.
All 14 package fault scores pass the floor of 85.
Core is 85.80; the first Stack run is 86.04.
All 707 frozen inputs match after the lanes finish and restore their files.
The lead checked every score; the helper's best-effort fallback was not used.
The merged Hono and Stack reruns are still waiting on the shared lock.
Proof: `/tmp/tinkered-hooks-ticket-gate.log`.

## Final merged gate completed

Both fresh fault lanes finish with exit 0 under the same shared lock.
Hono is 91.38; Stack is 86.00; both pass the floor of 85.
The other 12 packages reuse their completed scores with identical inputs and built modules.
All 777 merged inputs still match after the fresh lanes finish.
All 14 final scores and counts are saved in [hook-fault-proof.json](hook-fault-proof.json).
Source checkpoint: `87280748`; first ticket checkpoint: `67444b81`.
The final code review has 0 flags and the full calibration result is saved.
There are no open source conflicts or legacy hook declarations.

Final observed logs:

- `/tmp/tinkered-hooks-ticket-gate.log`
- `/tmp/tinkered-hooks-land-fault-gate.log`
- `/tmp/tinkered-hooks-land-final-build.log`
- `/tmp/tinkered-hooks-land-final-check.log`
- `/tmp/tinkered-hooks-land-final-tests.log`
- `/tmp/tinkered-hooks-land-final-prose.log`
- `/tmp/tinkered-hooks-land-final-size.log`
- `/tmp/tinkered-hooks-land-final-validate.log`
- `/tmp/tinkered-hooks-land-final-review.log`
- `/tmp/tinkered-hooks-land-calibration.log`

## Main verification

Main fast-forwards to checked checkpoint `debbc428`.
The lead keeps all local review notes and adds only the owned hook card to the board.
Main's fresh frozen install, build, check, all 28 test tasks, prose, and size finish with exit 0.
Code check: 0 errors and 28 existing warnings in 558 files.
Core remains 16,275 bytes gzip at the 16,384-byte cap.
The final tag is `core/tauthoring-hooks`.
The card moves from Review to Done after this proof is observed.
Main logs are `/tmp/tinkered-hooks-main-{install,build,check,tests,prose,size}.log`.

## Landed t18 impact before the merge

Remote main `23f0ccce` lands stack/t18 before the hooks push.
Keep its root signal and exit-code behavior and all new regression tests.
Its public `runUntilStop` removal stays; the tracker uses `createScope({ signal })`.
Merge in a private checkout and convert any new flat hooks to event hooks.
Stack source and tests need fresh normal checks and an isolated fault score.
Other package scores may carry forward only when inputs and runtime modules match.
The final build, check, consumer tests, prose, caller audit, and release lanes must rerun.

## t18 merged source review and normal checks

Source checkpoint `7782bf97` keeps t18's root signal and exit-code behavior.
The tracker root matches remote main `23f0ccce` byte-for-byte.
Stack's new exit helper, export, README, and telemetry tests also match main.
The lead read the merged tests and the package diff against main.
Their remaining changes use event hooks and keep each hook's reads and order.
All t18 behavior checks remain; three added hooks use the event form.

Frozen install, build, check, all 28 test tasks, and prose pass, exit 0.
Stack has 114 passing tests; Hono has 86; the tracker has 79.
Code check has 0 errors and 28 existing warnings in 558 files.
All 48 deterministic release lanes pass, exit 0.
Core is 16,275 bytes gzip at the 16,384-byte cap.
The final scan finds 207 extension calls across 404 current source and doc files.
Every config is a literal with no positional hook or spread.
SCIP indexes all 14 packages with no failed index.
It finds no removed extension method or `runUntilStop` reference.
Changed source TSDoc has 0 rows in 13 files.
The only strict source census hit remains Core's unchanged `panics[0]` read.
The whole-range review has 0 flags; no new labels or calibration inputs changed.

All 13 other packages keep their checked source, tests, config, and built modules.
No package fault lane imports Stack; only the tracker app uses it.
The complete lock file matches the earlier merged checkout.
All 777 final code inputs are frozen before the fresh Stack fault lane.
The new fault gate runs alone under `/tmp/mutation.lock` with cache off.
Normal logs are `/tmp/tinkered-hooks-t18-{install,build,check,tests,prose,size,validate}.log`.
Input proof is `/tmp/tinkered-hooks-t18-package-input-comparison.json`.

## Drizzle correction: impact before code

The user rejected the public `drizzleStore({ open, close })` frame on 2026-10-01.
The earlier review accepted it as a graph builder; that finding was too broad.
A database is a static resource; namespaces bind its settings and select instances.
The resource API must be the declaration itself, not a frame hiding that resource.
Declare the database config tag, database resource, and transaction resource directly.
Keep native database and transaction handles; do not wrap the client.

Remove public `drizzleStore` and `DrizzleStore.Frame`, `Tools`, `Tx`, and `Logger`.
The package keeps two adapters used inside resource factories:
`createQueryLogger(ctx)` and `openTransaction(db, ctx)`.
`QueryLogger.Handle` names Drizzle's logger shape.
`Transaction.Database` names the native callback transaction requirement.
`Transaction.Handle<DB>` keeps the exact native transaction type.
These helpers do not create graph nodes or own a scope.
The resource ctx owns the transaction outcome and its cleanup as before.

Keep commit-before-answer, rollback, failed begin and commit, cleanup, SQL logs,
borrowed-client ownership, lazy database setup, and all tenant and root isolation.
Scope sharing remains an explicit resource target choice.
Namespace instances use `target: "namespace"`; each transaction uses `"session"`.
Do not add an empty extension or change Core to implement this correction.

Current callers: Drizzle tests, Hono transaction tests, Stack live tests,
the tracker store and its imports, and the standalone Drizzle example.
Check all public refs before code and again at review with `scripts/scip.sh`.
Update current READMEs, authoring guidance, glossary, and the prior review finding.
Keep historical decisions unchanged; a new decision records this API correction.
One package per writer; lead owns docs and integration.
Drizzle, Hono, and Stack need fresh isolated fault lanes after their tests change.
Other scores carry only where inputs and runtime dependencies still match.

The pending t18 Stack fault waiter is no longer the final source to verify.
The lead ended only its own waiter, PID 1258701, before it acquired the lock.
Its foreground session ended with exit 143; no other lane was stopped.
The new combined source requeues after the resource API and callers are checked.

## Static Drizzle resource review and normal proof

Drizzle now exports only logger and transaction adapters, plus their types.
The public frame builder and all current imports are gone.
Drizzle, Hono, Stack, the tracker, and the example declare resources directly.
Database factories keep native handles and register cleanup before setup work.
Namespace targets select instances; session targets own transaction outcomes.
The Stack and Hono fixtures explicitly borrow a scope-shared client.
Their test owner still closes that client.
The tracker uses lazy SDK imports and a namespace database resource.
The example uses a static namespace and prints `ada` on repeated fresh roots.

The lead read each source and caller diff and kept all existing behavior checks.
Drizzle's new failed-begin test fails without the helper API and passes with it.
Its 26 tests pass; Hono has 86, Stack 114, and the tracker 79.
The full build, code check, and all 28 test tasks pass, exit 0.
The tracker browser helper has 7 passing tests under its app config.
Code check has 0 errors and 28 existing warnings in 558 files.
Core remains 16,275 bytes gzip, below its 16,384-byte cap.
Prose has 0 hits; all 48 deterministic release lanes pass, exit 0.
The release bundle check now checks the two helpers, not the removed frame export.
Hono and Stack README examples pass the database resource directly.

The final scan finds 207 literal extension calls in 404 current files.
No call uses a positional hook or spread config.
SCIP indexes all 14 packages and finds no removed hook, frame, or stop helper ref.
The source scan finds no `drizzleStore` or `DrizzleStore` in current code or guides.
Blueprint's `store.tx` fixtures test dotted symbol names; they are not Drizzle calls.
Changed source has no new strict census hit and valid TSDoc.
The unchanged Core and tracker census rows remain outside this task.
The whole-range review flags the tracker's intended public resource exports.
The lead labels that flag false, along with two finite-work cleanup notes.
The calibration run includes all three labels and preserves the existing bank.

All 777 final code inputs are frozen before the fault lanes.
The other 11 packages keep identical checked inputs and built modules.
None of their source or tests imports Drizzle, Hono, or Stack.
The complete dependency lock matches the earlier checked tree.
Run Drizzle, Hono, then Stack alone under `/tmp/mutation.lock`, cache off.
Remaining: observe all three scores, verify main, and push.
Normal proof logs are `/tmp/tinkered-hooks-resource-*.log`.
Input proof is `/tmp/tinkered-hooks-resource-package-input-comparison.json`.

## Final resource fault proof and landing

The combined fault gate finishes with `RESOURCE_FAULT_EXIT 0`.
It runs alone under `/tmp/mutation.lock`, with task cache off.
All three fresh scores pass the unchanged floor of 85:

- Drizzle: 96.77.
- Hono: 93.01.
- Stack: 85.91.

All 777 code inputs still match after the runs.
The other 11 package scores carry from identical checked inputs and built modules.
All 14 final scores pass; [hook-fault-proof.json](hook-fault-proof.json) records the proof.
The input hashes now name their exact encoding.
The dependency lock is unchanged; its external-section hash uses raw lock bytes.

The calibration run finishes with exit 0 and saves its result.
All 1,842 earlier bank rows are preserved; the three new labels make 1,845.
Changed-source strict census passes; TSDoc has 0 rows in 8 files.
Main's fresh install, build, code check, and prose pass, exit 0.
Its 777 code inputs match the full test and fault checked source.
The later upstream board-only commit `a94dce47` is merged without source changes.
The lead preserves every unrelated local review note and changes only the owned card.
The final publication uses `core/tauthoring-hooks`.
The start-log probe still drops its lines; `core/start-log` remains separate work.
