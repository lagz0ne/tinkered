# Contributor brief — the fixed part

Every ticket brief starts with this file plus the ticket's own target, impact block, and tests. The point:
the **writer finishes verification before the reviewer sees the work** — gates by exit code, every Jev flag
fixed or explained, and a report the lead can check line by line.

## Setup

```bash
cd /home/paseo/next/tinkered
git worktree add ../tinkered-<task> -b <track>/<task> main
cd ../tinkered-<task> && vp install && git checkout -- pnpm-workspace.yaml && vp run -r build
```

- Work only in that worktree. Never touch the main checkout. Never push. Never run a full mutation lane (the
  lead runs each lane alone at landing; the floor is 75; core and react 85).
- **A mutation-lift ticket has one proof per target: the per-line kill check.** For each surviving mutant the
  ticket names, after the test is green run
  `cd packages/<pkg> && npx stryker run --mutate "src/<file>:<line>-<line>" --reporters clear-text`
  (under a minute; it prints one `[Killed]` / `[Survived]` per mutant on that line and exits 1 while one
  survives — that exit code is the answer, not a gate). Report `[Killed]` per row; a row without it is not
  covered. Two lifts of 60 rows without this check left 47 mutants alive behind "covered" claims; with it, 46 of 46 died.
- `vp run -r build` before every `vp check` or test run: apps import the packages' built `dist`; a stale dist
  shows phantom type errors and failing app tests.
- Never call a red check "pre-existing" without running the same check on `main` (`git stash`-free: use the
  main checkout read-only, or `git worktree add /tmp/main-check main`).
- Commit by explicit pathspec after every step that is green, one line each, so a dropped connection loses
  one step at most. If your connection drops, the lead resumes you; nothing on disk is lost.
- For `pnpm validate` only: set `allowBuilds: esbuild: true` in `pnpm-workspace.yaml`, run, then
  `git checkout -- pnpm-workspace.yaml`. Never commit that file.

## Before reporting — in this order

1. **Exit-code gate**, one chain, pasted with its `EXIT` line:
   `vp run -r build && vp check && vp run <pkg>#test && <every consumer's tests>; echo EXIT $?` → must be 0,
   `vp check` at 0 errors and no more warnings than `main`.
2. **Jev pre-flight** (advisory: it points, it never blocks; you never tune it):
   `node tools/jev/preflight.mjs main..HEAD`. For every flag write one line: `fixed <how>` or
   `explained <why it is not a defect here>`. A flag you cannot explain is a fix. A `~` hit is a judge
   calibration found noisy: read it, no line owed. Do not add rules or special cases to `tools/jev/**`
   for your ticket.
   **Then label what you decided** — one line per flag; this is how the judges get calibrated:
   `node tools/jev/label.mjs <judge> true <file>#<unit> --by <ticket> --why "<what you fixed>"` for a
   fixed flag, `… false …` for an explained one (file judges take `<file>` alone). Commit
   `tools/jev/cases.jsonl` with your ticket.
3. **Test quality and promise gap** when you added or changed tests in a package:
   `node tools/jev/tests.mjs <pkg>` — every `⚠` is a test to delete, merge, or explain. The convention
   says over-testing is a defect; the judge asks one thing — does the title name the outcome the
   body asserts? — and plain code flags private imports and helper counts. Then
   `node tools/jev/promises.mjs <pkg>` — every
   `⚠` is a test title the README never promises: write the README line, or say why that title is not a
   promise.
   Label what you decided on both (`label.mjs`), as in step 2.
4. **Blast radius** (the files a change may reach): the greps the ticket names (old symbols → `(none)`; `Scope.Handle` only where ADR 0051
   allows) and the before/after line table.
5. `pnpm validate` → 38/38.

## Report (final message)

Branch · SHAs one line each · line table · the gate chain output (trimmed) with `EXIT 0` · the **jev
pre-flight** lines (flag → fixed/explained, each labeled) · the **test quality** and **promise gap** lines for touched packages · tests added (title = the promise) · deviations from the brief
with reasons · **Core feedback**: friction, a workaround you had to write, a missing feature with the API
and the call site, a rule in `docs/best-practices.md` that felt wrong. A feedback row ships with a failing
snippet, not prose.
