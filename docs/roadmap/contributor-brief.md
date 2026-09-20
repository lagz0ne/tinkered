# Contributor brief — the fixed part

Every ticket brief starts with this file plus the ticket's own target, impact block, and tests. The point is
that the **writer finishes verification before the reviewer sees the work**: gates by exit code, the jev
pre-flight cleared or explained, and a report the lead can check line by line.

## Setup

```bash
cd /home/paseo/next/tinkered
git worktree add ../tinkered-<task> -b <track>/<task> main
cd ../tinkered-<task> && vp install && git checkout -- pnpm-workspace.yaml && vp run -r build
```

- Work only in that worktree. Never touch the main checkout. Never push. Never run a mutation lane (the lead
  runs each lane alone at landing; the floor is 75).
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
2. **jev pre-flight** (advisory, generic — it never gates, you never tune it):
   `node scripts/jev/preflight.mjs main..HEAD`. For every flag write one line: `fixed <how>` or
   `explained <why it is not a defect here>`. A flag you cannot explain is a fix. The tool is generic by
   design: do not add rules or special cases to `scripts/jev/**` for your ticket.
3. **Blast radius**: the greps the ticket names (old symbols → `(none)`; `Scope.Handle` only where ADR 0051
   allows) and the before/after line table.
4. `pnpm validate` → 37/37.

## Report (final message)

Branch · SHAs one line each · line table · the gate chain output (trimmed) with `EXIT 0` · the **jev
pre-flight** lines (flag → fixed/explained) · tests added (title = the promise) · deviations from the brief
with reasons · **Core feedback**: friction, a workaround you had to write, a missing affordance with the API
and the call site, a rule in `docs/best-practices.md` that felt wrong. A feedback row ships with a failing
snippet, not prose.
