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
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Elaboration workflow

Skills live in `.agents/skills/` (Codex) with symlinks in `.claude/skills/` (Claude).
When a request is a plan, design, decision, or "how does X work":

0. **Find the analogy first.** Before inventing a model from scratch, look for an
   established precedent the problem is already shaped like (POSIX signals, a DB
   transaction, a filesystem, an HTTP semantic, a well-known library's API). Name
   it, borrow its vocabulary and its solved trade-offs, then note where ours is
   _simpler_. Guessing a bespoke model invites edge cases the precedent already
   settled — e.g. "close is a graceful-vs-forced shutdown (POSIX), not a wished
   outcome" (ADR 0028) dissolved nine rounds of ad-hoc failure-precedence bugs.
1. `grill-with-docs` — interview one question at a time; write ADRs in
   `docs/decisions/` and terms in `docs/glossary.md` as decisions land.
2. `show-me` — before asking a question or recording a decision that has
   structure (flow, layers, options, data shape), show it first: a small
   diagram, file tree, pseudocode, or diff. Smallest view that makes the point.
3. `to-tickets` — once the design is settled, break it into tickets.
4. `coding-convention` — applies to every TypeScript file and test written after.

## Code navigation (SCIP — lean on it)

`scip-typescript` + the `scip` CLI live in the persistent home. **Lean on them** for precise
symbol navigation — defs, refs, occurrences, and approximate call edges across `packages/*` —
instead of guessing symbols or scanning by hand. It is the highest-signal way to map the API
and find every use of a symbol before a change (see `docs/roadmap/core-v1/hot-paths.md` for a
SCIP-backed hot-path map). Keep an index per package and regenerate as the code grows (indexes
are gitignored under `.scip/`):

```bash
cd packages/<pkg> && scip-typescript index --output ../../.scip/<pkg>.scip
scip print --json .scip/<pkg>.scip | head    # symbols / occurrences
scip stats --from .scip/<pkg>.scip           # size of the map
```

## Execution workflow (todo list)

Any work with more than one step runs off an explicit todo list. **The goal is
always to drive the list to empty.**

The durable list is `TODO.md` at the repo root (the single working list, incl. blocked
design threads); core ticket detail + reset recipes stay in `docs/roadmap/**/PROGRESS.md`.

1. **Build the list first.** Turn the request (or the tickets it maps to) into a
   flat, ordered todo list in `TODO.md` before writing code. Keep it visible and current:
   add items as they surface, split an item that turns out to be several.
2. **One item in progress at a time.** Finish (and verify) the current item before
   starting the next, unless items are genuinely independent.
3. **Verify before you mark done — never tick on intent.** An item is `done` only
   when its result is _observed_, not when the edit is written:
   - code items: `vp check` clean, the relevant `vp test` / `vp run <script>` green,
     and (for `core`) the ticket gate (`scripts/ticket.sh`) passes;
   - a release/budget claim: the gate `pnpm validate` (`scripts/validate.mjs`, ADR 0016) is green —
     size, promises, heap, CRAP, entries, cast-free examples; mutation via `vp run core#mutate`;
     wall-clock timing via `bench` in a sandbox (never in-container);
   - a fix for a reported defect: a test that fails without the fix and passes with it;
   - anything claimed "works": the command output that proves it.
     If you cannot show it, the item stays `in_progress` (or gets a new `blocked`
     item describing the exact missing thing). Say so plainly rather than marking done.
4. **Then tick it**, and reflect it in the durable tracker
   (`docs/roadmap/**/PROGRESS.md` for core tickets) so the list survives a context reset.
5. **Keep going until empty.** Do not stop with items open; if you must pause,
   leave the list with each item's true state (`done` / `in_progress` / `blocked`)
   and the next concrete action.

## Contributor workflow (delegated implementation)

The lead session orchestrates and reviews; implementation is delegated to a Paseo contributor agent
(`pi` / `meta-muse/muse-spark-1.3-contributor`, thinking `max`), one agent per task:

1. Each contributor works in its own worktree: `git worktree add ../tinkered-<task> -b perf/<task> main`,
   `vp install` there, never touches the main checkout, commits by explicit pathspec, never pushes.
2. The brief is self-contained: read `.agents/skills/coding-convention/SKILL.md` (incl. Performance),
   exact measure commands (`bench/core-probe.mjs`, `bench/stores-probe.mjs`, `bench/react-vs-zustand.mjs`,
   min of 3), gates (`vp check` 0 errors, tests, census `--strict`, `pnpm validate`; the mutation lane is
   the reviewer's), and the report format (branch, SHAs, before/after table, what was verified and how).
3. The lead reviews the diff for shape (facades, duplicated hot bodies, leaked internals, identity-keyed
   memos), re-measures, requests one fix round, cherry-picks onto `main`, runs `vp run core#mutate`
   isolated, pushes, then removes the worktree and branch.
