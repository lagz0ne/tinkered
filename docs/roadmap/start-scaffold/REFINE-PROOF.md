# Start refine proof

Writer: branch `start/refine`.
Worktree: `../tinkered-start-refine`.
Base: `314c64ec`.
The lead owns the board and landing.

## Waste counts

The scope tests call the exported operations.
They count session spans and snapshot source calls.
No timing is used.

Before the fix, all three tests fail, exit 1.
Log: `/tmp/start-refine-waste-red.log`.

- Session checks: 9; expected 2.
- Signed-out redirect loads: 2; expected 1.
- Sign-in and route loads: 3; expected 1.

After the fix, all 33 app tests pass, exit 0.
Log: `/tmp/start-refine-part1-tests.log`.
The same three counts are 2, 1, and 1.

The stream checks auth at open, each wake, and each heartbeat.
One tab shares its loaded snapshot until account exit.
Auth holds reconnects until its cookie is set.
Old account events keep their old version and are ignored.

## Assumptions

- A route can reuse saved records after its server account check.
  Account exit starts a new snapshot lifetime.
- The writer records proof here and leaves the board to the lead.
  The brief bars edits outside the app, track, and lockfile.

## Copied project

App source no longer imports the Core testing entry.
The test presets live in `tests/presets.ts`.
The registry ships scope tests, test config, and project gates.
Maintainer proofs live in `maintain/` and are not copied.
The starter includes all five app skills and `AGENTS.md`.
The owner README gives local start, layout, rules, and checks.

The generated `starter.package.json` resolves workspace catalog values.
It keeps the app's test exports and drops maintainer scripts.
A Vite override supplies the same Vite+ alias to npm peers.
The pnpm shorthand for the React plugin becomes a plain npm range.
No peer check is disabled.

Build, check, 33 app tests, prose, and note types pass.
`vp check` has zero errors and the same 28 warnings.
Native middleware proof also passes with test-only preset wiring.
Logs use `/tmp/start-refine-part2-` and `/tmp/start-refine-part3-`.

## Local service assumptions

- Empty SMTP user and password mean no SMTP auth.
  This lets the same mail resource work with local Mailpit.
- Local sample ports avoid the existing Victoria processes.
  Traces use 11428 and logs use 19428 on the host.
- Docker runs outside this worktree's network.
  The proof app runs beside the services in a fresh browser container.
  The project compose ports remain on loopback.
- The local proof uses the sample secret and its own test accounts.
  A project owner must replace that secret before real use.

## A redirect before a tab exists

The first redirect test shared one scope.
A fresh server visit can use a separate scope for the public render.
The stronger test uses two render scopes.
Its old account check loaded a snapshot before redirecting.
It failed with 2 loads, expected 1, exit 1.
Log: `/tmp/start-refine-render-red.log`.

Private routes now call `context.account()` before bootstrap.
A signed-out account redirects without a snapshot.
The public page loads the single snapshot it needs.
A signed-in route still bootstraps its saved records.
That version reused the cached account in later guards.
The fix round below replaces that check with a server read.
All 33 app tests pass, exit 0.
Log: `/tmp/start-refine-render-green.log`.

The changed callers are `profile.tsx`, `todos.tsx`,
`__root.tsx`, the fixed router context, and scope tests.
All paths are under `apps/start-scaffold`.

## Reconnect during sign-in

The sign-in test now holds the real auth reply.
A route load and reconnect start while that reply is held.
The old barrier released before the sign-in snapshot was applied.
The test failed with 2 loads, expected 1, exit 1.
Log: `/tmp/start-refine-auth-race-red.log`.

The auth owner now loads its snapshot before releasing the barrier.
Waiting routes and reconnects then see the applied snapshot.
Bootstrap returns its applied owner version to the snapshot owner.
A later account exit cannot mark its new lifetime as already loaded.
The caller changes are sign-in, the snapshot owner, and bootstrap.
Router hydration and existing tests still await bootstrap.
The snapshot owner uses its returned version.
All 33 app tests pass, exit 0.
Log: `/tmp/start-refine-auth-race-green.log`.

## Final observed proof

