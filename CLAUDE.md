# tinkered

## Toolchain: Vite+

`vp` is the one CLI: runtime, packages, dev, build, test, lint, format. It
wraps Vite, Rolldown, Vitest, tsdown, Oxlint, and Oxfmt.

- `vp <name>` runs a built-in. `vp run <name>` runs a `package.json` script
  or a `vite.config.ts` task. Check both files first; they can differ.
- `vp help`, `vp <command> --help`, `vp toolchain` for versions.
- Docs: `node_modules/vite-plus/docs`.
- Setup looks wrong: run `vp env doctor` and share its output.

## Checks before you call it done

- `vp install` after a pull.
- `vp run -r build` first: apps import the packages' built `dist`.
- `vp check` and `vp test`.
- `vp run prose` after editing any `.md` (it also runs on commit).

## Writing (every `.md`)

The reader is on a phone. Rules and word list: `docs/writing-style.md`.

- A word with no `docs/glossary.md` row and a plainer twin is jargon. Cut it.
- One fact per line. Lists over tables. Code fences under 60 characters.
- Diagrams flow top to bottom.

## Designing

For a plan, a design, a decision, or "how does X work":

1. **Find the precedent first.** Look for a known model the problem already
   fits (POSIX signals, a DB transaction, an HTTP rule). Borrow its words and
   its settled trade-offs; note where ours is simpler. Example: ADR 0028
   treats close as graceful vs forced shutdown, as POSIX does.
2. `grill-with-docs`: one round of questions at a time. Write decisions to
   `docs/decisions/` and terms to `docs/glossary.md` as they settle.
3. `show-me`: show structure before asking about it.
4. `to-tickets`: split the settled design into tickets.
5. `coding-convention`: for every TypeScript file and test after that.

Skills live in `.agents/skills/`, linked from `.claude/skills/`.

## Finding code: SCIP

`scripts/scip.sh` finds a symbol's definition and every file that uses it.
Grep cannot tell two `run()` methods apart; SCIP can.

```bash
scripts/scip.sh index
scripts/scip.sh symbols 'OperationController' core
scripts/scip.sh refs 'Handle#\w+:run\(\)\.$'
```

When a public symbol changes across packages, the lead writes an impact block
before the code and checks `refs` at review (ADR 0065). Inside one package,
`vp check` and the tests are enough.

## The board: `TODO.md`

Work with more than one step runs from `TODO.md`. Its header defines the
lanes. The rules:

1. **Card first.** Name, next step, Verify line. Then code.
2. **One Doing card per lead.** Name the owner.
3. **Saved is not done.** Saved work waits in Review.
4. **Done needs proof you saw:**
   - code: `vp check` and the right tests green; for `core`, also
     `scripts/ticket.sh`;
   - a size or speed claim: `pnpm validate`; timing only via `bench`;
   - a bug fix: a test that fails without the fix;
   - "it works": the output that shows it.
5. **Keep it true.** Blocked names what is missing. Parked names what would
   restart it. Never start parked work just to clear the board.

Ticket detail and proof go in the track's `docs/roadmap/<track>/PROGRESS.md`.

## Helper writers

The lead plans and reviews. A writer agent writes the code: the model named on
the card, one package per writer. The writer's fixed rules:
`docs/roadmap/contributor-brief.md`.

The lead, per ticket:

1. Write the brief: the fixed part, plus the target (and the impact block,
   when there is one).
2. Review: `node tools/jev/review.mjs main..HEAD` shows where to read first.
   Read the diff. Ask for one fix round.
3. Land: re-run every gate by exit code. Fast-forward `main`. Run the
   package's mutation lane alone (floor 75; core and react 85). Push.
   Remove the worktree and branch.
4. Record Core feedback in `docs/roadmap/core-feedback.md`. A row becomes a
   core ticket at its second asker, or at once if the workaround is dishonest.

## Jev: advisory judges

Jev is a model that answers one yes/no question about one piece of code our
own code picked out. Advisory means: it points, it never blocks. What each
judge asks: `tools/jev/README.md`.

- **Writer:** run the steps in the brief. Each flag gets one label with a
  `--why`. That label is the answer.
- **Lead:** label a flag when you disagree with the writer's label.
- **At every landing that adds labels:** `node tools/jev/calibrate.mjs`, then
  commit `calibration.json` (ADR 0054).
- Never add a per-ticket rule to `tools/jev`. If plain code can check it,
  plain code does.
