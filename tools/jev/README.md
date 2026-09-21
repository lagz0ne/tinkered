# Jev in this repo — what each tool asks, and what the answers mean

Jev is a model that answers one narrow question at a time: a yes/no with a probability, or a pick from a
short list. It never writes text, never locates anything, and never counts. Every tool here has two
halves: **extraction** (our code finds the thing to ask about: a unit, a test, a file, a README line) and
**the question** (Jev answers about that one thing). Extraction is deterministic; today it is regex over
source text, and moving it to a real parser is the open card `jev/ast-extraction`.

Everything is **advisory**. Nothing here exits non-zero on a finding. The truth stays `vp check`, the tests,
the mutation lanes, SCIP, and the lead. A `~` in any output marks a judge that calibration found noisy:
read it, no line owed.

## The tools, in plain words

| tool                               | you run it                    | it extracts                                                                          | it asks Jev                                                                                 | a hit means                                     |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `preflight.mjs <range>`            | before you report             | every changed source file, then every unit in them                                   | the file judges, then the unit judges                                                       | fix it or write one line why not; then label it |
| `review.mjs <range>`               | the lead, at review           | the changed files, the whole diff, the commit message                                | the file judges; a route pick ("look first at correctness / shape / …"); an overclaim check | where to read first                             |
| `lint.mjs <files>`                 | any time                      | each declared unit (`data`/`resource`/`operation`/`tag`) and each top-level function | the unit judges; and "which unit should this be?"                                           | a shape smell on that unit                      |
| `tests.mjs <pkg>`                  | when you touched tests        | each `test("…")`: title and body; title-similar pairs in a file                      | four test judges; one pair judge                                                            | a test to delete, merge, or explain             |
| `promises.mjs <pkg>`               | when you touched tests        | each test title; the README lines sharing words with it                              | "which README line promises this? or none"                                                  | a promise the README never states               |
| `impact.mjs <tag>`                 | the lead, at review           | the plan's `impact` block vs SCIP refs                                               | one boolean per mismatch: plan wrong or source wrong?                                       | where the blast radius drifted                  |
| `guide.mjs "<words>"`              | while designing               | your words, or one unit                                                              | "which unit fits?"                                                                          | a suggestion, not a verdict                     |
| `plan-check.mjs <md>`              | before delegating             | a plan or ADR                                                                        | upfront smells (uncalibrated)                                                               | look here                                       |
| `label.mjs <judge> <bool> <where>` | after each decided flag       | the exact state the judge saw                                                        | nothing — it stores your verdict                                                            | one more calibration case                       |
| `calibrate.mjs`                    | the lead, every ~10 new cases | every labeled case                                                                   | every judge, on every case                                                                  | `proven` / `provisional` / `noisy` per judge    |
| `explain.mjs [--md]`               | when this file confuses you   | nothing                                                                              | nothing — prints the live question bank                                                     | the questions, verbatim                         |

## How to read a probability

Jev returns a probability per boolean. A judge's `threshold` (0.5 everywhere today) turns it into a hit.
Probabilities are **not comparable across judges**: 60% on one question is not "weaker" than 80% on another.
Calibration is what makes a threshold mean something: `proven` says that on labeled cases the judge puts true
cases above false ones by 30 points or more, 90% of the time.

## The workflow around it

1. Writer: pre-flight, then `tests.mjs` and `promises.mjs` on touched packages. Every non-`~` hit: fixed or
   explained in one line, then labeled (`label.mjs … true` for fixed, `… false` for explained).
2. Lead: `review.mjs` on the branch; each fix-round nit a judge covers gets labeled true.
3. Lead, every ~10 new cases: `calibrate.mjs`, commit `calibration.json`. Noisy judges demote to `~`.
4. Never gate on a judge that is not `proven`. Never add a rule for one ticket.

## The judges

Generated from the code by `node tools/jev/explain.mjs --md` — regenerate after editing `bank.mjs` or `lib.mjs`.

### file judges — review.mjs / preflight.mjs, one call per changed source file

