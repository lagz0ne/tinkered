# Writer brief: the fixed part

Every ticket brief is this file plus the ticket's target (and its impact
block, when there is one). You finish all checks before the lead reads.

## Setup

```bash
cd /home/paseo/next/tinkered
git worktree add ../tinkered-<task> \
  -b <track>/<task> main
cd ../tinkered-<task>
vp install
git checkout -- pnpm-workspace.yaml
vp run -r build
```

## Rules

- Work only in your worktree. Never push. Never `--no-verify`.
- Commit by explicit path after every green step. A dropped connection then
  loses one step at most.
- `vp run -r build` before every check: a stale `dist` shows fake errors.
- A red check is "already on main" only after you run it on `main`
  (`git worktree add /tmp/main-check main`).
- Run a full mutation lane only when your ticket says so, and then always under
  `flock /tmp/mutation.lock` (one mutation or timing run at a time on this machine).
- Run every long job (a mutation lane, a timing run, the gate) in the foreground and wait for it
  in the same turn. Never end a turn while a job runs in the background: it can die with the
  turn, and nobody wakes you when it ends.
- For `pnpm validate` only: set `allowBuilds: esbuild: true` in
  `pnpm-workspace.yaml`, run, then `git checkout -- pnpm-workspace.yaml`.
  Never commit that file.

### A mutation-lift ticket

Each surviving mutant the ticket names needs its kill check, run after the
test is green:

```bash
cd packages/<pkg>
npx stryker run \
  --mutate "src/<file>:<line>-<line>" \
  --reporters clear-text
```

It prints `[Killed]` or `[Survived]` per mutant. Report `[Killed]` per row. A
row without it is not covered. (Two lifts without this check left 47 of 60
"covered" mutants alive.)

## Before you report

1. **The gate, by exit code.** One chain:

   ```bash
   vp run -r build && vp check \
     && vp run <pkg>#test \
     && <each consumer's tests>
   echo EXIT $?
   ```

   `EXIT 0`, and no more `vp check` warnings than `main`.

2. **Jev.** Advisory: it points, it never blocks.

   ```bash
   node tools/jev/preflight.mjs main..HEAD
   node tools/jev/tests.mjs <pkg>
   node tools/jev/promises.mjs <pkg>
   ```

   Run the last two only on packages whose tests you changed. Fix each `⚠`,
   or say why it is not a defect. Then label it; the label is your answer:

   ```bash
   node tools/jev/label.mjs <judge> \
     true|false <file>[#<unit>] \
     --by <ticket> --why "<text>"
   ```

   `true` = you fixed it. `false` = not a defect here. A `~` or `ℹ` hit owes
   nothing. Commit `tools/jev/cases.jsonl`. Never add rules to `tools/jev`.

   A `promises.mjs` `⚠` is a test title the README never promises: add the
   README line, or say why it is not a promise.

3. **Impact block** (only when the ticket has one): run the `refs` it names.
   Old symbols print `(none)`.

4. `pnpm validate`: every lane green.

## Report (your last message)

- Branch and commits, one line each.
- The gate chain output, trimmed, with `EXIT 0`.
- The label lines.
- What you did differently from the brief, and why.
- **Core feedback:** friction, a workaround, a missing feature, or a rule in
  `docs/best-practices.md` that felt wrong. Each comes with a failing snippet,
  not prose.
