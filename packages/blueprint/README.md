# @tinker/blueprint

A blueprint is a YAML declaration file for a tinker app: a `.d.ts` for the
app — a TypeScript declaration file that names things, their kinds, and
their links, with no bodies — plus one promise sentence per node. It names
every unit, its kind, and its links, before any code exists. `blueprint`
judges a blueprint file with Jev over question templates shipped in the
package, and suggests which unit a sentence fits before you write the node.

## The agent loop

Write the blueprint before the code: `suggest` for a sentence you are
unsure about, write the file, `check` it, fix the text `check` flagged,
`check` again, then write the code the file describes.

**1. `suggest` — which unit fits a sentence.**

```bash
node packages/blueprint/dist/main.mjs \
  suggest "poll the API every 10s and keep the latest list"
```

```text
unit:    resource (98%)
shape:   const x = resource({ label: "x", target,
  depends, factory: (deps, { defer, signal }) => {
  …; defer(() => stop()); return api; } })
target:  scope (83%)
all:     resource 98%, data 2%, tag 0%, operation 0%
```

**2. Write the file**, one node per unit, in the shape `suggest` named:

```yaml
- tag:
    name: pollUrl
    promise: the API URL; rebound in tests
    why: the only environment choice the poll needs
- resource:
    name: latest
    depends: [pollUrl]
    promise: the latest list, refreshed every 10s
    why: the view reads the freshest list
      without polling itself
```

**3. `check` it:**

```bash
AI_GATEWAY_API_KEY=… node \
  packages/blueprint/dist/main.mjs check poll.yaml
```

```text
~effectWithoutDefer  latest  a timer, watch,
  listener, or stream is started and its stop
  is manual or missing (55%)
~needsDefer  latest  it holds something that
  must be released, and neither promise nor
  work says it is released (55%)
ok: 2 nodes, 2 findings
```

**4. Fix the text** — name the release `check` asked for, in `promise`:

```diff
-    promise: the latest list, refreshed every 10s
+    promise: the latest list, refreshed every 10s;
+      the poll stops on defer
```

**5. `check` again:**

```text
ok: 2 nodes, 0 findings
```

**6. Write the code** the file describes: one `resource("latest", …)` with
a `defer(() => stop())` in its factory, depending on the `pollUrl` tag.

## The file format

- A blueprint is a YAML list of nodes.
- The kind is the key: `data`, `resource`, `operation`, or `tag`. A name is
  a node; `depends` names nodes exactly.
- Each node carries `name`, `promise`, and `why`; `why` is required — a
  missing or borrowed reason is how a redundant or misused unit shows
  itself.
- `depends` names nodes exactly; it defaults to `[]`.
- `work` says what the unit does in one line, where it helps.
- `target` lives on `resource` only: `scope` or `session`; it defaults to
  `scope`.
- A name holds letters, digits, and `_`. A dot in a name is an error.
- Unknown keys are an error: a typo is a typo.
- Nodes keep file order. `uses` reads what a node names; `usedBy` reads
  what names it. A name nothing has, or a dangling `depends` entry, reads
  as no nodes — `uses`/`usedBy` never throw.

The ADR's own example (`docs/decisions/0052-*.md`):

```yaml
- tag:
    name: dbPath
    promise: the db path; rebound in tests
    why: the only environment choice the store has
- resource:
    name: db
    depends: [dbPath]
    promise: one client per scope
    why: one connection for the process
- data:
    name: issueList
    promise: the saved issues; one writer
    why: the view reads it; saveIssue is the only writer
- operation:
    name: saveIssue
    depends: [db, issueList]
    promise: one saved issue lands in issueList
    why: writes go through db so the view never re-lists
    work: insert in db; update issueList
```

## check

- The key: `AI_GATEWAY_API_KEY`, or `--key-file <path>`. Never printed.
  With no key, `check` fails `NoKey`.
- The file argument is the first argv entry that is not a flag and is not
  `--key-file`'s value.
- `--json` prints the report as one JSON object and nothing else.
- Plain output is one line per finding, then a summary line:

```text
dataNoWriter   issueList  no operation
  or resource depends on it
~unitFits      saveIssue  reads as
  resource (72%)
ok: 5 nodes, 2 findings
```

- A **boolean** template hits at or above its `threshold`. A **choice**
  template hits when the pick differs from the node's `compare` field, at
  or above `minConfidence`; below `minConfidence`, or a pick that matches
  `compare`, makes no finding. A pair template's `node` prints as
  `"a, b"`, in file order — in plain output and in `--json`.
- **`~`** marks a hit from a template that is not `proven`: it prints, it
  never sets the exit code.
- A hit blocks (sets the exit code) when its template is `proven`, or it
  is a plain check — `unknownDepends`, `duplicateName`, `dataNoWriter` —
  which always blocks.
- **Exit 0** — clean, or every finding is `~` (this is what the shipped
  corpus answers for the ADR example when the judge says no to
  everything).
