# Flight harness gates

All paths are on the proof host.
Each exit was seen when its command ended.
The first two checks predate the required plain gate.
Expected refusals still record exit 1.
No failure is relabeled as a pass.

## Repeat the isolation proof

Run from the worktree root:

```bash
node tools/writer-trial/harness/run-isolation.mjs
```

This uses the saved image tags in `config.json`.
It removes its containers, networks, and volume when done.
The writer has local service names but no outside DNS.
The teacher can set Mailpit Chaos.
The writer gets 403 for Chaos requests.

## Earlier gates

- **Round 1 reference, before plain gate**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-round-1-alias.log`.
- **Edited scaffold, before plain gate**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/check-scaffold-probe.log`.
- **Scored stop guard**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/score-stop-probe.log`.
- **Pending round guard**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/score-pending-probe.log`.
- **Image rebuild refusal**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/rebuild-refused.log`.
- **Image prepare and saved tar files**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prepare-flight-browser.log`.
- **Main-range Jev advisory**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/jev-packets.log`.

## Recorded gates

- **check-score-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-score-final.log`.
- **style-reference**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/style-reference.log`.
- **prose-score**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-score.log`.
- **jev-ticket**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/jev-ticket.log`.
- **harness-score-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/harness-score-step.log`.
- **prose-score-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-score-step.log`.
- **check-score-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-score-step.log`.
- **build-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/build-final.log`.
- **harness-plain**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/harness-plain.log`.
- **check-plain-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-plain-step.log`.
- **plain-unavailable**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/plain-unavailable.log`.
- **prose-plain-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-plain-step.log`.
- **prose-plain-record**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-plain-record.log`.
- **save-overwrite-refused**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/save-overwrite-refused.log`.
- **feedback-round-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/feedback-round-2.log`.
- **workspace-tests-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/workspace-tests-final.log`.
- **validate-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/validate-final.log`.
- **round-2-packet-format**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/round-2-packet-format.log`.
- **save-round-2-retry**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-round-2-retry.log`.
- **jev-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/jev-final.log`.
- **create-current**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/create-current.log`.
- **scope-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/scope-proof.log`.
- **stage-current**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/stage-current.log`.
- **packet-ignore-probe**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/packet-ignore-probe.log`.
- **check-round-2-plain**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/check-round-2-plain.log`.
- **workspace-current**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/workspace-current.log`.
- **feedback-round-2-format**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/feedback-round-2-format.log`.
- **save-current-1**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-current-1.log`.
- **packet-ignore-round-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/packet-ignore-round-2.log`.
- **harness-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/harness-final.log`.
- **check-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-final.log`.
- **export-current-1**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/export-current-1.log`.
- **save-round-2-formatted**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-round-2-formatted.log`.
- **prose-final-code**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-final-code.log`.
- **stage-current-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/stage-current-2.log`.
- **packet-stage-2-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/packet-stage-2-final.log`.
- **save-current-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-current-2.log`.
- **export-current-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/export-current-2.log`.
- **create-later**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/create-later.log`.
- **missing-round-3**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/missing-round-3.log`.
- **later-stage-1**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-stage-1.log`.
- **check-round-2-final**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/check-round-2-final.log`.
- **later-save-1**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-save-1.log`.
- **later-export-1**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-export-1.log`.
- **later-stage-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-stage-2.log`.
- **isolation-current**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/isolation-current.log`.
- **later-save-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-save-2.log`.
- **later-export-2**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-export-2.log`.
- **later-stage-3**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-stage-3.log`.
- **later-save-3**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-save-3.log`.
- **later-export-3**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-export-3.log`.
- **later-stage-4**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-stage-4.log`.
- **later-save-4**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-save-4.log`.
- **later-export-4**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-export-4.log`.
- **later-stage-5**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-stage-5.log`.
- **saved-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/saved-final.log`.
- **readiness-legacy-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/readiness-legacy-final.log`.
- **limits-legacy-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/limits-legacy-final.log`.
- **later-packets-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/later-packets-final.log`.
- **mailpit-chaos**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/mailpit-chaos.log`.
- **export-proof-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/export-proof-final.log`.
- **reference-build-5**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/reference-build-5.log`.
- **save-reference-5**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-reference-5.log`.
- **feedback-reference-5**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/feedback-reference-5.log`.
- **save-reference-5-report**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-reference-5-report.log`.
- **cleanup-current**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/cleanup-current.log`.
- **prose-mail-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-mail-step.log`.
- **check-mail-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-mail-step.log`.
- **export-legacy-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/export-legacy-proof.log`.
- **export-scaffold-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/export-scaffold-proof.log`.
- **cleanup-legacy-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/cleanup-legacy-proof.log`.
- **cleanup-scaffold-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/cleanup-scaffold-proof.log`.
- **export-older-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/export-older-proof.log`.
- **dependency-keepers**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/dependency-keepers.log`.
- **prose-keepers-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-keepers-step.log`.
- **check-keepers-step**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-keepers-step.log`.
- **cleanup-older-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/cleanup-older-proof.log`.
- **harness-keepers-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/harness-keepers-final.log`.
- **saved-later-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/saved-later-final.log`.
- **check-round-5-final**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/check-round-5-final.log`.
- **prose-gates**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-gates.log`.
- **feedback-reference-5-complete**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/feedback-reference-5-complete.log`.
- **reference-fixtures-5**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/reference-fixtures-5.log`.
- **reference-fixtures-format-5**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/reference-fixtures-format-5.log`.
- **save-reference-5-complete**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-reference-5-complete.log`.
- **prose-copy-record**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-copy-record.log`.
- **prose-model-count**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-model-count.log`.
- **jev-finished-code**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/jev-finished-code.log`.
- **saved-after-cleanup**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/saved-after-cleanup.log`.
- **scaffold-evidence**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/scaffold-evidence.log`.
- **round-1-evidence**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/round-1-evidence.log`.
- **check-round-5-complete**: exit 1.
  Log: `/tmp/flight-harness-20261003/logs/check-round-5-complete.log`.
