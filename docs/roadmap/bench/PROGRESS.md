# Bench proof

## bench/probe-core

- Owner: writer (Codex).
- Next: lead review and queue proof.
- Pick: keep the assigned CPU when the list has one CPU.
  A list with more than one CPU picks its last CPU.
- An explicit `CORE` still wins.
- The wrapper passes `CORE` only when the caller set it.
- `AGENTS.md` and `CLAUDE.md` name no CPU 6.
  Both stay as they were.
- The shell test uses real CPU pins and a fake probe.
  It runs no timing job and never calls benchd.
  It also checks the wrapper with and without a queue command.
- Job and override CPUs come from the runner's own CPU list.
  The fallback check uses that whole list.
- String checks cover `0-2,4-6` and `3,7` without pinning.
- Failed checks print their name, exit code, and saved stderr.
- Pick: keep scratch files inside the repo.
  `.gitignore` skips `.bench-affinity.*`.

### Shell proof

```bash
bash -n bench/ab.sh bench/queued.sh bench/cpu-list.sh \
  bench/affinity.test.sh
bash bench/affinity.test.sh
```

```text
PASS parse=7: last CPU 7
PASS parse=0-7: last CPU 7
PASS parse=0-2,4-6: last CPU 6
PASS parse=3,7: last CPU 7
PASS affinity=0 CORE=unset: both probes CPU 0
PASS affinity=0 CORE=6: both probes CPU 6
ab.sh: CPU list 0-2,4-6; picked last CPU 6
PASS affinity=0-2,4-6 CORE=unset: both probes CPU 6
PASS queue CORE=unset: both probes CPU 0
PASS queue CORE=6: both probes CPU 6
PASS host CORE=unset: both probes CPU 0
PASS host CORE=6: both probes CPU 6
```

- The same test against `origin/main`'s `ab.sh` exits 1.
  Expected probe CPUs: 0, 0. Actual probe CPUs: 6, 6.
- A fake harness writes `saved stderr proof` and exits 23.
  The test prints the check name and that stderr, then exits 23.

```text
FAIL ab affinity=0 CORE=unset (exit 23)
saved stderr proof
```

- Queue timing proof belongs to the lead.

### Repo gates

```bash
vp run -r build && vp check \
  && bash bench/affinity.test.sh \
  && vp run prose
vp run -r test
```

- Gate: `EXIT 0`.
- Package tests ran alone: `TEST EXIT 0`.
- `vp check`: 0 errors, 27 warnings.
  No source files checked by the lint changed.
- Package tests: 1,792 passed, 1 skipped.
- `pnpm validate`: all 19 lanes pass, exit 0.
  This runs no timing lane.
- Jev: no source files changed, no flags, no labels owed.
  Use `origin/main` as the base: local `main` has other work.
- Core feedback: do not run the tests beside `pnpm validate`.
  Its size lane rebuilds Core while tests load its built files.
  The first run failed; the full gate run alone passes.

```bash
vp run -r test
# while pnpm validate is running:
# Failed to resolve entry for package "@tinker/core".
```
