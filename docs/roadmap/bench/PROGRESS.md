# Bench proof

## bench/probe-core

- Owner: writer (Codex).
- Next: lead review and queue proof.
- Pick: keep the assigned CPU when the list has one CPU.
  A list with more than one CPU keeps the old default, CPU 6.
- An explicit `CORE` still wins.
- The wrapper passes `CORE` only when the caller set it.
- `AGENTS.md` and `CLAUDE.md` name no CPU 6.
  Both stay as they were.
- The shell test uses real CPU pins and a fake probe.
  It runs no timing job and never calls benchd.
  It also checks the wrapper with and without a queue command.

### Shell proof

```bash
bash -n bench/ab.sh bench/queued.sh \
  bench/affinity.test.sh
bash bench/affinity.test.sh
```

```text
PASS affinity=7 CORE=unset: both probes CPU 7
PASS affinity=7 CORE=5: both probes CPU 5
ab.sh: CPU list 0-7 has more than one CPU; picked CPU 6
PASS affinity=0-7 CORE=unset: both probes CPU 6
ab.sh: CPU list 0,7 has more than one CPU; picked CPU 6
PASS affinity=0,7 CORE=unset: both probes CPU 6
PASS queue CORE=unset: both probes CPU 7
PASS queue CORE=5: both probes CPU 5
PASS host CORE=unset: both probes CPU 7
PASS host CORE=5: both probes CPU 5
```

- The same test against `origin/main`'s `ab.sh` exits 1.
  Expected probe CPUs: 7, 7. Actual probe CPUs: 6, 6.
- Queue timing proof belongs to the lead.

### Repo gates

```bash
vp run -r build && vp check \
  && bash bench/affinity.test.sh \
  && vp run prose && vp run -r test
```

- Gate: `EXIT 0`.
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
