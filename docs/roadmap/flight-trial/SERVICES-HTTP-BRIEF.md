# Services HTTP brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read ADR 0100, 0102, and 0103.

## Goal

The trial services send outgoing HTTP the ADR 0102 way:
a backend tag over built-in fetch, a resource that owns requests in flight,
and one request operation per call, so each send is a span.

## Today

`services/payment/index.ts:145` sends each webhook with a bare `fetch`
inside a resource method. No span; a graceful close does not abort it;
the raw status is stored (`:187-197`).

## Do

1. Add `services/http-client.ts` with the three units of ADR 0102
   (`httpBackend` tag, `http` resource that aborts on close,
   `httpRequest` operation with a `http <METHOD> <path>` child span).
   Copy the scaffold's shape; no import from `apps/`.
2. `sendWebhook` depends on `httpRequest.controller` and runs it once per copy.
   It maps the reply to `delivered`, `rejected`, or `unreachable` before
   recording it (ADR 0103: callers see domain values, not statuses).
3. A fetch ban for `tools/flight-trial/services/`: a script or test that fails
   on built-in fetch outside `http-client.ts`. A planted case.
4. Tests: a graceful close aborts a webhook in flight (red before the fix);
   the span `http POST /webhooks/stripe` sits under the webhook operation;
   tests bind `httpBackend`, never patch the global.
5. The wire contract stays: rerun `scripts/check-wire.mjs`, zero differences.

## Proof, all by exit code

Red then green per test; wire diff 0; four-process proof; mutation 85 or more
alone under `flock /tmp/mutation.lock`; build, `vp check`, all tests, prose, validate.

## Limits

- Change only `tools/flight-trial/services/`, `tools/flight-trial/tests/`,
  `tools/flight-trial/scripts/`, and `docs/roadmap/flight-trial/`.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
