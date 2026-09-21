# @tinker/blueprint

A blueprint is a YAML declaration file for a tinker app.
It names the units, their kinds, and their links, plus one promise per node.
`blueprint check` runs the plain checks over one file,
then judges every node and pair with Jev over the
shipped question templates.

## The file format

- A blueprint is a YAML list of nodes.
- The kind is the key: `data`, `resource`, `operation`, or `tag`.
- Each node carries `name`, `promise`, and `why`.
- `depends` names nodes exactly; it defaults to `[]`.
- `work` says what the unit does in one line, where it helps.
- `target` lives on `resource` only; it is `scope` or `session.
- It defaults to `scope`.
- A name holds letters, digits, and `_`.
- A dot in a name is an error.
- Unknown keys are an error: a typo is a typo.
- Nodes keep file order.
- `uses` reads what a node names;
  `usedBy` reads what names it.

```yaml
- tag:
    name: dbPath
    promise: the db path; rebound in tests
    why: the only environment choice
      the store has
- resource:
    name: db
    depends: [dbPath]
    promise: one client per scope
    why: one connection
      for the process
- data:
    name: issueList
    promise: the saved issues; one writer
    why: the view reads it; saveIssue
      is the only writer
- operation:
    name: saveIssue
    depends: [db, issueList]
    promise: one saved issue lands
      in issueList
    why: writes go through db so
      the view never re-lists
    work: insert in db; update issueList
```

## The corpus

- A template is one YAML file
  in `corpus/`: `id`, `scope`,
  `applies`, `needs`, `ask`,
  plus `true` / `false`
  (boolean) or `choices`
  (choice).
- A choice template may carry
  `compare`: the node field its
  pick is measured against.
  `unitFits` compares `kind`;
  `target` compares `target`.
- `scope` is `node` or `pair.
- `applies` names node kinds;
  `needs` names state fields
  the question reads: `kind`,
  `name`, `promise`, `why`,
  `depends`, `work`, `target`,
  `uses`, `usedBy`.
- An `applies` entry outside
  the four kinds, or a `needs`
  entry outside the nine fields,
  fails the load with
  `InvalidTemplate`.
- The corpus loads every `*.yaml`
  once per scope, sorted by id.
- `corpusPath` names the folder:
  the shipped `corpus/` by default;
  a test rebinds it to a fixture.
- Every seed is `provisional`;
  evals (t04) flip it to `proven`.
- The 17 seeds:
  - **unitFits** — which unit fits:
    data, resource, operation, tag.
  - **target** — one copy per scope
    or one per session.
  - **needsDefer** — something must be
    released at close.
  - **runForwardsToClosure** — work hands
    the job to what depends misses.
  - **effectWithoutDefer** — a started
    thing is stopped by hand.
  - **stateOutsideCell** — shared state
    with no data node.
  - **configNotTag** — an environment
    choice no tag delivers.
  - **handRolledLifetime** — a waiting
    line the scope should own.
  - **stopOnlyInDefer** — running work
    stops only at close.
  - **scopeInsideUnit** — work calls
    the scope (rule 5).
  - **parseNotAtDoor** — input parsed
    past the door (rule 12).
  - **manualSession** — a session opened
    by hand (rule 14).
  - **publishTwice** — re-list after
    a save (rule 15).
  - **hiddenNode** — an effect or state
    with no node.
  - **dataManyWriters** — two writers
    for one data node.
  - **whyUnfulfilled** — why names what
    no dep fulfils, or repeats promise.
  - **whyDuplicate** — two nodes share
    one why (pair scope).

## explain

- `explain` prints every template
  verbatim: one block per template,
  a blank line between.
- `explain --md` prints the same
  as a markdown list: one
  `- **id** — ask` item, then
  indented lines for applies /
  needs / status / true / false
  or choices.

```bash
node packages/blueprint/dist/main.mjs \
  explain
node packages/blueprint/dist/main.mjs \
  explain --md
```

## Evals

- Every template ships with evals under
  `evals/<id>/{bad,clean}/*.yaml` — at
  least 2 bad and 2 clean files each.
- One eval file: `target` (a node name,
  or `[a, b]` for a pair template),
  `expect` (a boolean, or the option
  name a choice template should pick),
  and `blueprint` (the same node list
  a blueprint file holds).
- A `bad` file shows one distinct way
  the template's defect appears; a
  `clean` file is a near-miss with
  no defect.
- `readEval` parses one file,
  `.strict()`; a bad file fails with
  `InvalidEval` (file, issues).

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

