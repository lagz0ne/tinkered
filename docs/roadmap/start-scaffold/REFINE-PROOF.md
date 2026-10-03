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

- A route can reuse the tab's saved records while SSE updates them.
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
The tab's loaded records can answer later account guards.
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
