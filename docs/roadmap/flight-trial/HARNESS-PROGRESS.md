# Flight harness progress

- **trial/flight-harness** — Doing; owner: Codex writer.
  Next: round 2, the scaffold edit proof, and the score record.
  Verify: reference passes; scaffold edit blocks.
  The card stays here within the ticket's path limits.

## Saved step

- `eecdf5eb`: freeze real flight packets.
- Packet and attempt tests: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/suite-step.log`.
- Missing packet 1 refuses create.
- Missing later packets cannot stage.
- New flight rules keep the Start scope setup.

## Assumptions

- The lead merges packets and checks from the rounds branch.
- Before merge, freeze packets through `--packet-dir`.
- Before merge, read checks through `--teacher-dir`.
- Packets and checks are read from `610144d0`.
- Round 1 reference source is read from `6b0ba61c`.
- Round 2 reference source is read from `610144d0`.
- The reference adds feature source to the image's starter.
  The starter's package file and tests stay in place.
- Registry targets use the starter's default aliases.
- Each worker needs its own services and database.
- Teacher controls need a second private network.
- The check run uses fresh services, not writer state.
- No model writer runs during harness proof.
- One Vitest worker fits the two GB app limit.
- Trial networks use random `/28` subnets in `10.203.0.0/16`.
  Docker rejects overlap and the harness retries.
- Victoria URLs use ports 9428 and 10428.
  Those outside services have no route from the trial network.
- Exact starter source bytes are trusted registry files.
  New and changed source still runs through Jev.
- A saved generated router must match the fresh build to be trusted.
- New image tag `20261003.5` preserves the old saved images.

- Flight pins Playwright 1.63.0, as the rounds proof does.
  Playwright 1.55.0 treats plain `th` as cells.
  The other suites keep 1.55.0.

## Stage 1 ready

- Create and stage 1: exit 0.
- Start scaffold, skills, and only packet 1: exit 0.
- Network and signed callback proof: exit 0.
- Real round 1 reference: exit 0.
  Own check, test, build, teacher, and Jev gate all pass.
  Teacher checks: three of three pass.
- Saved hashes and image IDs: exit 0.
- Workspace build: exit 0, `build-ready.log`.
- Check: exit 0, 29 warnings, `check-stage1-ready.log`.
- Harness tests: exit 0, `harness-tests-ready.log`.

Logs above are under `/tmp/flight-harness-20261003/logs/`.
The round check is `check-round-1-alias.log`.
Its full evidence is in trial `flight-harness-proof-06`.
The saved attempt is round 1, worker 1, attempt 1, check 2.

Early checks stay saved, including their failures.
The first image had an older Playwright table reader.
The next browser tried HTTPS for the host name `app`.
The browser now uses `flight-app`.
The image and teacher files stay pinned and hashed.
The proof's source commit predates the completed harness commit.
Frozen hashes and image IDs name the tested bytes.