- **Exit 1** — a plain check failed, a `proven` template hit, or no key.
- **Exit 2** — the file is not a blueprint: a non-blueprint yaml file, or
  a schema failure, prints usage.

## explain, evals

- `explain` prints every template verbatim, one block per template, a
  blank line between; `explain --md` prints the same as a markdown list.
  A choice template's shape (see "The corpus" below) prints as
  `shape.<option>: <text>`, right after that option's meaning:

```text
resource: something that subscribes, listens, polls,
  connects, opens, or streams; built once; cleanup is defer
shape.resource: const x = resource({ label: "x", target,
  depends, factory: (deps, { defer, signal }) => { …;
  defer(() => stop()); return api; } })
```

- `evals` grades every shipped template against its evals with the judge
  — the same code path `vp test` runs when a key is present (it skips the
  whole file otherwise). With no key, the cli row fails `NoKey`, same as
  `check`. `✓` proven, `~` provisional, `✗` noisy, then the numbers
  behind the grade, ending with the golden hits (`hits/cases`):

```text
✓ runForwardsToClosure  proven  bad 5
  (med 88%)  clean 7 (med 12%)  sep
  76%  ordered 100%  golden 0/2
~ whyDuplicate  provisional  bad 2
  (med 70%)  clean 4 (med 40%)  sep
  30%  ordered 75%  golden 0/10
✗ needsDefer  noisy  bad 5 (med 55%)
  clean 7 (med 60%)  sep -5%
  ordered 25%  golden 1/2 (tx)
```

## The corpus

- A template is one YAML file in `corpus/`: `id`, `scope` (`node` or
  `pair`), `applies` (node kinds), `needs` (state fields: `kind`, `name`,
  `promise`, `why`, `depends`, `work`, `target`, `uses`, `usedBy`),
  `status` (`provisional` or `proven`), `ask`, plus `true`/`false`
  (`kind: boolean`) or `choices` (`kind: choice`).
- `check` asks a `node`-scope template once per node its `applies` names.
  It asks a `pair`-scope template once per unordered pair of nodes whose
  kinds both match `applies` — three tag nodes make three pairs.
- A choice template may carry `compare` (the node field its pick is
  measured against — `unitFits` compares `kind`, `target` compares
  `target`) and `shapes` (one target-shape string per choice, printed by
  `explain` and by `suggest`). `shapes`'s keys must equal `choices`'s
  keys, else the load fails `InvalidTemplate`.
- An `applies` entry outside the four kinds, or a `needs` entry outside
  the nine fields, fails the load with `InvalidTemplate`.
- The corpus loads every `*.yaml` once per scope, sorted by id. A node-scope
  template sits under `forKind(kind)`; a pair-scope template sits under
  `pairs` and never in a `forKind` list.
- `corpusPath` names the folder: the shipped `corpus/` by default; a test
  rebinds `corpusPath` to a fixture folder — `check`/`explain` then load
  that folder's templates instead of the shipped ones.
- To add a template: write a new `corpus/<id>.yaml` with the fields
  above, then a matching `evals/<id>/{bad,clean}/*.yaml` pair (below). A
  new template's `status` starts `provisional`.

### `suggest`

- `suggest "<words>"` asks `unitFits` once about the sentence; on a
  confident `resource` pick, it asks `target` once more. Empty words fail
  `NoWords` (exit 2, a parse failure).
- `unit:`/`target:` print `<pick> (<pct>)` at or above the template's
  `minConfidence`, else `unclear (<pick> only <pct>) — decide with the
one law` (`unit:`) or `unclear (<pick> only <pct>)` (`target:`).
- `shape:` prints the picked unit's shape text, only on a confident pick.
  `target:` prints only for a confident `resource` pick.
- `all:` lists every choice's share, widest first.
- A confident `resource` pick prints all four lines — `unit:`, `shape:`,
  `target:`, `all:` — as the "The agent loop" example above shows.

## Evals

- Every template ships with evals under `evals/<id>/{bad,clean}/*.yaml`
  — at least 2 bad and 2 clean files each, 5 and 5 before a status can
  read `proven`.
- One eval file: `target` (a node name, or `[a, b]` for a pair template),
  `expect` (a boolean, or the option name a choice template should
  pick), and `blueprint` (the same node list a blueprint file holds).
- A `bad` file shows one distinct way the template's defect appears; a
  `clean` file is a near-miss with no defect.
- `readEval` parses one file, strict; a bad file fails with `InvalidEval`
  (file, issues).

```yaml
# evals/runForwardsToClosure/bad/forwards.yaml
target: saveIssue
expect: true
blueprint:
  - resource:
      name: tx
      promise: one transaction per session
      why: the request commit is the save
  - operation:
      name: saveIssue
      depends: [tx]
      promise: given input, one saved issue
      why: writes go through tx
      work: hand ctx to saveIssueImpl
        and return what it returns
```

