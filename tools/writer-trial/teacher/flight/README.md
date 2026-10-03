# Flight teacher checks

Checks use only pages, the app's public HTTP routes,
and the supplier and payment control APIs.
They never import submitted code.
Run them in the harness's private network against the isolated app.
A failed setup fails the run.
Results print PASS, FAIL, ACCEPTANCE, and RESULTS_JSON.
Exit 0 means every named check passed.
Each round also runs every earlier round.

## Settings

Install `playwright` where this command can import it.
The harness's grading image supplies it and Chromium.
For the reference, the separate `.toolchain/` install supplies it.
`FLIGHT_PLAYWRIGHT_MODULE` can name its absolute `index.mjs` path.
`CHROMIUM_EXECUTABLE` can name an existing browser binary.
Both settings are optional in a grading image with Playwright installed.

Put these filled settings in the teacher's `grader.env`:

```text
APP_URL=http://127.0.0.1:4390
SUPPLIER_A_URL=http://127.0.0.1:4391
SUPPLIER_B_URL=http://127.0.0.1:4392
SUPPLIER_C_URL=http://127.0.0.1:4393
PAYMENT_URL=http://127.0.0.1:4394
CONTROL_TOKEN=flight-local-control
MAILPIT_URL=http://127.0.0.1:58025
WEBHOOK_SECRET=flight-reference-webhook-secret
```

Supplier and payment URLs serve both service and control paths.
The token stays with the teacher.
Set the service hold duration to at least 60,000 ms for browser setup.
The checks move the supplier clock to expire a hold.
No test needs to sleep through that duration.
The payment receiver is the app's `/webhooks/stripe` route.

## Commands

```bash
checks=tools/writer-trial/teacher/flight
node --env-file=grader.env "$checks/check.mjs" 1
node --env-file=grader.env "$checks/check.mjs" 2
node --env-file=grader.env "$checks/check.mjs" 3
node --env-file=grader.env "$checks/check.mjs" 4
node --env-file=grader.env "$checks/check.mjs" 5
```

Use the same settings for the reference proof:

```bash
checks=tools/writer-trial/teacher/flight
node --env-file=grader.env "$checks/canaries.mjs" 1
node --env-file=grader.env "$checks/canaries.mjs" 2
node --env-file=grader.env "$checks/canaries.mjs" 3
node --env-file=grader.env "$checks/canaries.mjs" 4
node --env-file=grader.env "$checks/canaries.mjs" 5
```

Each planted break must fail its named behavior.
A missing browser, page, or control API cannot prove a planted break.

## Mail failure proof

Round 5 needs Mailpit with `MP_ENABLE_CHAOS=true`.
Chaos means Mailpit can refuse a real SMTP send.
Its default failure chance stays zero.
The teacher uses `PUT /api/v1/chaos` to set and clear a sender failure.
It uses Mailpit inbox search and message reads to prove delivery.
A disabled Chaos API fails setup; it never counts as a planted failure.
See [Mailpit's Chaos guide](https://mailpit.axllent.org/docs/integration/chaos/).

The teacher needs no SMTP password.
Its WEBHOOK_SECRET must match the app and payment service.
It signs old events, changed-byte events, and fresh replays.
The app gets those settings from its own `.env`.
Only the service controls and Mailpit API are used to inject faults.

The harness also runs the scaffold checks on the submitted source.
That includes `check:plain`; page checks alone do not replace it.
The private reference runs the same committed check.
