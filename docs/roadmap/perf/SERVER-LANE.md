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
- Page load A/B: pending in the queue.
- Check: exit 0, 0 errors, 59 warnings.
- Start tests: 427 pass; five sync stream tests time out.
  The pinned main run is checking those five failures.
- Focused server tests: 14 pass, exit 0.
- Jev: every request flag has a false label with its reason.