| judge                 | status       | the question Jev is asked                                                                                                                                                   | `true` means                                                                | `false` means                                                              |
| --------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `partialStub`         | uncalibrated | Does the code leave required work unfinished — a placeholder body, a thrown not-implemented, or a TODO on the main path?                                                    | a required path is stubbed, throws not-implemented, or is marked TODO/FIXME | every required path has a real implementation                              |
| `memoKeyIgnoresInput` | uncalibrated | Is a cached or memoized result stored under a key that omits an input the result depends on, so a later call with a different value returns the earlier cached result?      | the key leaves out an input that changes the correct result                 | the key includes every input the result depends on, or there is no caching |
| `leakedInternal`      | provisional  | Does this file expose, through a public or exported API, a symbol whose name or role marks it as internal (helper, impl detail, underscore-prefixed, "internal", "unsafe")? | a public export exposes an internal-looking symbol                          | only intentionally-public symbols cross the public surface                 |

### unit judges — lint.mjs / preflight.mjs, one call per declared unit or top-level function

| judge                    | status      | the question Jev is asked                                                                                                                                                                                                   | `true` means                                                                                              | `false` means                                                                                                                                            |
| ------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runForwardsToClosure`   | noisy       | Does the operation's run body hand its ctx, deps, controller, transaction, or database to a function declared outside the operation, which then does the real work?                                                         | run forwards ctx, deps, a controller, tx, or db to an outside function that does the job                  | run does its own reads and writes with its declared deps; any helper it calls takes only plain values                                                    |
| `effectWithoutDefer`     | noisy       | Does this code start ongoing work — a timer, interval, listener, subscription, poll, socket, or connection — and leave its stop outside any ctx.defer hook?                                                                 | ongoing work is started and its stop is a returned close method, a manual flag, or missing                | each started thing is stopped from a ctx.defer hook, or nothing ongoing is started                                                                       |
| `stateOutsideCell`       | provisional | Is state that other code reads over time — a selection, a filter, a draft, a status, a list — kept in a closure variable, module variable, object field, or ref with hand-made listeners, instead of a data cell?           | shared, watched state lives in a variable, field, or ref with its own listener set                        | shared state lives in data cells, or the variables are private bookkeeping behind this unit's methods                                                    |
| `configNotTag`           | proven      | Does this unit read an environment choice — a URL, port, path, flag, or feature switch — from process.env, a hard-coded literal, a struct field, or a closure argument instead of a tag in its depends?                     | an environment value comes from process.env, a literal, a field, or a parameter                           | environment values arrive through a tag in depends, or none are used                                                                                     |
| `handRolledLifetime`     | noisy       | Does this code manage when work is done or stopped by hand — a done or closed boolean, a promise tail or waiter, a queue of pending callers, or a map of senders — where a scope's signal, defer, ready, or close would do? | manual flags, promise chains, queues, or maps decide when work is done or stopped                         | cancellation goes through ctx.signal, cleanup through defer, waiting through ready or close, or there is no lifetime to manage                           |
| `stopOnlyInDefer`        | provisional | Is running work stopped only from inside a ctx.defer hook, with ctx.signal ignored, so a forced close waits on work that only defer would stop?                                                                             | the only stop for in-flight work is set from defer; the signal is never consulted                         | in-flight work watches ctx.signal or calls throwIfAborted so close can end it, or there is no in-flight work                                             |
| `ignoresAbortAfterAwait` | provisional | Look at each await in this factory. Is any await followed by a call that starts new work — a query, a subscribe, a send, a build — with no signal.throwIfAborted() or signal.aborted check between the await and that call? | at least one await is followed by new work and no signal check sits between them                          | every await that is followed by new work has a signal check first, or no work follows any await                                                          |
| `readsMoreThanRendered`  | provisional | Does this component read a whole list or collection from a cell with useData, and then use only one item of it — found by id, key, or index — with no selector argument?                                                    | useData(cell) returns a whole list and the component picks one item out of it by id, key, or index        | useData gets a selector for the item, the component renders the list it reads, or the cell holds a single record or form draft whose fields are rendered |
| `subscribesToWriteOnly`  | provisional | Does this component subscribe to a cell it only writes — useData, or useData with writable — where the read value never appears in the output?                                                                              | a cell is read with useData but only its setter is used; the value is never rendered                      | every value read is rendered, or write-only access goes through useController                                                                            |
| `runDuringRender`        | provisional | Does this component call run, runAsync, set, or update directly in its render body — outside any event handler, callback, or effect?                                                                                        | a run or a cell write sits in the function body and executes on every render                              | every run or write is inside an onClick, onChange, onSubmit, or other callback                                                                           |
| `domainLogicInRender`    | provisional | Does this component decide a domain rule itself — a conflict, a merge, validity against saved data, a revision check — instead of rendering a notice or flag that an operation wrote to a cell?                             | the component compares saved and draft data or applies a business rule to decide what happens             | the component renders cells plus view-only formatting (labels, disabled while pending, empty-text checks); rules live in operations                      |
| `effectOwnedByComponent` | provisional | Does this component itself start a fetch, timer, listener, socket, or stream — in its body or in a handler — instead of running an operation with useRun or reading a resource?                                             | fetch, setInterval, setTimeout, addEventListener, EventSource, or a websocket is created in the component | the component only runs operations with useRun and reads cells or resources                                                                              |

### test judges — tests.mjs, one call per test

| judge           | status       | the question Jev is asked                                                                                                                                                                                | `true` means                                                                                                                  | `false` means                                                                                       |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `helperAlone`   | uncalibrated | Does this test exercise a builder, guard, reader, or helper by itself — constructing a value and asserting its fields — instead of a behaviour that uses it through the public seam?                     | the test's subject is a helper's own output (a built record, a guard's boolean, a reader's parse) with no behaviour around it | the test runs a behaviour a user could trigger and asserts its outcome; helpers are only on the way |
| `manyCauses`    | uncalibrated | Does this test bundle two or more unrelated causes — separate inputs whose outcomes do not depend on each other — so that it names more than one promise?                                                | several independent set-ups each with their own assertions, joined only by the test body                                      | one cause and one decisive outcome, possibly checked by several short assertions                    |
| `typeGuarantee` | uncalibrated | Does this test assert something the TypeScript types already guarantee — a literal discriminant right after constructing that variant, a field equal to the argument that set it, a return type's shape? | an assertion that cannot fail once the code compiles                                                                          | every assertion checks a runtime outcome the types leave open                                       |
| `negativeTwin`  | uncalibrated | Does this test prove only the absence of an unrelated failure or the falsity of a guard (a negative twin), adding nothing a positive test did not already prove?                                         | the decisive assertion is that some other error did not happen or that a guard returns false                                  | the decisive assertion is a promised value, state, or event                                         |

### test pair judge — tests.mjs, one call per title-similar pair in a file

| judge                 | status       | the question Jev is asked                                                                                                                                                                                           | `true` means                                                        | `false` means                                |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| `reprovesSamePromise` | uncalibrated | Do these two tests prove the same shipped promise — the second merely checking it again from another angle (count then contents, toBe then toEqual, positive then negative), so that deleting one loses no promise? | one promise, two tests; deleting either keeps every promise covered | each test names a promise the other does not |

### guide — guide.mjs, one pick per unit or description

**`unit`** — Which @tinker/core unit fits this code or description?

- `data`: a piece of state kept and read over time — a form field, a draft, a filter, a selection, a notice, a list — written by operations or a driver
- `resource`: something that subscribes, listens, polls, connects, opens, or streams; built once per owner; needs cleanup
- `operation`: something a user, request, CLI, or tool asks for; runs once per call with typed input; may have effects
- `tag`: an environment choice — a URL, path, flag, or setting — bound at the root and rebound in tests
- `glue`: a plain function that takes values in and returns a value, keeps no state and starts no effect; or wiring at the composition root
- `view`: a React component: reads cells with useData, runs operations with useRun, renders; owns no state and no effect

**`target`** — For a resource: one instance for the whole scope, or one per session?

- `scope`: one shared instance for the process: a database, a server, a cache, a pool, a wire
- `session`: one per request, tab, call, or turn: a transaction, a request context, per-call state

**`needsDefer`** — Does this start or hold something that must be stopped, closed, or rolled back when its owner closes?

- `true`: a connection, timer, listener, transaction, or buffer must be released at close
- `false`: it computes or reads values only; nothing to release
