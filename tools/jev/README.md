# Jev in this repo — what each tool asks, and what the answers mean

Jev is a model that answers one narrow question at a time: a yes/no with a probability, or a pick from a
short list. It never writes text, never finds anything, and never counts. Every tool here has two halves:
**extraction** — our own code finds the thing to ask about (a unit, a test, a file, a README line) — and
**the question** — Jev answers about that one thing. Extraction is plain code on a parser (`extract.mjs` on
oxc-parser), so the same input always yields the same pieces: units with kind, label, and dependency keys;
tests with title, causes, assertions, and narrowings; helpers; imports; exports. `promises.mjs` splits the
README by text, since a README has no syntax tree.

The `unitCouldBeModuleLevel` check is plain code. It finds core units made inside functions when their config does not use a function input or a local made from one. It runs without a model key, needs no calibration, and needs no label. Everything is **advisory**: it points, it never blocks. Nothing here exits non-zero on a finding. The truth
stays `vp check`, the tests, the mutation lanes, SCIP, and the lead. A `~` in any output marks a judge that
calibration found noisy: read it, no line owed. An `ℹ` mark is a note from the unit-kind classifier
(`reads like …`), not a judge hit: a hint, no fix and no label owed.

## The tools, in plain words

- **`preflight.mjs <range>`**
  You run it: before you report
  It extracts: every changed source file, then every unit in them
  It asks Jev: the file judges, then the unit judges
  A hit means: fix it or write one line why not; then label it

- **`review.mjs <range>`**
  You run it: the lead, at review
  It extracts: the changed files, the whole diff, the commit message
  It asks Jev: the file judges; where to look first (correctness / shape / …); does the commit message claim more than the diff shows?
  A hit means: where to read first

- **`lint.mjs <files>`**
  You run it: any time
  It extracts: each declared unit (`data`/`resource`/`operation`/`tag`) and each top-level function
  It asks Jev: the unit judges; and "which unit should this be?"
  A hit means: that unit likely breaks a best-practices rule

- **`tests.mjs <pkg>`**
  You run it: when you touched tests
  It extracts: each `test("…")`: title and body; title-similar pairs in a file
  It asks Jev: no Jev judge (titleVague retired 2026-09-23); plain notes only
  A hit means: a plain note to act on

- **`survivors.mjs <pkg>`**
  You run it: when lifting the mutation floor
  It extracts: each surviving mutant: before, after, and the enclosing unit
  It asks Jev: one survivor judge
  A hit means: a seam test to write

- **`promises.mjs <pkg>`**
  You run it: when you touched tests
  It extracts: each test title; the README lines sharing words with it
  It asks Jev: "which README line promises this? or none"
  A hit means: a promise the README never states

- **`impact.mjs <tag>`**
  You run it: the lead, at review
  It extracts: the plan's `impact` block vs SCIP refs
  It asks Jev: nothing — plain SCIP diff (ADR 0054)
  A hit means: a file the plan named or the code touched, not both

- **`docs.mjs <files or globs>`**
  You run it: when you touched docs
  It extracts: each TSDoc block and the declaration it sits on
  It asks Jev: nothing — S26, the parser only (`docRestatesCode` retired 2026-09-28)
  A hit means: a doc to fix

- **`label.mjs <judge> <bool> <where>`**
  You run it: after each decided flag
  It extracts: the exact state the judge saw
  It asks Jev: nothing — it stores your verdict
  A hit means: one more calibration case

- **`label.mjs --merge`**
  You run it: when the bank conflicts
  It extracts: the file: marker lines, one row per id
  It asks Jev: nothing — rewrites the file in place
  A hit means: one union bank, first id wins

- **`calibrate.mjs`**
  You run it: the lead, every ~10 new cases
  It extracts: every labeled case
  It asks Jev: every judge, on every case
  A hit means: `proven` / `provisional` / `noisy` per judge

- **`explain.mjs [--md]`**
  You run it: when this file confuses you
  It extracts: nothing
  It asks Jev: nothing — prints the live question bank
  A hit means: the questions, verbatim

Which unit fits my words? → `blueprint suggest "<words>"` (`packages/blueprint`).

