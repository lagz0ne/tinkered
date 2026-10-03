# Flight integration proof

Branch: `trial/flight-integration`.
Main: `0da81a82`.
Status: the two-pass proof is complete; the Hono follow-up is next.

## Hono services follow-up

The rebase onto `0da81a82` exited 0.
Log: `tools/writer-trial/.logs/hono-rebase-continue-2.log`.
The services image rebuild and tar save exited 0.
Log: `tools/writer-trial/.logs/hono-services-image.log`.
The new services ID is
`sha256:daaf65a9b1d6bb8cc1d821a0e3deac56735b4480d57a8ac9bdc32b28b01542b7`.
One full gate per round is next, with `--once` and no planted breaks.

## Five rounds before Hono

PID 640336 finished with exit 0.
Log: `tools/writer-trial/.logs/resume-reference-trusted-final.log`.
Saved rows: [INTEGRATION-RESULTS.json](INTEGRATION-RESULTS.json).
The full saved-result check also exited 0:
`tools/writer-trial/.logs/takeover-reference-verified.log`.

Each round has `pass-1`, `pass-2`, and `break` under
`tools/writer-trial/.logs/reference-trusted-final/round-N/`.
Each folder has `result.json`, `own.log`, `teacher.log`,
`scaffold.log`, `plain.log`, and `jev.json`.

- Round 1: 0, 0, 1.
  Break: `r1 public search shows real fares and asks each active supplier once`.
- Round 2: 0, 0, 1.
  Break: `r2 a cheaper late fare merges and a failed supplier keeps good rows`.
- Round 3: 0, 0, 1.
  Break: `r3 a changed price is refused before any hold order`.
- Round 4: 0, 0, 1.
  Break: `r4 payment waits for a valid signed webhook and syncs across tabs`.
- Round 5: 0, 0, 1.
  Break: `r5 failed mail keeps the booking valid and retry sends once`.

All ten good runs passed own, teacher, scaffold, plain, and Jev checks.
The five broken runs failed their named browser checks.
The round 4 break also made TypeScript reject unused `timingSafeEqual`.
Its browser reached the forged event and failed the signature check.
The other four broken apps passed their own checks.
Every broken run passed scaffold, plain, and Jev checks.

## Workspace gates after the rebase

All log names below start at `tools/writer-trial/.logs/`.
The full chain is `takeover-final-gates.log`, exit 0.

- Install: 0, `final-install.log`.
- Build: 0, `final-build.log`.
- `vp check`: 0, `final-check.log`.
  Zero errors and 28 warnings.
- All package tests: 0, `final-tests.log`.
  All nine tasks pass.
- Harness tests: 0, `final-writer-tests.log`.
  All 79 tests pass.
- Prose: 0, `final-prose.log`.
- `pnpm validate`: 0, `final-validate.log`.
  All 16 lanes pass.
- Rebase: 0, `takeover-rebase-continue-3.log`.
  Earlier stops and their merge conflicts remain in the rebase logs.
- Jev preflight: 0, `takeover-jev-preflight.log`.
  No file flags; advice on 24 units was checked against saved labels.
- New Jev labels: 0, `takeover-jev-labels.log`.
  Six false labels explain unchanged starter code.
- Strict style census: 0, `takeover-style.log`.
- Scope and byte check: 0, `takeover-rebase-scope.log`.
  Main is an ancestor; proved trial files match their prior bytes.

## Image, stage, and isolation proof

These saved proofs use the final `.3` writer image.
Their log names also start at `tools/writer-trial/.logs/`.

- Image build and saved tars: 0, `resume-images-final-build.log`.
- Create: 0, `resume-ready-create.log`.
- Stage 1: 0, `resume-ready-stage-1.log`.
- Worker folder proof: 0, `resume-ready-workspace-proof.log`.
- Frozen files: 0, `resume-ready-frozen-proof.log`.
- Isolation: 0, `resume-final-isolation.log`.

The worker has the scaffold, five skills, shipped tests, and packet 1 only.
It has `SERVICES.md`, `PLAIN.md`, and `check:plain`.
It has no teacher files.
Internet, private controls, and writer Mailpit Chaos are refused.
Service APIs, Postgres, SMTP, and signed callbacks work.

Prepared trial: `flight-integration-ready-01`, staged at packet 1.
No model run started.
Manifest:
`/home/paseo/.local/share/tinker-writer-trial/flight-integration-ready-01/manifest.json`.

## Images and saved copies

Exact IDs and tar paths are in
[INTEGRATION-IMAGES.json](INTEGRATION-IMAGES.json).

- Writer: `tinker-writer-flight:20261003.integration.3`.
  ID: `sha256:e12f8a3c62fae5b765a901f006b64aef100de1d3ed6299a1aa558dcbd0bb41a5`.
- Services: `tinker-flight-services:20261003160955833`.
  ID: `sha256:daaf65a9b1d6bb8cc1d821a0e3deac56735b4480d57a8ac9bdc32b28b01542b7`.
- Postgres:
  `sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537`.
- Mailpit:
  `sha256:d3238814e371a990ab3d08a8e9b13936953e448590a6648233270a2e3e8fcf75`.

Keepers and both saved tars stay in place.
The proved image still packs Core from `1ff5402f`.
Its teacher uses full Chromium and trusts the private app origin.
Main's `f847c99c` fixes UUIDs on plain HTTP pages.
The secure-origin flag is no longer required with that Core build.
The proved image was kept fixed through all rounds.

After the Hono routes land, rebuild services with:

```bash
node tools/writer-trial/flight-services-image.mjs
```

## Cleanup

Cleanup: 0, `tools/writer-trial/.logs/takeover-cleanup.log`.
The exact removed paths and IDs are in
[INTEGRATION-CLEANUP.json](INTEGRATION-CLEANUP.json).
Old proof files were archived before removal under
`tools/writer-trial/.logs/cleanup-archives/`.
The final trial, proof, image keepers, and saved tars remain.

- Retained reference proof: 0,
  `tools/writer-trial/.logs/takeover-reference-retained.log`.
- Retained staged worker and frozen files: 0,
  `tools/writer-trial/.logs/takeover-ready-retained.log`.

## Review notes

Prior Jev answers stay in [INTEGRATION-JEV.jsonl](INTEGRATION-JEV.jsonl).
No source or test code was changed in the takeover.
No mutation lane is required by this brief.
Nothing was pushed.