The final gate chain returns 0 after the auth race fix.
All 33 app tests pass within all workspace test tasks.
Check has zero errors and the same 28 warnings.
All 16 validate lanes pass.
[Every gate, exit code, and log path](REFINE-GATES.json).

The real shadcn 4.21.0 copies 109 files into a fresh consumer.
Core and React are packed tarballs installed with npm.
Neither installed package links to the workspace.
Install, build, types, 33 tests, seam, browser imports,
and schema generation each return 0.
Both edited seams and a feature survive a runtime update.
All five skills and `AGENTS.md` are present.
No maintainer file or proof mode is copied.
[Consumer proof and all step logs](REFINE-CONSUMER.json).

The compose browser visits `/profile` while signed out.
It redirects to `/`, then signs up through real auth.
It saves a todo through real Postgres and sees it after reload.
It saves a profile and receives a complete mail result.
Mailpit's API and browser inbox both show the profile mail.
The inbox also shows the signup email check.
There are zero page errors and no phone overflow.
The built host exits 0 on SIGTERM.
[Mailpit message IDs and results](REFINE-COMPOSE.json).
The temporary browser container and owned compose stack are removed.
The existing local Victoria processes were left alone.

## Style and advisory checks

Strict census of authored source and scope tests returns 0.
Log: `/tmp/start-refine-census-authored.log`.
TSDoc parses 24 changed files with zero rows, exit 0.
Log: `/tmp/start-refine-tsdoc.log`.

The raw folder scan returns 1.
Log: `/tmp/start-refine-census-raw.log`.
Its hits are the generated router's comments and lint marker,
and two test-only preset calls in `tests/presets.ts`.
The strict authored scan excludes that generated file and test fixture.
App source imports no Core testing entry.
This is a scope assumption for the census, not a changed lint rule.

Jev tests has zero flags across 33 tests.
Jev promises has zero missing README lines and one unsure match.
Two missing close promises were added to the owner README.
The final preflight has one file flag and ten flagged units.
Each is explained and labeled false.
They name owned clients, transport state, native cleanup,
or repeated execution work that is promised to be a no-op.
[Exact label states and reasons](REFINE-JEV.jsonl).
Log: `/tmp/start-refine-jev-labels-final.log`.

Labels stay in this track because shared-tool edits are barred.
The label tool ignored its bank override on a normal write.
Only its added rows were moved here; the shared bank was restored.
The lead merges new rows and runs calibration at landing.
No shared judge rule or Core/React source changed.

## Core type feedback

A sync factory depending on async resources failed with `TS2322`.
That made its callers see an unknown value too.
The attempted shape was:

```ts
const snapshotLoader = resource({
  label: "sync.snapshotLoader",
  depends: {
    sync: syncClient,
    apply: applyBootstrap,
    source: snapshotSource,
  },
  factory: ({ sync }) => ({
    snapshot: () => sync.snapshot(),
  }),
});
```

Making the factory async fixed it.
The filled snippet was run again in a temporary file.
It fails with `TS2322`, exit 1.
Log: `/tmp/start-refine-core-feedback-red.log`.
The temporary file was removed after that check.
No Core change was needed.

## Other proof assumptions

- shadcn starts from its normal components config and type config.
  The consumer script creates them and installs the tarballs itself.
  It uses `@/app-lib` to prove seam import rewriting.
- The waste test uses signup in the shared sign-in action.
  Both auth modes use the same snapshot owner and barrier.
  Existing backend scope tests also exercise actual sign-in.
- Native middleware proof injects presets only in its temporary copy.
  The app entry and installed consumer use Postgres and SMTP.
- Project type and test scripts keep this app's self-package exports.
  A later package rename must update those test import paths.
- Mutation and timing lanes were not requested by this ticket.
  This work claims counts, not speed or size changes.
- The lead owns board changes, review, calibration, and landing.
  The writer did not push or publish.

## Lead fix round at afa2cf83

Private route guards always ask `snapshotSource.account`.
A changed account calls `sync.leave()` before returning.
This clears private records, cancels waits, and ends snapshot reuse.
An unchanged account keeps the same loaded snapshot.
The callers are `checkAccount`, the fixed router context,
and the guards in `src/routes/profile.tsx` and `src/routes/todos.tsx`.
These paths are under `apps/start-scaffold`.

