# 0052 Blueprint: a declaration file for a tinker app, judged by Jev over shipped question templates

Date: 2026-09-21. Status: accepted. Builds on: 0047 (Jev judges one narrow thing our code picked
out), 0049 (the one law: every unit is a `data`, a `resource`, an `operation`, or a `tag`), 0051
(a driver is an extension; the composition root is the only hand on the scope).

## Context

An agent that solves a problem on `@tinker/*` often does not know the library well. It writes code
first and learns the one law from review. `tools/jev/guide.mjs` answers "which unit fits?" for one
piece, but nothing looks at the whole design before code exists, and `tools/jev` is repo tooling: it
reads this repo's files and cannot be shipped.

**The analogy is a TypeScript `.d.ts` file.** A declaration file names things, their kinds, and
their links — and has no bodies. A blueprint is a `.d.ts` for a tinker app, plus one promise
sentence per node. Ours is simpler: no types; only unit kinds, edges, a promise, and the work in
one line.

## Decision

1. **A blueprint is a YAML list of nodes.** The kind is the key; `name` is a field. A name is a
   node; a dot in a name is an error; `depends` names nodes exactly. A bundled library unit (a
   frame such as drizzle's `store`) is written as its parts: the blueprint shows the intention and
   the wiring, not the library. Every node carries `promise` (what it guarantees) and `why` (why
   it exists and why it needs its `depends`); `why` is required, because a missing or borrowed
   reason is how a redundant or misused unit shows itself. Zod parses every node at the door
   (ADR 0006); the parsed node is the only state a question ever sees.

   ```yaml
   - tag:
       name: dbPath
       promise: the db path; rebound in tests
       why: the only environment choice the store has
   - resource:
       name: db
       depends: [dbPath]
       promise: one client per scope; closed by defer
       why: one connection for the process
   - resource:
       name: tx
       depends: [db]
       target: session
       promise: one transaction per session; commit on close
       why: the request commit is the save; no manual commit
   - data:
       name: issueList
       promise: the saved issues; one writer
       why: the view reads it; saveIssue is the only writer
   - operation:
       name: saveIssue
       depends: [tx, issueList]
       promise: given input, one saved issue lands in issueList
       why: >-
         writes go through tx so the commit is the
         save; issueList is updated here so the
         view never re-lists
       work: >-
         parse input; insert in tx;
         update issueList with the returned row
   ```

2. **The corpus is a set of question templates, shipped inside the package.** One YAML file per
   template: `id`, `applies` (which kinds), `needs` (which node fields), `ask`, `true`, `false`.
   No string holes: Jev's `evaluate()` takes `{ state, questions }`; the state is the node and its
   one-hop neighbours (`uses`: the nodes it names in `depends`; `usedBy`: the nodes that name it);
   the question text is fixed. A template whose `applies` or `needs` names something the zod
   schema lacks fails to load. New facts enter by a commit to `packages/blueprint/corpus/`, not
   by a runtime overlay.

3. **Every template ships; the result list is wide.** Unit fits, one promise, target
   (scope/session), needs defer, every pitfall from `tools/jev/bank.mjs`'s unit judges and
   `docs/best-practices.md` rules 3–15 that a design can show, a hidden node (work that starts an
   effect or keeps state with no node of its own), one writer per `data`, and two on `why`: does
   `why` name a reason that a dep in `depends` fulfils (a borrowed or empty reason marks misuse),
   and do two nodes carry the same `why` (a redundant unit). Mismatches are filtered later by
   evals and labels, not by shipping fewer questions.

4. **Plain code checks first, in the same list.** Unknown `depends` name, duplicate `name`, a
   `data` node with zero writers. These cost no call and never carry a percent.

5. **Evals ship in the package and decide who may block.** `evals/<id>/{bad,clean}/*.yaml`, each
   a small blueprint with `target` and `expect`. `vp test` runs them when a key is present, skips
   when not. Bar: bad ≥ 50%, clean < 50%, gap ≥ 30 (the `tools/jev` bar). `blueprint check`
   exits 1 on a plain-code failure or a hit from a template whose evals pass; every other hit
   prints with `~` and never sets the exit code.

   *Amended 2026-09-21, after the first real run.* With 2 bad + 2 clean cases per template — the
   template author's own — every template graded `proven`, and the ADR's own example
   (`examples/tracker.yaml`) then failed `check` with seven blocking hits at 50–57%. So:
   `enough` is 5 bad and 5 clean; `evals/golden.yaml` (the ADR example, a known-clean design)
   adds every applicable node as a clean case for every template, and one golden hit makes the
   grade `noisy`; a `status: proven` is set by hand, only after cases labeled against real
   designs reach that bar. The seed cases are a floor, not a proof; every shipped template is
   `provisional` until then.

6. **The binary is a tinker app.** `packages/blueprint` (`@tinker/blueprint`, bin `blueprint`)
   is built on `@tinker/core` + `@tinker/cli` and imports nothing from `tools/jev`. The corpus
   and the judge are resources; `check`, `explain`, `suggest` are operations; the Jev engine is a
   tag `{ model, apiKey }` filled at the root from `AI_GATEWAY_API_KEY` or `--key-file`; tests bind
   a `preset` judge with fixed answers. With no key, `check` fails: there is nothing to judge.

## Consequences

- An agent's loop becomes: write the blueprint → `blueprint check` → fix the text → check again →
  then write code. The library knowledge lives in the corpus, not in the agent.
- `tools/jev/guide.mjs` and the `GUIDE` bank become the first templates; `guide.mjs` stays in the
  repo until `suggest` lands, then is removed (a repo tool, not a public symbol; no SCIP table owed).
- Checking code against a blueprint (integrity) is a later decision; the zod schema and the
  parsed node tree are what make it cheap.
- The file is the source of a picture: flat nodes, exact edges, `why` on every node. A devtool
  extension that draws and edits the graph is a parked card, not part of v1.

## Alternatives rejected

- A custom line format (`operation saveIssue` + indented fields): reads well, needs its own
  parser and gives no tree for later integrity checks.
- Free-prose corpus files as Jev context: a broad, multi-hop read, which the model is weak at.
- String-hole templates (`{name}`, `{work}`): a second parser and quoting bugs; `evaluate()`
  already separates state from question.
- A project-local corpus overlay with a `learn` command: two truths for one question set; add only
  when a second project asks.
- Dotted names or a `frame` node kind for bundled library units: the blueprint would point at a
  library instead of showing the wiring; one more kind can be added later without changing flat
  files.
- `why` as optional: an optional reason is the first field an agent skips, and it is the field
  that shows a redundant or misused unit.
