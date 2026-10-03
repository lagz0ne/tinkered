# Flight integration proof

Branch: `trial/flight-integration`.
Base: `92b8937f`.
Status: blocked on the landed scaffold's browser startup.
The code checks pass; the full five-round proof does not.

## Saved commits

- `b31299f9`: merge reviewed rounds; keep landed services.
- `3d370462`: merge reviewed harness; keep main outside allowed paths.
- `a3a82a02`: freeze and copy `SERVICES.md`.
- `fa9f5a50`: give the teacher the app's WEBHOOK_SECRET.
- `1a3b9d5f`: sort scaffold paths with a compare function.
- `a48a7946`: remove `--teacher-dir`.
- `635bcb27`: build and save writer and services images.
- `75236f79`: move the reference to the landed strict scaffold.
- `650f6051`: use shipped tests and the frozen gate for proof.
- `7d282124`: return completed mail before retry guards.
- `26c31e52`: freeze proof inputs and save browser failure details.

## Gates by exit code

All relative log paths below start at `tools/writer-trial/.logs/`.
The workspace chain printed `EXIT 0` in `integration-gate-chain.log`.

- Install: 0, `integration-install.log`.
- Workspace build: 0, `integration-gate-build.log`.
- `vp check`: 0, `integration-gate-check.log`.
  Zero errors; 28 warnings, matching the base check.
- All package tests: 0, `integration-gate-tests.log`.
  All nine tasks pass.
- Writer harness tests: 0, `integration-gate-writer-tests.log`.
  All 79 tests pass.
- Prose: 0, `integration-gate-prose.log`.
- `pnpm validate`: 0, `integration-gate-validate.log`.
  All 16 lanes pass.
- Strict style census: 0, `integration-gate-style.log`.
- Reference strict plain check: 0, `integration-final-plain.log`.
  17 plain helpers; cap 17.
- Both image builds and tar saves: 0, `integration-images-build.log`.
- Standalone services rebuild: 0, `integration-services-rebuild-command.log`.
- Create: 0, `integration-create.log`.
- Stage 1: 0, `integration-stage-1.log`.
- Worker folder proof: 0, `integration-workspace-proof-green.log`.
  Scaffold, skills, tests, packed packages, and packet 1 only.
  `SERVICES.md`, `PLAIN.md`, and `check:plain` are present.
  No teacher files are present.
- Isolation proof: 0, `integration-isolation.log`.
  Internet, private controls, and writer Mailpit Chaos are refused.
  Service APIs, Postgres, SMTP, and signed callbacks work.
- Jev preflight: 0, `integration-jev-preflight.log`.
- Jev harness tests: 0, `integration-jev-tests.log`.
- Jev final mail source: 0, `integration-jev-final-source.log`.
- Jev labels: 0, `integration-jev-labels.log`.
  Mail fix label: 0, `integration-mail-jev-label.log`.
  Saved labels: [INTEGRATION-JEV.jsonl](INTEGRATION-JEV.jsonl).
- Jev promise scan: 1, `integration-jev-promises.log`.
  It assumes `tools/writer-trial/tests`, which does not exist.
  The harness test files live at the package root.
- Full reference run: 1, `integration-reference-final-v2.log`.
  It stops on round 1, pass 1.
- Public Core failure probe: 1, `integration-late-defer-red.log`.
  This is the expected failure that proves the late-cleanup error.
- Browser failure stack capture: 0, `integration-browser-stack-final.log`.
  The capture worked; the app stayed blank with `Disposed`.
- Final doc prose: 0, `integration-handoff-prose.log`.
- Final scope and frozen-packet check: 0, `integration-handoff-scope.log`.

Round 1, pass 1 logs start at
`tools/writer-trial/.logs/reference-final-v2/round-1/pass-1/`.

- Own check: 0, `own.log`; all 37 shipped tests pass.
- Teacher: 1, `teacher.log`; all three checks fail on startup.
- Exact scaffold seam: 0, `scaffold.log`; 27 files match.
- Strict plain check: 0, `plain.log`; cap 17 holds.
- Frozen Jev gate: 0, `jev.json`; no blockers.
- Full result: 1, `result.json`; `machine-fail`.

Round 1, pass 2, rounds 2 to 5, and planted breaks did not run.
The proof stops at the first full-gate failure.
Earlier setup failures remain in their own log folders.
They are not counted as passes.

## Images and saved copies

Writer tag: `tinker-writer-flight:20261003.integration.1`.
Writer ID:
`sha256:55f5fed4c6a984e6189ff8f526da7cc32c5ecfc681308c22c8ffc0c9f9db5d37`.
Writer tar:
`/home/paseo/.local/share/tinker-writer-trial/image-20261003.integration.1/image.tar`.

Services tag: `tinker-flight-services:20261003131759497`.
Services ID:
`sha256:2de8a2b426bc14c0bb4357724586e06176a07edb339ddcb69c2b2fa3c0f1013b`.
Services tar:
`/home/paseo/.local/share/tinker-writer-trial/services-20261003131759497/image.tar`.
The initial `20261003.integration.1` services tag has the same ID.
Its first saved tar also stays in the writer image folder's `services/`.

Postgres ID:
`sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537`.
Mailpit ID:
`sha256:d3238814e371a990ab3d08a8e9b13936953e448590a6648233270a2e3e8fcf75`.

Both new images have idle keepers.
Old images and proof folders stay until the new full proof passes.
The prepared trial is `flight-integration-01`.
Its manifest is
`/home/paseo/.local/share/tinker-writer-trial/flight-integration-01/manifest.json`.
It is staged at packet 1; no model run started.

## Missing fix and next run

The missing fix is at
`apps/start-scaffold/src/scaffold/frontend/router.tsx:28`.
`tabLifetime.bind()` registers cleanup after its factory returned.
Core raises `Disposed` with reason `resource factory already finished`.
Main, the reference, and the image have the same scaffold bytes.
The brief forbids this writer from changing apps or Core.

Lead: register that cleanup while the resource factory is open.
Rebuild the writer image with a new tag and copy the fixed scaffold
into the reference before running the proof in a fresh folder.

```bash
node tools/writer-trial/harness/run-reference.mjs \
  tools/writer-trial/.logs/reference-after-start-fix
```

After the Hono routes land, rebuild the services image with one command:

```bash
node tools/writer-trial/flight-services-image.mjs
```

That command builds Core, packs current service dependencies,
saves a tar, starts an idle keeper, and updates the services tag.
It changes no service source.
