# Flight harness progress

- **trial/flight-harness** — Doing; owner: Codex writer.
  Next: finish the full round 5 teacher proof and record every gate.
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
- Round 1 and 2 packets and checks are read from `610144d0`.
- A fresh later-stage trial freezes all five from `16f68fd4`.
  The older frozen trial stays unchanged.
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

## Scaffold gate and score

- Edited scaffold: app and teacher exit 0; gate exit 1.
  Rule: `flight-scaffold`.
  Log: `check-scaffold-probe.log`.
- Feedback and second save: exit 0.
  The first failure stays round 1; baseline stays zero.
- Scored model stop: stage exits 1 with the first failure.
  Log: `score-stop-probe.log`.
- Ungraded model round: stage exits 1 until checked.
  Log: `score-pending-probe.log`.
- Score unit checks: exit 0, `score-unit.log`.
  A retry pass cannot erase a failed round.
  Five passed rounds give baseline five.

Both stage guard probes use a temporary test agent ID.
They restore the exact manifest bytes after the probe.
Reference proofs have no model agent IDs.
Their record says `modelRun: false`; it is no model baseline.
Scored runs must save their agent ID, as the launch rules require.
Proof runs may stage later rounds to test the harness.
The score keeps every earlier failure.

The harness supports stages 1 through 5.
The given rounds commit has real packets and checks for 1 and 2 only.
That old frozen trial refuses round 3 with exit 1.
The later rounds branch now has all five in `16f68fd4`.
A fresh trial stages all five with exit 0.
No placeholder can earn a round.

## Plain gate

- The new gate runs the image's `check:plain` on the writer project.
- It runs next to the scaffold seam check.
- A missing script fails as unavailable, never as a pass.
- A missing script earns no round and no model baseline.
- The saved image `20261003.5` has no `check:plain`.
  The real Docker probe confirms unavailable.
  Log: `plain-unavailable.log`, exit 0 for the refusal proof.
- The strict forms writer is adding the real script.
  Its project-root argument lets the trusted script read `/work`.
  We do not copy unfinished script source into a saved image.
- Future image builds omit frozen `TASK.md` from formatting.
  Staging adds that rule for older saved flight images too.
  Round 2's packet bytes otherwise trigger formatting failure.
- Harness tests and check: exit 0.
  Logs: `harness-plain.log`, `check-plain-step.log`.

The earlier round 1 pass predates the new plain gate.
Current checks cannot pass until an image ships the real script.
This is the lead's required unavailable state.

## Later stages

- All five real packets stage with exit 0.
  Logs: `later-stage-1.log` through `later-stage-5.log`.
- Saves and exports for rounds 1 through 4: exit 0.
  These are staging probes with no feature answer or agent.
- Stage 5 gets the full reference source from `16f68fd4`.
  It leaves the scaffold bytes unchanged.
- Round 2 with the final packet ignore: own and teacher exit 0.
  Teacher cases: six of six pass.
  The full gate exits 1 as unavailable for missing `check:plain`.
  Log: `check-round-2-final.log`.
- Vite+ ignored the earlier `.oxfmtrc.json` rule.
  The real packet format proof now uses `.prettierignore`.
  Log: `packet-stage-2-final.log`, exit 0.
- Mailpit enables its Chaos API for a real refused SMTP send.
  The default failure chance stays zero.
  API proof: `mailpit-chaos.log`, exit 0.
- Workspace tests: exit 0, `workspace-tests-final.log`.
- Validate: all 16 lanes pass, exit 0, `validate-final.log`.
- Stock readiness: nine checks pass, exit 0.
  Log: `readiness-legacy-final.log`.
- Stock limits: five checks pass, exit 0.
  Log: `limits-legacy-final.log`.
- All 29 repo check warnings name files unchanged from the brief commit.
  Log: `scope-proof.log`, exit 0.

Session and report files are fixtures for the harness proofs.
No live model session was run.
Their raw bytes and hashes still exercise the normal save path.
The first round 5 report used the staging fixture by mistake.
Feedback saves the proper reference report in a new attempt.
The first report stays saved.
