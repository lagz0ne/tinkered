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
```

Use the same settings for the reference proof:

```bash
checks=tools/writer-trial/teacher/flight
node --env-file=grader.env "$checks/canaries.mjs" 1
node --env-file=grader.env "$checks/canaries.mjs" 2
node --env-file=grader.env "$checks/canaries.mjs" 3
node --env-file=grader.env "$checks/canaries.mjs" 4
```

Each planted break must fail its named behavior.
A missing browser, page, or control API cannot prove a planted break.

## Service reset issue

At the given services commit, scenario reset writes its state,
then returns HTTP 500 with `scenario_failed`.
Its short seed scope closes as cancelled before it was ready.
The reset does not clear route rules or call logs on this path.
The checks accept only that exact reset error.
They clear the routes they use and save a call-log position.
Call counts start at that position.
The later page and HTTP checks prove the changed service state.
Any other control error fails.
The lead can remove this allowance after the service fix lands.
