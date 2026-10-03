# Flight services brief

Owner: lead (Claude, Start scaffold session); Sol services writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0097 and ADR 0098; this ticket builds ADR 0098.

## Goal

The trial app talks to fake third parties over real HTTP.
Each fake is its own Tinker app, in its own scope and process.
Its state is Core data, filled from `tools/flight-trial/data`.
The grader drives it only through its control API.

## Where

`tools/flight-trial/services/`, in the `flight-trial` package.

- `supplier/`: one app, started three times as A, B, and C.
- `payment/`: one app, shaped like Stripe.
- `compose.yml` in `tools/flight-trial/`: Postgres and Mailpit.
- One start script runs the four service processes.

Use `node:http` or Hono for HTTP; nothing else heavy.

## Supplier API (Duffel-shaped)

Follow Duffel's public API names and JSON shapes, smaller:

```text
POST /air/offer_requests   -> offers for one slice
GET  /air/offers/:id       -> current price and seats
POST /air/orders           -> instant or hold order
GET  /air/orders/:id
POST /air/payments         -> pay a hold order
```

- A hold order has `payment_required_by`.
  After that time it expires and frees its seats.
- An order takes seats from that flight and cabin.
  The last seat goes to one order; the other gets an error.
- An offer can go stale: price changed or sold out.
- Errors use Duffel's `{ errors: [{ type, code, title }] }` shape.

## Payment API (Stripe-shaped)

```text
POST /v1/payment_intents
POST /v1/payment_intents/:id/confirm
GET  /v1/payment_intents/:id
POST /v1/refunds
```

- Respect the `Idempotency-Key` header.
- Confirm returns `processing`.
  The result comes later as a webhook:
  `payment_intent.succeeded` or `payment_intent.payment_failed`.
- Sign each webhook with a `Stripe-Signature` header:
  `t=<unix>,v1=<HMAC-SHA256 of "t.body">` and a shared secret.
- Webhooks go to a URL set at start.
  A watcher on the intent data sends them.

## Control API (grader only)

Separate from the service API: its own path prefix and a token.
Each call writes the service's own data or clock.

- Start a named scenario (a `preset` set of data).
- Set delay, failure, or a repeat for one route.
- Set a flight's price or seats.
- Payment: choose the outcome; send a webhook now, late, twice, or never.
- Move the service clock forward.
- Read the call log: route, time, status.
  The grader counts calls from this log to catch waste.

## Clocks

Each service owns its clock.
Real time by default; the control API can switch to a test clock and move it.

## Proof, all by exit code

1. Tests start each service on a free port and use only HTTP.
   They call the service API and the control API, never internals.
2. Supplier: search returns data offers; the same flight appears at A and B;
   the last seat goes to one of two parallel orders;
   a hold expires after its time and frees the seat.
3. Payment: a confirmed intent sends a signed webhook;
   the signature checks out; a repeated key returns the same intent;
   "late" and "twice" send as asked.
4. Control: delay, failure, and the call log work.
5. `compose up` starts Postgres and Mailpit; the start script runs all four services.
6. Workspace build, `vp check`, package tests, prose, and `pnpm validate` pass.

## Limits

- Work only in this worktree; commit per step.
- Change only `tools/flight-trial/`, `docs/roadmap/flight-trial/`, and the lockfile.
- Do not change Core, React, or `apps/`.
- Do not use `git stash`.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