`preflight.mjs` skips the file judges on a file over 100,000 characters (`MAX_CALL_CHARS` in `lib.mjs`).
One call cannot carry it: core's `index.ts` failed with `max_tokens_exceeded`.
It prints `skipped: too big for one call`, still judges that file's units, and exits 0.
`review.mjs` skips the same way.

Plain rules: `plain.mjs` checks the census rules the writer guidelines share (T01–T08, S02, S05, S06, S12, S13) on the syntax tree and its comment list, so text inside a string never counts. S17 (a type assertion in source, except `as const` and `[] as T[]`) and S18 (a `data`, `operation`, `resource`, or `tag` call from `@tinker/core`, or a `family` call from `@tinker/sync`, inside a function; a driver's `extension` is left out, ADR 0051) run in writer mode only: the gate asks for them; the repo's own lint does not.
S19 (a helper whose parameter type holds a controller, scope, or session) also has a repo lane, below. Arrow and function-expression consts are units in every file, like `function` declarations. A helper function's unit also carries `uses`: the lines of its own file that call it, so a judge sees what happens to the value it returns.
`lint.mjs` lists its rows; the writer-trial gate blocks on each one (ADR 0068).

### Hand-rolled rules (S20–S25)

Each finds code that builds by hand what tinker already gives.
Source: the 2026-09-27 survey (`docs/roadmap/jev-handrolled/`).
Test files never count.
S21 counts only inside a unit body, in both lanes.
The writer gate reads the other rules over the whole file.
The repo lint is narrower, and it only lists: it never fails.
Each message ends with its fix line.

- **S20 rawRandom** — `Math.random`, `crypto.randomUUID`, or `crypto.getRandomValues` (called or passed), or `randomUUID` from `node:crypto`.
  Repo lint: every file but `packages/core/src`.
  Fix: `id: ctx.random.uuid()`.
- **S21 rawClock** — a call of `Date.now`, `performance.now`, `setTimeout`, or `setInterval`, or a bare `new Date()`.
  Both lanes: only inside a unit body (an operation `run`, a resource `factory`, an extension `start`).
  Outside one there is no ctx to reach; a helper's timer is a Jev question.
  Fix: `await ctx.clock.sleep(ms, ctx.signal)`.
- **S22 droppedRun** — `x.run(…).then(ok, () => undefined)`, `x.run(…).catch(() => {})`, or `try { await x.run(…) } catch { … }` with no catch parameter.
  Also a `settle` whose Result nobody reads: `void x.settle(…)`, or `x.settle(…)` (awaited or not) as a bare statement.
  `settle` recovers a panic, so a dropped Result hides it (ADR 0067).
  `void x.run()` stays allowed: the scope tracks the run.
  Repo lint: every file.
  Fix: `const r = await load.settle({ input: id })`, then branch on `r.status`; or call `run` and let the scope own the failure.
  Plain code sees no types, so a local object's own `settle` (a transaction, a waiter) must not count.
  Missed: a handle passed through an untyped name, such as `const h = scope`.
  The settle counts only on a core handle:
  - a parameter of a unit body (its deps, `ctx`, an extension's `scope`), inside that body;
  - a parameter of a `.session(…)` callback, inside it;
  - a name typed as a controller, scope, or session;
  - a const made by `createScope`, `createSession`, or `useScope`.
- **S23 handSubscribe** — an `onX(listener)` that adds the listener to a list and returns a remover.
  Skipped: `onMessage` and `onClose` on an object that also has `send` and `close` (the `Sync.Transport` contract).
  Repo lint: `apps/` and `examples/` only.
  Fix: a `data` cell that readers `watch` or read with `useData`.
- **S24 rawFetch** — a call of `fetch` or `globalThis.fetch`.
  Repo lint: `apps/` and `examples/` only; `packages/http` owns the real one.
  `EventSource` and `WebSocket` stay out (ADR 0048).
  Fix: an `@tinker/http` endpoint operation, like `postIssue` in the tracker's `client/api.ts`.
- **S25 componentState** — `useState` or `useReducer` in a `.tsx` source file.
  Writer gate only: in the repo, a benchmark's plain-React control is a trap by design.
  In writer mode it replaces `no-react-state` on the same line.
  Fix: `const running = data({ label: "bench.running", initial: false })`.

### Entry and root (S27–S28)

ADR 0078: importing an entry starts nothing.
One function builds, uses, and closes the full root, then answers a value.
Test files never count.
The writer gate checks every other file, with S27's browser skips below.
The repo lint lists hits without failing.
Each message ends with its fix line.

Run the repo lint for both rules:

```bash
JEV_TOKEN_FILE=/dev/null node tools/jev/lint.mjs \
  apps examples 'packages/*/src' | grep -E 'S2[78]'
```

- `JEV_TOKEN_FILE=/dev/null` gives `lint.mjs` no key, so no model runs: it prints only the plain rows, in about 2 seconds.
- Each hit prints as `▪ L<line> S27: …` under its file.
- No output means no hit.

- **S27 unguardedEntry** — a top-level statement with an `await` outside a function body and outside the positive branch of `if (import.meta.main)`.
  Expressions, declarations, and `for await` count.
  `await using` counts as a declaration.
  One row per top-level statement, at its first line.
  The guard's condition and its `else` branch are not guarded.
  Repo lint: `apps/`, `examples/`, and `packages/*/src`.
  Root `bench/`, `tools/`, and `scripts/` files are scripts, so the repo lane skips them.
  Both lanes skip `.tsx` and files under a `client/` folder: a main guard would switch a browser page off.
  Fix: `if (import.meta.main) await main(shell);`.
  For a server: `if (import.meta.main) process.exitCode = await runServer(process.env, stop.signal);`.
  Missed: startup with no top-level await, including an async function called without awaiting it.
  Browser limit: plain `.ts` browser files outside `client/` still count; move their entry under `client/`.
  The path skips also miss backend code placed in `.tsx` or `client/`.
  Only the direct positive guard is recognized; equivalent boolean tests still get a row.
- **S28 returnedRoot** — a function that returns `createScope()`, a name it bound from that call, or an object with such a value.
  Declarations, expressions, arrows, and methods count; an arrow's expression body is a return.
  One row per function, at its first line.
  Bindings stay within their function and block; a nearer binding hides an outer name.
  Returning closures that use the root does not return the root.
  A factory given to an owner directly as a call or `new` argument, or as a JSX attribute, does not count.
  Missed owner handoff: a factory first bound to a name still counts, as in `const make = () => createScope(); provide(make);`.
  Repo lint: `apps/` and `examples/`; packages such as `@tinker/process` build command roots by design.
  Fix: `runServer(env, stop)` builds, uses, and closes its root, then returns an exit code or a `Result`.
  A test builds its own root.
  Missed: a renamed `createScope` import, assignment after declaration, or a scope passed through another name, array, spread, call, or conditional return.
  The check follows declarations, not later writes to those names.
  Calls named `createScope`, including `core.createScope()`, count without checking their types.

Fixtures in `fixtures/entry-rules/` keep the old tracker `createApp` from `9aece1e` and the playground's `tinkerLib` from `apps/playground/src/bench/runners.ts`.
The first hits S28; the second returns closures and stays clear.
Tests also keep the ADR 0078 `runServer` shape and a test's own `boot()` helper clear.

### Lifetime by hand (S19 lane, S29)

ADR 0085 gives core the root's stop signal and cleanup wait.
These rules flag code that does those jobs again.
Run the repo lint with no model key:

```bash
JEV_TOKEN_FILE=/dev/null node tools/jev/lint.mjs \
  apps/ examples/ packages/ | grep -E 'S19|S29'
```

- **S19 helper takes a handle** — a top-level helper whose parameter type holds a controller, scope, or session.
  Includes `Pick<Scope.Handle, "ready" | "close">` and `Scope.RootHandle`.
  A bare `Root` does not count: React DOM owns that type.
  Same-file type aliases with a handle in their body count too.
  Repo lint: `apps/*/src`, `examples/`, and `packages/stack/src`.
  Other packages' drivers take the handle their extension's `start` received by design.
  Writer gate: source files under `src/`, plus the repo lane.
  Neither lane counts tests: a test is its own root.
  Fix: "a helper works on plain values; read and write cells inside the operation body".
- **S29 lifetimeByHand, ready** — a `try` block only awaits the same root's `scope.ready` and its `catch` calls `scope.close()`.
  Also `scope.ready.catch(fail)` and `scope.ready.then(ok, fail)` when the failure callback closes that root.
  The row points at the close call; a callback used twice gets one row.
  A root is a const from `createScope` or `useScope`, or a name typed as `Scope.Handle` or `Scope.RootHandle`.
  A typed parameter counts here, including stack's old `runUntilStop`; S19 names the passed handle too.
  Each use must refer to the same binding: a new name in a block, catch, or function hides the outer name.
  A known `createSession` handle never counts, even when typed as `Scope.Handle`.
  Fix: nothing to close: `ready` rejects only after the forced close ended and every close hook ran (ADR 0085).
- **S29 lifetimeByHand, stop** — a function makes a const with `createScope`, then closes it with `{ graceful: true }` after an abort wait.
  Counts an `addEventListener("abort", F)` whose callback closes the root.
  Also counts an awaited `new Promise`, inline or in a local name, whose body listens for `"abort"` or reads `.aborted`.
  An `await once(signal, "abort")` counts too.
  Only closes of a root made in that function count: a passed handle is S19's job.
  The row points at the close call.
  Fix: `createScope({ ...pieces, signal: stop })`, then `const end = await scope.closed`.

S29 repo source lane: `apps/`, `examples/`, and `packages/*/src`.
The writer gate checks every file.
Both lanes skip all of `packages/core/`, which implements the lifetime itself.
Both check **ready** in tests too: a test's own root has the same cleanup promise.
Tests keep their explicit stops, so **stop** skips tests.
The lint runs only S29 on tests without sending them to the model judges.

Safe shapes: a try that does other work besides awaiting ready, a try that awaits different roots, `finally` cleanup around work with no abort wait, a close of a different root, a stream writer or plain object with `ready` and `close`, sessions, and a forced close on abort.
Fixtures in `fixtures/lifetime-rules/` cover those shapes and both hit forms.

Accepted misses and limits:

- S19 sees top-level helpers and direct same-file aliases; it does not follow imported or chained aliases.
- S29 sees the written `Scope.Handle` and `Scope.RootHandle` types; it does not resolve type aliases.
- It does not follow renamed maker imports, root aliases, assignments after a declaration, or handles stored in object fields.
- A call named `createScope` or `useScope` counts without checking its import.
- A callback can be inline or a named function in this file; calls through other helpers do not count.
- A ready wait must directly await `.ready`; `Promise.all`, a saved ready promise, and nested callbacks are missed.
- An abort promise must contain the listener or `.aborted` read in its executor body; separately wired resolvers are missed.
- Stop uses source order within the same function; it does not prove which branch runs or which signal fired.
- Stop needs literal `{ graceful: true }`; a saved options object or a later spread is missed.

### TSDoc (S26)

Coding-convention rule 10: TSDoc is the only comment form, well-formed, and it says what code cannot.
S26 is the well-formed half.
The meaning half is the reviewer's: the `docRestatesCode` judge is retired.
Every file, both lanes.

- **S26 tsdoc** — a doc the TSDoc parser rejects: one row per parser message, at its line.
  Examples: an unknown tag, a bare `@scope/pkg` in prose, an unclosed `{@link`, a lone `{` or `}`, a code span broken across lines.
  Also a `@param` whose name is not a parameter of the declaration the doc sits on.
  A destructured parameter lets any `@param` name stand for it.
- Tags: the parser's standard set passes (`@remarks`, `@example`, `@param`, `@returns`, `@throws`, `@see`, `@deprecated`, `@internal`, `{@link}`).
  Any other tag hits: in 2026-09 the repo used no other tag.
- Fix: escape `@`, `{`, `}`, `>` in prose, or put code in backticks on one line.
- `docs.mjs <globs>` lists the rows with no key; `--plain` still runs and changes nothing.

## How to read a probability

Jev returns a probability per yes/no. A judge's `threshold` (0.5 everywhere today) turns it into a hit.
Probabilities are **not comparable across judges**: 60% on one question is not "weaker" than 80% on another.
Calibration gives a threshold its meaning: it re-asks each judge about cases a human already labeled true or
false. `proven` means the judge puts true cases above false ones by 30 points or more, 90% of the time,
over at least 5 labeled cases a side (ADR 0054); `provisional` means fewer cases than that;
`noisy` means enough cases and it failed.

## The workflow around it

1. Writer: pre-flight, then `tests.mjs` and `promises.mjs` on touched packages. Every `⚠` gets one
   label, and the label is the answer: `label.mjs … true --why "<fixed how>"`, or
   `… false --why "<why not a defect>"` (ADR 0065).
2. Lead: `review.mjs` on the branch; label a flag when you disagree with the writer's label.
3. Lead, at every landing that adds labels: `calibrate.mjs`, commit `calibration.json` (ADR 0054). A
   noisy judge's hits print as `~`.
4. Never block on a judge that is not `proven` (none blocks today). Never add a rule for one ticket.

The `unitCouldBeModuleLevel (code)` check is plain code, not a model judge.

## The judges

Generated from the code by `node tools/jev/explain.mjs --md` — regenerate after editing `bank.mjs` or `lib.mjs`.

### file judges — review.mjs / preflight.mjs, one call per changed source file

- **`partialStub`**
  Status: provisional
  The question Jev is asked: Does the code leave required work unfinished — a placeholder body, a thrown not-implemented, or a TODO on the main path?
  `true` means: a required path is stubbed, throws not-implemented, or is marked TODO/FIXME
  `false` means: every required path has a real implementation

- **`memoKeyIgnoresInput`**
  Status: provisional
  The question Jev is asked: Is a cached or memoized result stored under a key that omits an input the result depends on, so a later call with a different value returns the earlier cached result?
  `true` means: the key leaves out an input that changes the correct result
  `false` means: the key includes every input the result depends on, or there is no caching

- **`leakedInternal`**
  Status: provisional
  The question Jev is asked: Does this file expose, through a public or exported API, a symbol whose name or role marks it as internal (helper, impl detail, underscore-prefixed, "internal", "unsafe")?
  `true` means: a public export exposes an internal-looking symbol
  `false` means: only intentionally-public symbols cross the public surface

### unit judges — lint.mjs / preflight.mjs, one call per declared unit or top-level function

- **`wrapsCallersStep`**
  Status: noisy
  The question Jev is asked: First distinguish a caller-provided callback from an already-declared operation. If a request handler in an extension or driver uses an inline session.run({ depends: { op }, run: ({ op }) => op.run(...) }) to invoke an already-declared op, answer FALSE: it is only routing that op, even with logging, error mapping or a new request label. Otherwise, does this function build a NEW declared operation({ depends, run }) around an existing operation (including a frame's turn and text, a module's op, or a lazy-loaded op), so the caller cannot give the wrapper its own label and depends? Answer TRUE for that command-builder shape, even when the run body also parses arguments, formats output, or handles errors; returning a route whose entry names this newly built op is still a wrapper. Also TRUE for an inline run whose body executes a caller-provided callback. A frame factory making its own units from plain config is false.
  `true` means: a new declared operation wraps an existing operation or callback as the step, or an inline run wraps the caller's callback as its step
  `false` means: a driver or extension uses an inline run only to route an already-declared operation per request, it makes its own units from plain config, or it creates no operation

- **`runForwardsToClosure`**
  Status: provisional
  The question Jev is asked: Is this operation's run body a pass-through — a single call that hands the work to a function, method, or closure that is NOT listed in the operation's depends?
  `true` means: the whole run is one call to an outside function, method, or closure missing from depends, usually receiving ctx or ctx.input
  `false` means: run has its own multi-step body, or its only outside call is to a dep listed in depends; helpers take plain values or a dep delivered by depends

- **`effectWithoutDefer`**
  Status: provisional
  The question Jev is asked: Does this start something that keeps running after it returns — a timer, interval, watch, listener, subscription, poll, socket, stream, or connection — and stop it by hand (a returned close method, a finally block, a manual flag) instead of a ctx.defer hook? A function whose body only opens a session, wires one abort listener for it, and closes it in its own finally is the session owner itself, not a missed defer.
  `true` means: a timer, watch, listener, subscription, or stream is started and its stop is manual or missing
  `false` means: every started thing is stopped from a ctx.defer hook, nothing keeps running, or the function's own body is the open-and-close of one session

- **`stateOutsideCell`**
  Status: provisional
  The question Jev is asked: Is state that other code reads over time — a selection, a filter, a draft, a status, a list — kept in a closure variable, module variable, object field, or ref with hand-made listeners, instead of a data cell?
  `true` means: shared, watched state lives in a variable, field, or ref with its own listener set
  `false` means: shared state lives in data cells, or the variables are private bookkeeping behind this unit's methods

- **`configNotTag`**
  Status: provisional
  The question Jev is asked: Does this unit read a setting that changes per environment — a URL, host, port, file path, credential, or feature switch — from process.env, a hard-coded value, or a parameter, instead of a tag in its depends?
  `true` means: an environment setting (URL, host, port, path, key, flag) is read from process.env or written as a literal or argument
  `false` means: no environment setting is used; labels, error kinds, UI text, ids, limits, and other app rules are not environment settings

- **`handRolledLifetime`**
  Status: provisional
  The question Jev is asked: Does this keep a hand-rolled pending queue — a variable holding a promise that each new caller appends to with .then, so calls run one at a time in arrival order — where the scope should own the ordering instead (a resource factory with defer, ctx.signal, scope.ready, or a declared save queue)? The signature alone can name it: a helper that takes a scope handle and returns queued save and detail callers keeps a pending queue. A plain value registry (a Map whose entries are added and removed by key), a reconnecting transport's per-attempt promises and per-wire listener sets, and library or driver internals (the scope, the test clock, a stream or session adapter) are not a pending queue.
  `true` means: the source keeps a pending queue: a promise tail with chained .then, or a helper returning queued save and detail callers off a scope handle
  `false` means: no pending queue appears: ordering goes through the scope, or the source only keeps a keyed registry, a transport retry, or driver internals

- **`stopOnlyInDefer`**
  Status: provisional
  The question Jev is asked: Is running work stopped only from inside a ctx.defer hook, with ctx.signal ignored, so a forced close waits on work that only defer would stop?
  `true` means: the only stop for in-flight work is set from defer; the signal is never consulted
  `false` means: in-flight work watches ctx.signal or calls throwIfAborted so close can end it, or there is no in-flight work

- **`ignoresAbortAfterAwait`**
  Status: provisional
  The question Jev is asked: Look at each await in this factory. Is any await followed by a call that starts new work — a query, a subscribe, a send, a build — with no signal.throwIfAborted() or signal.aborted check between the await and that call?
  `true` means: at least one await is followed by new work and no signal check sits between them
  `false` means: every await that is followed by new work has a signal check first, or no work follows any await

- **`readsMoreThanRendered`**
  Status: provisional
  The question Jev is asked: Does this component read a whole list or collection from a cell with useData, and then use only one item of it — found by id, key, or index — with no selector argument?
  `true` means: useData(cell) returns a whole list and the component picks one item out of it by id, key, or index
  `false` means: useData gets a selector for the item, the component renders the list it reads, or the cell holds a single record or form draft whose fields are rendered

- **`subscribesToWriteOnly`**
  Status: provisional
  The question Jev is asked: Does this component subscribe to a cell it only writes — useData, or useData with writable — where the read value never appears in the output?
  `true` means: a cell is read with useData but only its setter is used; the value is never rendered
  `false` means: every value read is rendered, or write-only access goes through useController

- **`runDuringRender`**
  Status: provisional
  The question Jev is asked: Does this component call run, runAsync, set, or update directly in its render body — outside any event handler, callback, or effect?
  `true` means: a run or a cell write sits in the function body and executes on every render
  `false` means: every run or write is inside an onClick, onChange, onSubmit, or other callback

- **`domainLogicInRender`**
  Status: proven
  The question Jev is asked: Does this component decide an app rule itself — parse or validate user input and pick an error, detect a conflict, merge, or check against saved data — instead of passing the raw input to an operation and rendering the notice the operation writes?
  `true` means: the component parses or validates input and chooses an error or blocks the action, or compares saved and draft data to decide what happens
  `false` means: the component passes raw input to operations with useRun and only formats values for display (labels, sorting for display, disabled while pending, empty-text checks)

- **`effectOwnedByComponent`**
  Status: provisional
  The question Jev is asked: Does this component itself start a fetch, timer, listener, socket, or stream — in its body or in a handler — instead of running an operation with useRun or reading a resource?
  `true` means: fetch, setInterval, setTimeout, addEventListener, EventSource, or a websocket is created in the component
  `false` means: the component only runs operations with useRun and reads cells or resources

- **`inputDefaultMasks`**
  Status: proven
  The question Jev is asked: Look only at values that come from the user or the caller — form text, ctx.input, a raw input field. When such a value is missing, blank, the wrong type, or cannot be parsed, is there ANY path where this code keeps going with a made-up value instead of raising an error? Count an if-branch that returns or assigns a default for blank input, a ternary that picks a default, `??` or `||` on the input, String(x), or Number(x) without a check. When `uses` is given, it lists the lines in this file that call this helper: judge what happens to the returned value there. A default for a field the caller left out entirely, where a present but bad value still raises, is not masking.
  `true` means: some path turns a missing, blank, wrong-typed, or unparseable user or caller value into a default ("", 0, 1, today, the first option, "undefined") and continues without an error
  `false` means: every path that meets a bad user or caller value raises an error, or the only defaults are for internal values (sort ranks, lookups in the app's own maps, display fallbacks, error names), or for optional settings, or `uses` shows the made-up value only goes into a thrown error's payload and no work continues with it, or the default applies only when the field is absent from the input (the key is missing) while a present bad value still raises

- **`noOpRejected`**
  Status: proven
  The question Jev is asked: Can this code reject a request that would change nothing — the record is already in the requested state (the link already exists, the item is already done, the value is already set) — because a guard such as a status, lock, or limit check runs BEFORE the check for 'already so'? Code that only creates a new record, or only removes one, has no 'already so' state, so its guards cannot reject a no-op.
  `true` means: a guard that throws or fails comes before the already-so check, so repeating an already-applied request fails
  `false` means: the already-so check runs first and returns without change, or no repeat-of-current-state path exists, or the code only creates a new record or only removes one

### test judges — tests.mjs, one call per test

No live judge. Retired judges keep their cases in cases.jsonl.

### survivor judge — survivors.mjs, one call per surviving mutant

- **`survivorMatters`**
  Status: proven
  The question Jev is asked: This mutant survived every test: inside the unit shown, the code `before` became `after` and no test failed. Would a user of this package observe a wrong result, a missed error, a wrong count, or a leak if this change shipped?
  `true` means: the change alters a value, a branch, an error code, an ordering, or a cleanup a caller can observe — a boundary, a returned field, a thrown code, a defer, a limit
  `false` means: the change touches only a message or label string, a log line, an expression with the same result, unreachable or dead code, or a speed-only path with the same outcome

### doc judge — docs.mjs, one call per TSDoc block

No live judge. Retired judges keep their cases in cases.jsonl.

`docRestatesCode` retired 2026-09-28 (ADR 0054 rule 1).
Its question: does this doc only restate the declaration, or claim something the code contradicts?
On 392 labels it was noisy: true med 75%, false med 68%, sep 7%, ordered 65%.
One reword, restatement only, tried three ways on the same labels:

- "Could a reader who sees only the declaration write every sentence of this doc?" — noisy: true med 40%, false med 27%, sep 13%, ordered 68%.
- "Is every fact the doc states visible in the name, types, or body?" — noisy: true med 48%, false med 35%, sep 13%, ordered 63%.
- "If this doc were deleted, would a reader of the declaration lose nothing?" — noisy: true med 45%, false med 37%, sep 8%, ordered 67%.

Each misses most restating docs: at 65%, the best flags 65 of 334 (and 1 of 58 others).
A doc that contradicts its code is a separate question; no judge asks it yet.

### guide — the unit classifier lint.mjs uses; for words, blueprint suggest

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