### Stale route guard: red then green

The new scope test signs Ada up through `handleAuth`.
The browser snapshot source reads the server with a mutable cookie.
It loads Ada, then another tab signs Ada out and clears that cookie.
On `afa2cf83`, the guard still returns Ada's ID.
Red exit 1: `/tmp/start-refine-review-account-red.log`.
The failing assertion is at `tests/waste.test.ts:237`:

```ts
expect(await browser.run(checkAccount)).toBeNull();
```

After the fix, it returns null and clears cached private records.
The next load returns a fresh signed-out snapshot.
All 4 waste tests pass, exit 0.
Green: `/tmp/start-refine-review-account-green.log`.
The original session and snapshot counts remain 2, 1, and 1.
The README now promises server account checks before snapshot reuse.

### Quiet stream: red then green

The new SSE test uses Core's `makeTestClock`.
It opens Ada's private stream and reads the connected frame.
It signs Ada out without changing saved app data.
At 10 seconds it expects account-change, then done.

The first version passed even without the heartbeat auth check.
Sign-out wakes the stream through `sync_session_changed`.
That wake hid the missing heartbeat check.
Control log: `/tmp/start-refine-review-heartbeat-control.log`.

Assumption: heartbeat auth is the fallback when no session wake arrives.
The test drops only that trigger in its own PGlite database.
It keeps real auth, SQL, stream delivery, and Core time.
Production triggers are unchanged.

Removing the heartbeat auth clause now fails, exit 1.
Red: `/tmp/start-refine-review-heartbeat-red.log`.
At `tests/sse.test.ts:343`, it gets `: heartbeat` instead of:

```text
event: account
data: {"kind":"account-change"}
```

The failing assertion is:

```ts
expect(new TextDecoder().decode((await waiting).value)).toBe(
  'event: account\ndata: {"kind":"account-change"}\n\n',
);
```

The original clause was restored before the green run.
All 5 SSE tests pass, exit 0.
Green: `/tmp/start-refine-review-heartbeat-green.log`.

### Skills and copied files

The four changed skills name the fixed exports and their real paths.
They teach `eventHistory.lock`, `find`, and `append` in one transaction.
They name backend and frontend export files for scope tests.
They show the account check before private route bootstrap.
They keep reconnects held until a sign-in snapshot is applied.
They say `proofMail` records sends and point to held/refused fixtures.
Registry payloads were rebuilt after these changes.

All 35 app tests pass in 8 files, exit 0.
Build and `vp check` pass with 0 errors and 28 warnings.
Workspace tests pass: 1,106 passed, 1 skipped.
All 16 budget lanes pass.
The seam proof, browser imports, schema, and prose checks pass.
Types, lazy imports, middleware, and note fixture checks also pass.
[Gate exit codes and exact logs](REFINE-GATES.json).
Review logs use `/tmp/start-refine-review-`.

The fresh shadcn consumer copied 109 files from all 3 items.
It used packed Core and React with an independent npm install.
It has no workspace link and passed all 35 shipped tests.
All 14 consumer steps passed, including build, types, and project checks.
[Fresh consumer results](REFINE-CONSUMER.json).
The compose files and mail path did not change in this fix round.
The earlier [Mailpit proof](REFINE-COMPOSE.json) remains recorded above.

Assumption: the existing census scope still applies.
It excludes the generated route tree and the test preset fixture.
Strict authored census and changed TSDoc pass.
The repeated raw folder scan exits 1 with only those excluded files.
Log: `/tmp/start-refine-review-raw-folder-census.log`.
No Core/React change, shared-tool edit, push, or publish was needed.

The full `main..HEAD` Jev preflight has one file flag
and eleven flagged units; all are explained and labeled false.
Two labels were added for the current snapshot owner and stream queue.
Labels remain in this track under the brief's path limit.
The lead merges them and runs calibration at landing.
Jev tests has zero flags across 35 entries.
Jev promises has zero missing README lines and one unsure match.
Log: `/tmp/start-refine-review-jev-labels.log`.
No new Core feedback came from this fix round.
