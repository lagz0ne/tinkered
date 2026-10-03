# Flight integration proof

Branch: `trial/flight-integration`.
Main: `0da81a82`, including Core UUID fix `f847c99c`.
Status: Review; all six fixes and the fresh proof pass.
No trial model run started.

## Review fixes

- `46bd1137`: inhibit host IPv4 on both internal bridges; add gateway probes.
- `96c049ff`: use the parent folder for frozen root files; add a test.
- `ca5fba2d`: freeze teacher hashes at create; refuse changed files.
- `f1f8ca41`: use one webhook secret constant.
- `783e23fa`: state the supplier, Jev cache, and secure-origin limits.
- `8993474b`: rebuild the writer image with current Core and save its tar.

## Isolation

The new gateway probe failed on the old network code with exit 1.
Host ports 2377, 7946, and 5355 accepted connections.
Red log: `tools/writer-trial/.logs/review-gateway-red.log`.
Both internal networks now use `com.docker.network.bridge.inhibit_ipv4=true`.
Docker accepted the option; no host, daemon, or firewall settings changed.
The first green log is `tools/writer-trial/.logs/review-gateway-option.log`, exit 0.

The final proof uses the new writer image and exits 0.
Log: `tools/writer-trial/.logs/review-isolation.log`.
It checks no default route and refused connections to `172.17.0.1:80`.
It also checks the first address in the writer subnet:
ports 2377, 7946, 5355, 22, and 80 must refuse connections.
This replaces the old, too broad no-host-route claim.
Internet, private controls, and writer Mailpit Chaos are refused.
Service APIs, Postgres, SMTP, and signed callbacks work.
Proof containers, networks, and volume were removed.

## Frozen teacher and five rounds

Create saves every teacher file hash and one hash for the full set.
A changed, added, missing, or unpinned teacher makes the check unavailable.
It cannot pass or earn a score.
The grader receives the same bytes that passed the hash check.
The checkout is compared again after the check.
Every new reference `result.json` saves `teacherHash`.

The fresh `--once` run exits 0 on the new writer and current Hono services.
Rounds 1 to 5 each pass own, teacher, scaffold, plain, and Jev gates.
Teacher counts: 3/3, 6/6, 10/10, 17/17, and 21/21.
No planted break was rerun.
Rows: [INTEGRATION-REVIEW-RESULTS.json](INTEGRATION-REVIEW-RESULTS.json).
Run log: `tools/writer-trial/.logs/review-reference.log`.
Saved-result check: `tools/writer-trial/.logs/review-reference-verified.log`, exit 0.
Round logs live under `tools/writer-trial/.logs/reference-review-final/`,
in each `round-N/pass-1/` folder.
Teacher hash:
`ef01fd5ede14b66bf8042813d99fa07299eb76e0dddf78dba9c95e13e83e77ee`.

Round 1 uses one supplier on purpose; its packet asks for one.
The later rounds use all three suppliers.
Jev answers are reused for unchanged file bytes across rounds and passes.
In the earlier two-pass proof, pass 2 reuses pass 1 Jev answers.
It reruns the other checks; it is not a second independent Jev vote.

## Workspace gates

All log names below start at `tools/writer-trial/.logs/`.
The chain is `review-workspace-gates.log`, exit 0.

- Install: 0, `review-final-install.log`.
- Build: 0, `review-final-build.log`.
- `vp check`: 0, `review-final-check.log`.
  Zero errors and 28 warnings, the same warning count as before.
- All package tests: 0, `review-final-tests.log`.
  All nine tasks ran and passed; no cache hits.
- Harness tests: 0, `review-final-writer-tests.log`.
  All 80 tests pass.
- Prose: 0, `review-final-prose.log`.
- `pnpm validate`: 0, `review-final-validate.log`.
  All 16 lanes pass.
- Final proof docs prose: 0, `review-proof-prose.log`.
- Jev preflight for this fix round: 0, `review-jev-preflight.log`.
  No TypeScript source changed; no new flags.

