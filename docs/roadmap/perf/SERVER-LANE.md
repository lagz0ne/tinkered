# Start server lane

Owner: Codex writer on `start/server-lane`.
Base: `5d9c0537`, the fetched main at the start.
Full raw logs: `/home/paseo/.cache/server-lane-proof/`.
No push or publish.

## Assumptions

- Start options are process settings, read once.
  This follows the report's R3 plan.
  ADR 0106 stays frozen under the writing rules.
- Keep Core external; Start body code needs its own server chunk.
- The build is fixed for a host's lifetime.

## start/request-hops

- Retain startup state and the server observer after the first read.
- Read the app options once; build the CSRF middleware once.
- Resolve the sync router after `ready` without a promise chain.
- Start root close at once; keep its promise for repeated close calls.
- Sync factories and the auth pass-through return their work as is.
- R15 joins the static-file ticket, which owns that same path.
- Census: Start promises per page 73.57 → 51.34.
  Router 21 → 6; server entry 10 → 5; options 2 → 0.
  The body ticket removes the next layer; final target remains 45.
- Page load A/B: **no difference we can see**.
  The run includes request hops and the one-body change.
  Keep the promise drop; no page speed gain is claimed.
- Final check: exit 0, 0 errors, 27 warnings, the same count as main.
- Start tests: 437 pass, exit 0.
  Five early sync time limits passed when rerun.
- Focused server tests: 14 pass, exit 0.
- Jev: every request flag has a false label with its reason.

## start/one-body-hold

- The request session now owns the render close through its end hook.
  A weak map joins the exact Start request to that hook.
  A response has one held stream, including an empty response.
- A body hold with a body returns its response without a promise.
- Census: body promises 25 → 12 per page.
  The hold probe counts streams 2 → 1 and responses 2 → 1 per page.
  Total Start promises are 34.51, below the ceiling of 45.
- The three end, cancel, and read-error cases wait for both closes.
- Focused server and request tests: 21 pass, exit 0.
- App build and check: exit 0; check has 0 errors and 27 warnings.
- Jev: body flags have false labels with their reasons.

## start/browser-table

- Prepare writes `.tinker/telemetry-env.ts` from the one metadata table.
- Telemetry reads that small file through an alias.
  The browser no longer imports all of `package.json` for settings.
- Client chunks have zero `AUTH_SECRET` names or full tinker tables.
- Generated-file test and telemetry tests pass.
  The static, compression, prepare, glue, and telemetry run has 75 passes.
- Jev: the settings flag has a false label; env already supplies deployment values.

## start/serve-static-memory

- Build a URL table at host startup, including page directory aliases.
- First use reads built bytes once; warm hits use the retained bytes.
  Concurrent first reads share their work; failed reads leave no kept promise.
- Retain at most 64 MiB; larger builds may still read files after the cap.
- A warm hit returns a response without a promise.
  The CLI passes a static hit or a miss without an extra await.
- Cache 128 accepted-encoding headers and share request regular expressions.
- File resources per warm hit: 4 → 0 (three file calls plus one file handle).
- Final static A/B: **b is faster**, five paired runs.
  Raw verdict is in `static-final-ab.log`.
- Warm-file test fails on main after the files are removed; it passes here.
- Static and compression tests: 22 pass, exit 0.
- Check: exit 0, 0 errors, 27 warnings after updating plain sync callers.

## start/server-chunks

- Keep Core external in the server build, as a separate installed package.
- Give the body resource its own server chunk.
  Its three top-level bindings stay below 255.
  The other small Start entry chunks have at most 61 bindings.
- Bytecode for `hold` and Core's `$r` (`createScope`) has no wide context loads.
  Raw logs are `hold-bytecode.log` and `createScope-bytecode.log`.
- TanStack's large chunk still has 683 bindings; it is outside this ticket.
- App server JS plus the external Core files: 363,525 → 350,464 bytes.
  This falls 3.6%, beyond the report's expected one-percent band.
  External Core keeps its minified text instead of being printed into the app chunk.
- Wider forced groups broke namespace exports or created a module cycle.
  Those versions were dropped; the final built host passed the page census.
- Final census: Start makes 34.04 promises per page on the joined main.
  Body code makes 12; the Start average is below the target of 45.

## Final proof

- Joined main: `f360f870`; install, build, check, and all package tests exit 0.
- Start has 437 passing tests; the scaffold has 27 after the joined change.
- Prose: exit 0, zero hits.
- Validation: exit 0; all 19 deterministic budget lanes pass.
- Scaffold check: exit 0, including its host, browser, compose, and saved registry checks.
- A package-local settings fallback supports tests that import source files.
  App builds use the small generated table.
- The render cases use a real Core render root and request session.
  Each body result waits for both end hooks.
- SCIP lists every sync client, loader, and router reader in Start.
  Direct scaffold readers were checked too.
- Jev preflight and review: flags are labeled with reasons.
  The testing-entry flag names test exports; these are its stated purpose.
  Test judges flag zero entries; older private imports and large helpers stay outside this work.
  The lead runs label calibration when landing, as the board rules require.
- No Core feedback; no new public contract or ADR.
- Fault-test proof will be saved in `SERVER-LANE-MUTATION.txt`.
  The run names the final clean source commit; only its header and summary are saved.

## Request-hops impact

The sync client and loader now resolve to plain values.
The public names stay the same.
Direct callers stop awaiting those values; operation dependencies need no change.

- Base callers: `tests/sync-client.test.ts` and `tests/sync-tab.test.ts`.
- Scaffold callers: `tests/sync-client.test.ts`, `tests/sse.test.ts`, and `tests/waste.test.ts`.
  These six call-site edits cross the lane folder limit because the warning gate requires them.
  The scaffold check also rebuilt the two saved registry files with those same test edits.
- Scaffold dependency readers: `src/frontend/Counter.tsx`, `Todos.tsx`, `auth-actions.ts`, and `profile-actions.ts`.
  They use operation dependencies and keep their current code.
- Verify: base and scaffold tests, root check, and SCIP references.

## Limits

- Warm retained files make no file calls; first use and bytes beyond 64 MiB may read files.
- Static A/B says **b is faster**; page A/B says **no difference we can see**.
  No browser speed or whole-app capacity claim.
- No wider TanStack split or upstream chunk repair is claimed.
