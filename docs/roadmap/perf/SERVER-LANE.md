# Start server lane

Owner: Codex writer on `start/server-lane`.
Base: `5d9c0537`, the fetched main at the start.
Full raw logs: `/home/paseo/.cache/server-lane-proof/`.
No push or publish.

## Assumptions

- Start options are process settings, read once.
  This follows the report's R3 plan.
  ADR 0106 stays frozen under the writing rules.
- The linked Core and Start sources need their own server chunks.
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
- Check: exit 0, 0 errors, 59 warnings.
- Start tests: 427 pass; five sync stream tests time out.
  Both main and this branch pass all 39 sync tests alone.
  Full-run failures were time limits under load.
- Focused server tests: 14 pass, exit 0.
- Jev: every request flag has a false label with its reason.

## start/one-body-hold

- The request session now owns the render close through its end hook.
  A weak map joins the exact Start request to that hook.
  A response has one held stream, including an empty response.
- A body hold with a body returns its response without a promise.
- Census: body promises 25 → 12 per page.
  Total Start promises are 34.51, below the ceiling of 45.
- The three end, cancel, and read-error cases wait for both closes.
- Focused server and request tests: 21 pass, exit 0.
- App build and check: exit 0; check has 0 errors and 59 warnings.
- Jev: body flags have false labels with their reasons.

## start/browser-table

- Prepare writes `.tinker/telemetry-env.ts` from the one metadata table.
- Telemetry reads that small file through an alias.
  The browser no longer imports all of `package.json` for settings.
- Client chunks have zero `AUTH_SECRET` names or full tinker tables.
- Generated-file test and telemetry tests pass.
  The static, compression, prepare, glue, and telemetry run has 75 passes.
- Jev: the settings flag has a false label; env already supplies deployment values.