The root-path test failed before its fix and passed after it.
Logs: `review-root-path-red.log`, exit 1;
`review-root-path-green.log`, exit 0.
The teacher test covers changed, added, missing, and unpinned files.
Logs: `review-teacher-red.log`, exit 1;
`review-teacher-green.log`, exit 0.
The combined teacher, suite, and score tests pass all 20 cases.

## Images and saved copies

Exact IDs, tar paths, and the packed Core hash are in
[INTEGRATION-IMAGES.json](INTEGRATION-IMAGES.json).

- Writer: `tinker-writer-flight:20261003.integration.4`.
  ID: `sha256:798c43f875b1054fa29f2a31eedbe7c06461dc7b85f7194674c4146faae82f7a`.
- Services: `tinker-flight-services:20261003160955833`.
  ID: `sha256:daaf65a9b1d6bb8cc1d821a0e3deac56735b4480d57a8ac9bdc32b28b01542b7`.
- Postgres:
  `sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537`.
- Mailpit:
  `sha256:d3238814e371a990ab3d08a8e9b13936953e448590a6648233270a2e3e8fcf75`.

Writer build and tar save: `review-writer-image.log`, exit 0.
The source matches current main; packed Core matches the workspace build.
Core includes the `getRandomValues` fallback.
The secure-origin flag stays in the teacher browser.
It is harmless with the new image and was needed for the old image.
Both saved image tars and their idle keepers remain.

Rebuild services after another service change with:

```bash
node tools/writer-trial/flight-services-image.mjs
```

## Fresh staged trial

The old `flight-integration-hono-01` was removed completely:
Paseo project, containers, volume, networks, trust entry, and folder.
Its host files were archived before removal.
Cleanup log: `tools/writer-trial/.logs/review-cleanup-old.log`, exit 0.

Fresh trial: `flight-deepseek-01`, staged at packet 1.
It pins the new writer, current services, and proved teacher hash.
Both networks use the new bridge option.
The worker has the scaffold, five skills, shipped tests, and packet 1 only.
It has `SERVICES.md`, `PLAIN.md`, and `check:plain`.
It has no teacher files, model agent, or saved attempt.

- Create: 0, `tools/writer-trial/.logs/review-ready-create.log`.
- Stage 1: 0, `tools/writer-trial/.logs/review-ready-stage.log`.
- Files, image pins, teacher pins, and networks: 0,
  `tools/writer-trial/.logs/review-ready-proof.log`.

Manifest:
`/home/paseo/.local/share/tinker-writer-trial/flight-deepseek-01/manifest.json`.
The lead owns review and landing; nothing was pushed.

## Earlier proof kept for review

The rebase onto `0da81a82` exited 0.
Log: `tools/writer-trial/.logs/hono-rebase-continue-2.log`.
The Hono services image build and tar save exited 0.
Log: `tools/writer-trial/.logs/hono-services-image.log`.
Its earlier one-pass results are in
[INTEGRATION-HONO-RESULTS.json](INTEGRATION-HONO-RESULTS.json).

The original two-pass results are in
[INTEGRATION-RESULTS.json](INTEGRATION-RESULTS.json).
Log: `tools/writer-trial/.logs/resume-reference-trusted-final.log`, exit 0.
All ten good runs passed the full gate.
All five planted breaks exited 1 and failed their named case:

- Round 1: `r1 public search shows real fares and asks each active supplier once`.
- Round 2: `r2 a cheaper late fare merges and a failed supplier keeps good rows`.
- Round 3: `r3 a changed price is refused before any hold order`.
- Round 4: `r4 payment waits for a valid signed webhook and syncs across tabs`.
- Round 5: `r5 failed mail keeps the booking valid and retry sends once`.

The round 4 break also failed its own TypeScript check on unused `timingSafeEqual`.
Its browser reached the forged event and failed the signature case.
Prior Jev labels stay in [INTEGRATION-JEV.jsonl](INTEGRATION-JEV.jsonl).
Prior removed images and proof folders stay listed in
[INTEGRATION-CLEANUP.json](INTEGRATION-CLEANUP.json).
