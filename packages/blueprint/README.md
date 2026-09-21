# @tinker/blueprint

A blueprint is a YAML declaration file for a tinker app.
It names the units, their kinds, and their links, plus one promise per node.
`blueprint check` runs the plain checks over one file.

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

## The three plain checks

- **unknownDepends** — a `depends` entry names no node.
  One finding per missing name per node.
- **duplicateName** — two nodes share a `name`.
  One finding per repeated name.
- **dataNoWriter** — a `data` node that no `operation` or
  `resource` names in `depends`.
  The file cannot tell a read from a write.
  Any dependent operation or resource counts as a writer.

## Exit codes

- **0** — clean; prints `ok: N nodes`.
  `check` answers the report: the node
  count beside the findings.
- **1** — a plain check failed.
  Prints one finding line per failure:

```text
unknownDepends  saveIssue  depends
  on "issueLst": no such node
dataNoWriter    issueList  no operation
  or resource depends on it
```

- **2** — the file is not a blueprint.
  A yaml or schema failure prints usage.

## Errors

- **InvalidBlueprint** — the text is not yaml
  or a node breaks the schema.
  Carries the zod issues.
- **BlueprintRejected** — a plain check blocked.
  Carries the finding lines; the message
  holds one line per finding.

## Run it

```bash
node packages/blueprint/dist/main.mjs \
  check examples/tracker.yaml
```
