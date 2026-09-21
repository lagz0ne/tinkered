<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Run `vp run prose` after editing any `.md` (it also runs on commit). The rule and the word
      list: `docs/writing-style.md`.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Writing style (every `.md`)

A word is jargon when it has no `docs/glossary.md` row and a plainer word says the same thing — cut
it. Define a term once where it first appears; use the words the tool prints; say what a thing does,
not what it is like. `scripts/prose-lint.mjs` flags the known offenders (`docs/writing-style.md`) and
blocks a commit that stages one.

## Elaboration workflow

Skills live in `.agents/skills/` (Codex) with symlinks in `.claude/skills/` (Claude).
When a request is a plan, design, decision, or "how does X work":

0. **Find the analogy first.** Before inventing a model from scratch, look for an
   established precedent the problem is already shaped like (POSIX signals, a DB
   transaction, a filesystem, an HTTP rule, a well-known library's API). Name
   it, borrow its vocabulary and its solved trade-offs, then note where ours is
   _simpler_. Guessing our own model invites edge cases the precedent already
   settled — for example, "close is a graceful-vs-forced shutdown (POSIX), not a wished
   outcome" (ADR 0028) dissolved nine rounds of ad-hoc failure-precedence bugs.
1. `grill-with-docs` — interview one question at a time; write ADRs in
   `docs/decisions/` and terms in `docs/glossary.md` as decisions land.
2. `show-me` — before asking a question or recording a decision that has
   structure (flow, layers, options, data shape), show it first: a small
   diagram, file tree, pseudocode, or diff. Smallest view that makes the point.
3. `to-tickets` — once the design is settled, break it into tickets.
4. `coding-convention` — applies to every TypeScript file and test written after.

## Code navigation (SCIP — part of the workflow, not optional)

`scripts/scip.sh` wraps `scip-typescript` + the `scip` CLI (both in the persistent home; the script
sets PATH itself). It gives symbol-precise defs and per-file reference counts — grep cannot tell
`ResourceController.resolve()` from `OperationController.run()` in the same file; SCIP can.

```bash
scripts/scip.sh index                                  # all packages -> .scip/<pkg>.scip (seconds; gitignored)
scripts/scip.sh refs 'Handle#\w+:run\(\)\.$'           # definitions + refs per file, every package
scripts/scip.sh symbols 'OperationController' core      # learn the exact symbol strings first
```

Three fixed uses (skipping one is a review finding):

1. **Before any public-symbol change** (rename, removal, signature): the contributor brief includes the
   `refs` table for every touched symbol — the blast radius — and the contributor edits from that
   table, not from grep or compiler errors alone. The same table is committed as the ticket's ` ```impact <tag> `
   block in the track's `PROGRESS.md` before the code (ADR 0047); in review the lead runs
   `node tools/jev/impact.mjs <tag>` (advisory) beside `refs`.
2. **Lead review of every ticket:** re-run `scripts/scip.sh index`, then `refs` on the OLD symbols (must
   print `(none)`) and on the NEW ones (files must match the expectation from the brief). Paste both
   in the review note.
3. **Plans and ADRs** cite definition lines from `refs` ("Anchors" in `docs/roadmap/**/PROGRESS.md`),
   never hand-typed line numbers.

## Execution workflow (Kanban)

Any work with more than one step runs from `TODO.md`, the single live Kanban board.
The lanes are **Ready → Doing → Review → Done**, with **Blocked** for a missing dependency
and **Parked** for deliberate deferrals or ideas. Finish approved work through Done;
do not turn parked ideas into active work just to empty the board.

Ticket detail, gate evidence, and reset recipes stay in `docs/roadmap/**/PROGRESS.md`.
Keep only recent results in Done; older detail belongs in `docs/roadmap/archive/` or the track.

1. **Create the card first.** Put an approved request in Ready before writing code. Give it a
   stable name, a concrete next step, and a Verify condition. Keep Ready ordered. Split a card
   when it turns out to contain separate work; keep each card in one lane only.
2. **Pull one card into Doing.** Name the owner. Limit each lead to one Doing card at a time;
   genuinely independent work may have separate owners. Keep the next step current.
3. **Move saved work to Review.** Keep the owner and the exact remaining review/check step.
   Return it to Doing if changes are needed. A saved edit or contributor report is not Done.
4. **Verify before Done.** Move a card only when its result is observed:
   - code items: `vp check` clean, the relevant `vp test` / `vp run <script>` green,
     and (for `core`) the ticket gate (`scripts/ticket.sh`) passes;
   - a release/budget claim: `pnpm validate` (`scripts/validate.mjs`, ADR 0016) is green —
     size, promises, heap, CRAP, entries, cast-free examples; mutation via `vp run core#mutate`;
     wall-clock timing via `bench` in a sandbox (never in-container);
   - a fix for a reported defect: a test that fails without the fix and passes with it;
   - anything claimed "works": the command output that proves it.

   Link that proof in Done and update the track's `PROGRESS.md` where applicable.

5. **Keep the state honest.** Blocked names the missing thing and the next action once it is
   available; Parked names the condition for resuming. Missing proof stays in Review or Blocked.
   At a handoff, leave the owner, lane, and next step accurate. Do not silently promote deferred work.

## Contributor workflow (delegated implementation)

The lead plans and reviews. A Paseo contributor agent (`pi` / `meta-muse/muse-spark-1.3-contributor`,
thinking `max`) writes the code: one agent per task, **one package per agent** (long sessions die when the
provider drops; a step already on disk is never lost).

1. Each contributor works in its own worktree: `git worktree add ../tinkered-<task> -b <track>/<task> main`,
   `vp install` there. It never touches the main checkout, commits by explicit pathspec after every green
   step, never pushes, never uses `--no-verify`.
2. The brief is `docs/roadmap/contributor-brief.md` (the fixed part) plus the ticket's target and its
   `impact` block. Every file the impact block names may be edited, tests included. The writer verifies
   before the lead reads: `vp run -r build`, then the gate chain (by exit code), then the Jev steps below,
   then the report in the brief's format, ending with **Core feedback** (a failing snippet, not prose).
3. The lead: runs `node tools/jev/review.mjs main..HEAD` (a hint where to read first), reads the diff,
   labels each fix-round nit a judge covers, asks for one fix round, re-runs every gate by exit code,
   fast-forwards `main`, runs the touched package's mutation lane **alone** (floor 75), pushes, removes the
   worktree and branch.
4. **Feedback flows back to core.** Every report ends with **Core feedback**; the lead records candidates in
   `docs/roadmap/core-feedback.md`. A candidate becomes a core ticket after a second asker, or at once when
   the workaround is dishonest.

## Jev (advisory judges) — `tools/jev`, a workspace package

Jev is a model that answers one narrow yes/no question about one thing our own code picked out
(`extract.mjs`, on oxc-parser). Advisory means: it points, it never blocks. Nothing in `tools/jev` exits
non-zero on a finding. What each tool and judge asks, in plain words: `tools/jev/README.md`; the live
questions: `node tools/jev/explain.mjs`.

- **Writer, before reporting:** `node tools/jev/preflight.mjs main..HEAD`; on touched packages
  `node tools/jev/tests.mjs <pkg>` and `node tools/jev/promises.mjs <pkg>`. Every hit is fixed or explained in
  one line, then labeled: `node tools/jev/label.mjs <judge> true|false <file>[#<unit|title>]`. A `~` hit is a
  judge calibration found noisy: read it, no line owed.
- **Lead, at review:** `review.mjs`, and a label for each nit a judge covers.
- **Lead, every ~10 new cases:** `node tools/jev/calibrate.mjs`, commit `calibration.json`. Calibration
  re-asks every judge about every labeled case and grades it `proven`, `provisional`, or `noisy`. Only a
  `proven` judge could ever block — none does today.
- **Rules:** no per-ticket rule in `tools/jev`. If plain code can check it, plain code checks it; Jev gets
  only what code cannot see.