- **The grade** (`gradeTemplate`): asks the judge about every eval's
  target with only that template's question, then scores each case — a
  boolean's own probability, or a choice's `1 - probabilities
[declaredKind]` (0 when the judge's answer is missing). `bad` cases
  should score high, `clean` cases low.
- **sep** — `median(bad) - median(clean)`; `median` sorts its values
  numerically, never lexicographically, before taking the middle one.
  **ordered** — the share of
  (bad, clean) pairs where bad outranks clean.
- **The golden design** — `evals/golden.yaml`, a copy of
  `examples/tracker.yaml`. Every node (or, for a pair template, every
  matching unordered pair) it applies to becomes one more clean case,
  folded into `clean` for `sep`/`ordered`; a golden case that would have
  been a real finding is a **hit**, named in `goldenHits`.
- **proven** — at least 5 bad and 5 clean cases, sep ≥ 0.30, ordered ≥
  0.90, and no golden hit at all.
- **noisy** — a golden hit exists (whatever the case count — a hit on
  the golden design outranks all), or enough cases on each side but the
  bar is missed.
- **provisional** — no golden hit and fewer than 5 cases on a side
  (golden cases count toward the total).
- A status flips from `provisional` to `proven` **by hand**, after 5 bad
  and 5 clean cases grade `proven` with the golden set clean — the seed
  cases are the template author's own; they are a floor, not a proof.

### What is proven

Graded against the shipped evals with a real key (`vp run
blueprint#test`); the date is when this table was last pasted. Nothing
is `proven` yet: every seed ships with 2 bad and 2 clean cases, below
the 5-a-side floor, and two templates already hit the golden design once
(`examples/tracker.yaml`) — the reason the floor moved from 2 to 5 and
gained the golden veto.

2026-09-21 — every seed `provisional`, except the two the golden design
vetoed (`noisy`: a golden hit always reads `noisy`, whatever the case
count):

- **configNotTag** — sep 0.65, ordered 1.00, golden 0/3
- **dataManyWriters** — sep 0.67, ordered 1.00, golden 0/1
- **effectWithoutDefer** — sep 0.90, ordered 1.00, golden 0/3
- **handRolledLifetime** — sep 0.76, ordered 1.00, golden 0/3
- **hiddenNode** — sep 0.59, ordered 1.00, golden 0/3
- **manualSession** — sep 0.87, ordered 1.00, golden 0/1
- **needsDefer** — sep 0.71, ordered 1.00, golden 0/2
- **parseNotAtDoor** — sep 0.77, ordered 1.00, golden 0/1
- **publishTwice** — sep 0.86, ordered 1.00, golden 0/1
- **runForwardsToClosure** — sep 0.77, ordered 1.00, golden 0/1
- **scopeInsideUnit** — sep 0.83, ordered 1.00, golden 0/3
- **stateOutsideCell** — sep 0.67, ordered 1.00, golden 0/3
- **stopOnlyInDefer** — `noisy`: sep 0.62, ordered 1.00, golden 2/2
  (db, tx)
- **target** — sep 0.88, ordered 1.00, golden 0/2
- **unitFits** — sep 0.72, ordered 1.00, golden 0/5
- **whyDuplicate** — `noisy`: sep 0.61, ordered 1.00, golden 2/10
  (tx/saveIssue, issueList/saveIssue)
- **whyUnfulfilled** — sep 0.42, ordered 1.00, golden 0/5

## Errors

- **InvalidBlueprint** — the text is not yaml, or a node breaks the
  schema (an unknown key, a missing `why`, a dotted name). Carries the
  zod issues.
- **InvalidTemplate** — a corpus file is not yaml, breaks the schema, or
  a choice template's `shapes` names a key `choices` does not. Carries
  the file and the issues; the message names both.
- **InvalidEval** — an eval file is not yaml, breaks the schema, names a
  `target` no node in its own blueprint has, or (a pair template) is
  missing its second name. Carries the file and the issues.
- **BlueprintRejected** — a plain check or a `proven` template blocked.
  Carries the finding lines; the message holds one line per finding.
- **NoKey** — `check`, `evals`, or `suggest` ran with no
  `AI_GATEWAY_API_KEY` and no `--key-file`.
- **JevUnavailable** — the judge gave up after five rate-limit retries.
- **NoWords** — `suggest` ran with empty words.
- **NoTemplate** — `suggest` needs `unitFits` or `target` in the loaded
  corpus; only reachable with `corpusPath` rebound to a folder missing
  one of the shipped seeds.

## Running check

```bash
AI_GATEWAY_API_KEY=… node \
  packages/blueprint/dist/main.mjs \
  check examples/tracker.yaml
node packages/blueprint/dist/main.mjs \
  check --key-file ~/.key \
  examples/tracker.yaml
node packages/blueprint/dist/main.mjs \
  check --json examples/tracker.yaml
```