- **feedback-reference-5-config**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/feedback-reference-5-config.log`.
- **own-reference-5-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/own-reference-5-final.log`.
- **prose-progress-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/prose-progress-final.log`.
- **save-reference-5-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/save-reference-5-final.log`.
- **export-later-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/export-later-final.log`.
- **saved-later-complete**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/saved-later-complete.log`.
- **cleanup-later-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/cleanup-later-final.log`.
- **check-report-final**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/check-report-final.log`.
- **cleanup-proof**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/cleanup-proof.log`.
- **saved-final-clean**: exit 0.
  Log: `/tmp/flight-harness-20261003/logs/saved-final-clean.log`.

## Review fix round

All jobs ran in the foreground.
The saved image tags were not rebuilt.
The first Mailpit probe failed because Docker refused a copy into a read-only root.
Helper loading now writes through `docker exec` into `/tmp`.
Both real review checks exit 1 by design.
The reference has no score because the plain checker is absent.
The broken-router attempt records round 1 failed with baseline 0.

- **broken-check**: exit 1.
  Log: `/tmp/flight-harness-review-20261003/logs/broken-check.log`.
- **broken-proof**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/broken-proof.log`.
- **broken-setup**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/broken-setup.log`.
- **cleanup-reference**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/cleanup-reference.log`.
- **cleanup-review-proof**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/cleanup-review-proof.log`.
- **create-reference**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/create-reference.log`.
- **export-reference**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/export-reference.log`.
- **feedback-broken**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/feedback-broken.log`.
- **gate-tests**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/gate-tests.log`.
- **harness-tests-final**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/harness-tests-final.log`.
- **harness-tests-reviewed**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/harness-tests-reviewed.log`.
- **harness-tests**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/harness-tests.log`.
- **isolation-final**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/isolation-final.log`.
- **isolation**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/isolation.log`.
- **legacy-plain-score-test**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/legacy-plain-score-test.log`.
- **live-score-proof**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/live-score-proof.log`.
- **mail-control-proof-first**: exit 1.
  Log: `/tmp/flight-harness-review-20261003/logs/mail-control-proof-first.log`.
- **mail-control-proof**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/mail-control-proof.log`.
- **mail-proxy-check**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/mail-proxy-check.log`.
- **plain-real-errors-test**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/plain-real-errors-test.log`.
- **plain-score-tests**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/plain-score-tests.log`.
- **prose-cleanup-row**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/prose-cleanup-row.log`.
- **prose-isolation**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/prose-isolation.log`.
- **reference-check**: exit 1.
  Log: `/tmp/flight-harness-review-20261003/logs/reference-check.log`.
- **reference-proof**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/reference-proof.log`.
- **reference-setup**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/reference-setup.log`.
- **router-test**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/router-test.log`.
- **save-broken**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/save-broken.log`.
- **save-reference**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/save-reference.log`.
- **score-proofs-reviewed**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/score-proofs-reviewed.log`.
- **stage-reference**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/stage-reference.log`.
- **stage-tests**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/stage-tests.log`.
- **vp-check-final**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/vp-check-final.log`.
- **vp-check-reviewed**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/vp-check-reviewed.log`.
- **vp-check**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/vp-check.log`.
- **prose-reviewed**: exit 0.
  Log: `/tmp/flight-harness-review-20261003/logs/prose-reviewed.log`.
