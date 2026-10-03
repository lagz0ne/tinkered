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