## The grade

- `gradeTemplate` asks the judge about
  every eval's target with only that
  template's question, then scores
  each case:
  - **boolean** — the answer's
    probability.
  - **choice** — a choice template
    grades on `1 - probabilities
[declaredKind]`, where
    `declaredKind` is the node's own
    `compare` field; `0` when
    `probabilities` is absent.
- `bad` cases should score high,
  `clean` cases low. With at least
  2 of each:
  - **sep** — `median(bad) -
median(clean)`.
  - **ordered** — the share of
    (bad, clean) pairs where bad
    outranks clean.
- **proven** — sep ≥ 0.30 and
  ordered ≥ 0.90.
- **noisy** — enough cases on each
  side, but the bar is missed.
- **provisional** — fewer than 2
  cases on a side.
- The test's bar: a corpus file
  saying `status: proven` must grade
  `proven`. A `provisional` file that
  grades `proven` prints as "could be
  proven"; a `noisy` grade on a
  `provisional` file prints as
  "noisy". Neither fails the run.

## evals

- `evals` grades every shipped
  template against its evals with
  the judge — the same code path
  `vp test` runs when a key is
  present (it skips the whole file
  otherwise). With no key, the cli
  row fails `NoKey`, same as `check`.
- `✓` proven, `~` provisional,
  `✗` noisy, then the numbers
  behind the grade:

```text
✓ runForwardsToClosure  proven  bad 3
  (med 88%)  clean 3 (med 12%)  sep
  76%  ordered 100%
~ whyDuplicate  provisional  bad 2
  (med 70%)  clean 2 (med 40%)  sep
  30%  ordered 75%
✗ needsDefer  noisy  bad 2 (med 55%)
  clean 2 (med 60%)  sep -5%
  ordered 25%
```

```bash
AI_GATEWAY_API_KEY=… node \
  packages/blueprint/dist/main.mjs \
  evals
```

## The three plain checks

- **unknownDepends** — a `depends` entry names no node.
  One finding per missing name per node.
- **duplicateName** — two nodes share a `name`.
  One finding per repeated name.
- **dataNoWriter** — a `data` node that no `operation` or
  `resource` names in `depends`.
  The file cannot tell a read from a write.
  Any dependent operation or resource counts as a writer.

## Running check

- The key: `AI_GATEWAY_API_KEY`,
  or `--key-file <path>`.
  Never printed.
- The file argument is the first
  argv entry that is not a flag
  and is not `--key-file`'s value.
- With no key, `check` fails
  `NoKey`; `explain` still answers
  (it never asks the judge).
- `--json` prints the report as
  one JSON object and nothing else.
- Plain output is one line per
  finding, then a summary line:

```text
dataNoWriter   issueList  no operation
  or resource depends on it
~unitFits      saveIssue  reads as
  resource (72%)
~whyDuplicate  db, tx     same why
  as tx (81%)
ok: 5 nodes, 3 findings
```

- `~` marks a `provisional` template:
  it prints, it never sets the
  exit code.

## How a hit is decided

- **boolean** — the answer's
  probability is at or above
  the template's `threshold`.
- **choice** — the pick differs
  from the node's `compare` field,
  at or above `minConfidence`.
  Below `minConfidence`, or a pick
  that matches `compare`: no finding.
- A hit blocks (`blocking: true`)
  when its template is `proven`,
  or it is a plain check (always
  blocking).

## Exit codes

- **0** — clean, or every finding
  is `~` (provisional). Prints
  `ok: N nodes, M findings`.
- **1** — a plain check failed,
  or a `proven` template hit.
  Prints the finding lines on stderr.
- **1** — no key. Prints
  `blueprint: no key (set
AI_GATEWAY_API_KEY or
--key-file <path>)`.
- **2** — the file is not a blueprint.
  A yaml or schema failure prints usage.

## Errors

- **InvalidBlueprint** — the text is not yaml
  or a node breaks the schema.
  Carries the zod issues.
- **BlueprintRejected** — a plain check
  or a `proven` template blocked.
  Carries the finding lines; the message
  holds one line per finding.
- **InvalidEval** — an eval file is not
  yaml, breaks the schema, or names a
  `target` no node in its own blueprint
  has. Carries the file and the issues.
- **NoKey** — `check` or `evals` ran
  with no `AI_GATEWAY_API_KEY` and no
  `--key-file`.

## What is proven

Graded against the shipped evals with a
real key (`vp run blueprint#test`); the
date is when this table was last pasted.

- (filled in after the real run)

## Run it

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
