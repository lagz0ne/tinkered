# One extension hook shape

Date: 2026-09-30.
Status: Done.
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
