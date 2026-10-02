# Public and private pages through sync

Read the [fixed writer brief](../contributor-brief.md),
[proof brief](POC-BRIEF.md), [current graph](DESIGN.md),
and [accepted execution model](STATE-SYNC.md).
Apply the coding-convention skill and the installed Start guides.

## Target and owners

Work in `/tmp/tinkered-start-poc` on the existing `start/poc` branch.
Change only `apps/start-scaffold` source, app tests, app config, and migration files.
The lead owns shared docs, the board, source preview, drawing, and registry packaging.
Do not edit the app's registry files or scripts; the lead will package final source.
No dependency, lockfile, Core, React, other app, or shared judge-label changes.
Do not push, merge, or run release and mutation lanes for this proof app.
Keep the live app preview running; test with the existing native Start boundary.

The main tree has a concurrent Core testing-entry change.
Its app backend test already imports preset from `@tinker/core/testing`.
Keep that public testing import compatible when the lead copies source back.
Tell the lead if your old worktree Core needs a public-entry compatibility adjustment.

## What ships

- A public page with a shared counter, readable and mutable without signing in.
  Do not publish profile details, email, or private todo records there.
- Better Auth sign-up, sign-in, sign-out, email check, and reset mail remain wired.
- A protected profile page and private todo page.
  Every private read and write enforces currentUser on the server.
  Owner IDs come from that resource, never client input.
  The todo name display and the profile editor read the same saved profile.
- Public and private features share the execution receipt and change-event model.
  Each write returns an execution ID or an early managed failure.
  Saved records change only through sync application, including bootstrap.
  A waiting operation ends only after the final result and its changes are applied.
- Profile save also attempts a notification after commit.
  Complete means saved plus notification accepted.
  Failed notification yields partial with a usable saved profile ID and named failure.
  Retry targets the failed notification, preserving the save.

## Transport and event history

For this proof, use direct Start server functions for bootstrap and change polling.
Use Core's clock and signals for the polling lifetime, never a bare interval helper.
Polling gives remote updates and replay without another library or service.
Keep transport in fixed setup so a later push transport can keep feature code.
Do not add SSE or a queue just to implement this slice.

Store committed changes and their events in the same database transaction.
Store final results too, including partial and no-change results.
Never publish an uncommitted change or erase a successful commit on failed mail.
Event order must remain correct across concurrent commits.
Use a transactional per-stream counter or equivalent safe database ordering.
Do not rely on sequence allocation order being commit order.
Bootstrap and its cursor must describe one consistent database view.
Replay must neither repeat effects nor revert data to an older revision.
Private stream reads and cursors must be account-authorized, including direct calls.
Recheck private auth at each polling request; no long-lived cached permission claim.

Remember events that arrive before a mutation receipt.
Separate event order from execution ID; one execution can have several events.
Apply change batches before exposing final results to local waiters.
Reconnect recovers missed changes and results rather than declaring a save failed.
Closing local work never claims to undo a committed server execution.
Stop waits and polling on sign-out, tab exit, and account change.
Ignore late responses from an old account.
Keep dirty editor text during remote changes.

## Lean files and graph ownership

Put fixed lifetime, request bridge, transport sync, and execution waits under
`src/scaffold/`, with backend and frontend subfolders when needed.
Keep app records, database resource, tables, migrations, input readers,
feature operations, cells, and views in existing userland folders.
Keep framework entry filenames where Start expects them.
Entries may be small composition files pointing at fixed setup and app units.
Do not create a second framework or a generic feature builder.
Do not pass a scope or context object through feature code or views.
Only entries and host extensions create roots, sessions, and their stop signals.
Middleware remains extension-owned, native-context-bound, deduplicated, and fail-fast.
Do not replace it with AsyncLocalStorage or a module-level current scope.

Resources own reusable clients and shared coordination for their lifetime.
Operations own actions; input readers supply inferred input and ctx types.
Data owns mutable records, drafts, and discriminated action states.
Tags supply fixed settings, not changing state.
Resource-held controllers may publish to their owner when call signals create child state.
Confirm this behavior against Core; do not hide scope access in a helper.
No inline type imports or forced ctx/input annotations in new feature code.
Lazy-load native service libraries inside the resource or action that uses them.
Keep SSR HTML and first browser render equal, without an effect-driven empty page.
Route loader results bootstrap shared data; views must not keep a second writable copy.
Use shadcn style with small type and a lean layout.

## Proof

First send the lead a concrete file split and event/result shape, then implement.
The user has approved this work; no further confirmation is needed within this target.
Add only tests for distinct public promises through exported operations and scopes.
No Start stack is needed for the domain seam tests.
Use real database and Better Auth behavior, with a behaving mail preset for failed send.
Prove public writes and replay, private cross-account refusal,
event-before-receipt, partial mail, and late-response/account exit behavior.
Keep the existing native middleware, import guard, cold imports, and observation proof.
The lead will perform two-tab remote sync, auth, and source-preview browser checks.

Run build before check, the useful app and native boundary tests,
strict authored census, TSDoc, and advisory Jev.
Skip generated routeTree.gen.ts in the authored census.
Commit explicit app paths after checks.
Report final files, gate exits, public seam results, and any Core friction.
