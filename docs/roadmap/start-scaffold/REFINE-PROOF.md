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
