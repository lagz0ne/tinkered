# Review fix-round proof

Branch: `core/close-hook-scope`.
The five review items are fixed.
The build config matches `origin/main`.

## Red and green tests

Each red run returned 1 with its required line removed or reverted.
The restored source passes all 14 closing tests.

- First root close from session cleanup:
  [red](red-reentrant-first-close.log).
- Idle session resource and hook closing signals:
  [red](red-idle-session.log).
- First closing read inside a close hook:
  [red](red-first-read-in-close.log).
- Root close with no stop signal:
  [red](red-reentrant-without-stop.log).
- All four on the restored source:
  [green](green-fix-tests.log), exit 0.
- The built-package re-entry probe:
  [output](fix-reentrant-probe.log), exit 0.
  Both close results are success; hook count is 0.

## Per-line mutation proof

Each command ran from `packages/core` under the mutation lock.
The saved status rows come from Stryker's JSON output.

- Line 4011: [one killed mutant](mutate-line-4011.log).
- Line 5505: [two killed mutants](mutate-line-5505.log).
- Line 5519, formerly 5512:
  [one killed mutant](mutate-line-5519.log).
- Line 5508:
  [one killed mutant after the fourth test](mutate-line-5508-retry.log).
  Its [first run](mutate-line-5508.log) found the missing no-stop-signal case.
- Lines 5506, 5507, 5509, and 5511 produced no mutants.
  Each has its own `mutate-line-<line>.log` in this folder.
- [Saved mutant rows](focused-mutants.json).

## Gates

Each log ends with its exit code.

- [Build](gate-build.log): 0.
- [Check](gate-check.log): 0; the same 28 warnings.
- [Core tests](gate-core-test.log): 0; 814 tests.
- [All workspace tests](gate-all-test.log): 0; nine tasks.
- [Validate](gate-validate.log): 0; all 16 lanes.
- [Prose](gate-prose.log): 0.
- [Core mutation](gate-core-mutate.log): 0; score 85.88.
  The command is `flock /tmp/mutation.lock vp run core#mutate`.
  The floor is 85; no mutant is excluded.
- [Exit codes](gate-exits.json).
- [Full mutation summary](full-mutation-summary.json).
- [Full mutation report](full-mutation-report.json.gz).

Runtime size: [16,257 B gzip](fix-size.log).
That is +101 B over the 16,156 B base; the cap is 16,384 B.
When `closing` is unused, [promise counts stay 0/5/2](fix-promises-budget.log).

## Style and advisory proof

The new tests pass [strict style](fix-test-style.log).
Source has the [same five S10 and three S14 hits](fix-source-style.log)
as [main](fix-base-style.log).

The four new tests have no plain test flag or README gap.
Old test and README flags have reasons in [ADVISORY.md](ADVISORY.md).
The lead owns merging and calibration of [scoped labels](jev-cases.jsonl).
