# Parked review — 2026-09-30

Owner: lead (parked review).
Reviewed source: `217a4fe3`, with no source changes.
The live lanes are in [TODO.md](../../../TODO.md).
The [2026-09-19 review](../blocked-and-parked-review.md) stays as history.

## Result

Checked all 15 cards in the latest Parked lane.
Five resumed cards belong in Doing.
Auth is Blocked on the resumed Hono commit fix.
React mutation work already shipped; its existing Done card has proof.
Eight ideas stay Parked, each with a current restart rule.

Also checked the 34 feedback rows that were open, candidates, tickets, or Parked.
The table header is not a request.
Closed eight stale requests and updated five other descriptions or states.
The old failed-start cleanup note is now marked as superseded by ADR 0085.
No parked feature was implemented and no new timing claim was made.

## Resumed cards

The board commit `217a4fe3` said six cards returned to Doing.
Its actual diff put all six in Parked with text saying they had resumed.
Their recorded writer work is still ongoing; a rebase is not landing proof.

- **stack/t17 hono-commit** — Doing.
  Sol writer `4783edd2` is rebasing before an Opus recheck and lead landing.
  Keep the checks for commit failure and rollback after raised errors.
- **stack/t08 jobs** — Doing.
  Sol writer `04d6e604` is rebasing; the old review passed on its branch.
  Require fresh checks on the new base before landing.
- **stack/t18 roots-signal** — Doing.
  Sol writer `f63d5891` must preserve main's shutdown fixes during the rebase.
  Keep the stop-signal and exit-code checks.
- **core/start-log** — Doing.
  Sol writer `c3f272c1` owns the fix.
  A fresh public probe still drops logs before and after start's `next()`.
  `ExtensionCtx.log` uses the no-op logger outside a run hook.
- **stack/t14 dev-host** — Doing.
  Sol writer `c4f5f4d3` is finishing the rebased dev host.
  Its reload comparison remains part of that ticket's checks.
- **stack/t10 auth-signin** — Blocked.
  The resume note says to wait for `stack/t17` to land.
  Then a Sol writer rebases and an Opus reviewer checks it.

The resume note was read at `~/.cache/tinkered-briefs/stack-resume.md`.
The board points to the [Stack track](../stack-v1/PROGRESS.md).

## Remaining cards

### perf/explicit-uses

Kept Parked by the user's 2026-09-29 choice, recorded in ADR 0073.
No `uses` field is shipped.
`OperationCtx` and `ResourceCtx` now build log and observation tools on first read.
The old committee's 10–40 ns was an estimate, not a current result.

Restart for a real graph reader that needs per-unit lifetime facts,
or after current queued evidence shows the ctx is a hot path's main cost.
Measure the present code before using the old ceiling experiment's shape.

### jev/handrolled

The plain rules S20–S25 and the tracker reconnect work shipped.
Only `bridgesOwnStatus` and `redundantAbort` remain proposed.
Neither is in `tools/jev/bank.mjs` or has a row in `tools/jev/cases.jsonl`.
The survey listed two and one true examples; those were not saved bank labels.
Its tracker status bridge and reconnecting transport have since been replaced.

Restart after collecting five true and five false current cases per judge.
Then add the questions and calibrate against ADR 0054's full bar.
The bank's empty counts do not justify shipping either judge.

### perf/lifecycle-creep

Kept as a timing question, not as a current regression claim.
The September 27 measurements compared older cancel-reason and with-data code.
Root lifetime, lazy sessions, and call ownership changed the close path later.
The latest call-signal comparison found no difference in `lifecycle` against its base.
That does not recheck the September 27 base.

Restart for a current slower verdict or a caller that closes many short scopes.
Choose fixed base and current commits, then use at least 61 queued paired rounds.
[Latest comparison](../../../research/learnings/2026-09-30-authoring-call-signal.md).

### errors/errorMap

Kept by the user's 2026-09-26 choice.
No `errorMap` field or new shared need was found.
Hono, Process, and MCP still use `settle` at their request or command edge.
Local catches still add the details known at that call.
The old count of nine catch sites is removed from the live card.

Restart when two callers need mapping over an entire operation,
and neither local catch plus `ctx.raise` nor edge `settle` meets the need.
The panic boundary, result shape, and nested-call rules still need a decision.

### blueprint/devtool

Blueprint v1 and v1.1 are complete.
The package ships command-line checks and YAML examples, with no graph editor.
The binary's own blueprint and one tracker example do not prove two real apps use an editor.
There is still no current editing caller or chosen host.

Restart for that caller and two apps with a settled YAML shape.
YAML stays the saved source; reading and writing must preserve it.
[Track](../blueprint-v1/PROGRESS.md).

### ai/v1

There is no `packages/ai` or approved shared model-layer ticket.
Harness supplies SDK threads; Tinkerer supplies the current model loop.
The tracker explicitly chose Harness rather than a new AI package.
AI SDK use in Blueprint and Jev is tooling, not proof of a missing driver layer.

Restart for a driver need those packages do not cover.
Record its behavior checks before making tickets.

### Core ideas

The current [feedback list](../core-feedback.md) is the source for remaining requests.
The old review's run-hook and write-hook limits are no longer current.
Resolve hooks still wrap direct root reads only.
One old request can be closed while a narrower part stays open.

Eight open requests were stale:

- **Public resource/operation guards** — the old CLI caller was retired.
  Process routes name command operations directly; the guards remain private.
- **A Core cell family** — replaced by namespace-backed Sync families.
  One declared cell stays in the graph; a directory supplies one key per id.
  The authoring review proves each root owns its values and listeners.
- **Write hooks on dependencies and sessions** — shipped in core/ext-hooks-every-layer.
  The current type comment and public tests cover those paths.
- **Jev bank lookup** — shipped as `BANKS` and `judgeOf` in `tools/jev/bank.mjs`.
  Labels, calibration, and evals now use that lookup.
- **CLI result with a nonzero exit code** — replaced by Process commands.
  A fresh probe writes a result and returns 1 without raising.
- **CLI stderr on success** — replaced by `process.io.error`.
  A fresh probe returns 0 with a stderr note.
- **The old always-async TSDoc mismatch** — superseded by ADR 0072's sync rules.
  The separate concern about awaiting a possibly changing sync body stays open.
- **Observation ignores the scope clock** — fixed by `57bb9df8`.
  A fresh probe freezes both a span and a log at 1234.

The old failed-start proposal remains closed under a newer rule.
ADR 0085 runs root close hooks once before `ready` rejects.
A fresh probe sees one hook and no repeat on a later close.
Skipping the hook is no longer the proposed cleanup fix.

These requests remain deferred:

- **Reuse a parent's session resource** — Drizzle remains the first caller.
  A fresh probe still builds distinct resources in parent and child sessions.
- **Publish several cells from one resource** — Harness still lists its cell dependencies.
  No second unmet need was found.
- **Run an operation selected by a tag** — Harness still declares tool dependencies in its frame.
  The operation's ctx does not provide the extension event's run access.
- **MCP call-session cost** — one session still belongs to one tool call.
  Use the queue if a current caller needs a speed change; the old timing is not current proof.
- **First/last watcher registration** — requested and late family identities already register.
  Watcher-driven unregister is absent; the two Sync notes are one caller.
- **Response status in a session hook** — an error answered as a value still closes success.
  Stack's publisher reads the request method and session outcome, not the HTTP status.
- **Hono mount's future** — the optional `mount` callback still runs after rows and before serve.
  This remains an adapter contract note, not a missing Core tool.
- **A child reads its parent's close mode** — Sync still uses `forcedClosing`.
  Root close events expose options; child sessions do not expose the parent's close mode.
- **Awaiting a sync result without lint trouble** — the sync body still returns its own type.
  The old demand that every run return a promise is no longer the contract.
- **Explicit async handle types** — the annotation question remains a first-caller type note.
  No type change is made by this review.
- **Close ordering and `Disposed`** — HTTP still checks `Disposed` separately from its signal.
  The accepted graceful-close rule still leaves signals live.
- **Namespace identity in spans** — not implemented by the namespace storage work.
  Two runs in distinct keys still have the same name and no namespace attribute.
  Keep the two-caller request open; do not claim the storage work shipped it.
- **Named watcher callback rules** — the snapshot is still made before callbacks run.
  A fresh probe confirms removing a named watcher during a round still calls it that round.
- **Duplicate Blueprint labels** — `linkedUnit` still selects the first matching label.
  `readUnits` still expects a literal label; no duplicate finding was found.
- **Markdown fence width** — `prose-lint --wide` now reports it.
  Formatter reflow remains open, so that request is partly done.
- **A late rejecting promise handler during close** — retained as an unproven edge case.
  No new probe claims the gap is fixed; the accepted teardown limits still apply.
- **Wrapped README promise matching** — `readPromises` still reads one line at a time.
  The continuation-line request remains a tooling note.
- **Generic `settle(call or none)`** — Hono's `settleFlow` still casts that call overload.
  The separate Result type fix already shipped.
- **The reader in `NotResolved`** — the error still names only the target label.
  Unique driver labels remain the workaround.
- **Passing a data-controller method unbound** — the public type still uses method syntax.
  The source's arrow methods do not remove that type-lint concern.
- **Wait until a cell has a value** — Core still has no matching public helper.
  The tracker still waits for stream readiness with its promise gate.
- **Jev tools on app folders** — `promises.mjs` still assumes `packages/<name>`.
  `tests.mjs` accepts a package name or file, not an app directory.
- **Sub-ms span times** — the default observation clock still reads milliseconds.
  An explicit observation clock is possible; no shared driver change has shipped.

Three qualified requests already have their own live cards:

- **core/start-log** — Doing; the fresh probe still fails to log at boot.
- **core/close-hook-scope** — Ready; Sync still needs a closing flag.
  ADR 0089 supplies owner-bound close access; NATS no longer patches `scope.close`.
  Scope closing state and root close-hook guarantees remain for that card.
- **core/traceparent** — Ready; Hono, HTTP, and NATS still have separate helpers.

The current board retains those cards' owners and next steps.
This review does not start them.
All other candidates need a current caller and a scoped task before scheduling.

### react/mutation

Removed from Parked; the existing `mutation/react-85` Done card covers it.
`3cb27e5c` added Stryker over the Chromium browser tests.
`887ee5e` raised the floor to 85 after an isolated score of 93.16.
The current Stryker config still has two workers and the floor of 85.
The later authoring run records a React score of 92.75.
[Saved package fault proof](../authoring-model/package-fault-proof.json).

The React track's old mutation deferral is cleared.
No fresh mutation run was needed for these doc-only edits.

### react/observation

Kept Parked.
`useSpans` still returns a snapshot of completed Core history.
There is no span subscription or React component-activity event contract.
Pending state in `useResource` and `useRun` does not supply those inspector events.
A fresh Core probe sees a pending span only after its work ends.

Restart for a concrete screen or debugging need.
Define that need's events and lifetime before adding emission.
[Reverted r16](../react-v1/issues/16-react-span-emission.md).

## Proof

- `vp install` passed in the separate review checkout.
- `vp run -r build` passed; all 19 build tasks completed.
- `vp check` passed with 0 errors and 28 existing warnings.
- `vp run -r test` passed; all 18 test tasks completed.
- Eight public probe groups passed their assertions against the built entries.
  They cover boot logs, clocks, namespaces, pending spans, failed start cleanup,
  parent resources, named watchers, and command output.
- Current Jev label counts for both proposed judges are 0 true and 0 false.
- `vp run prose` passed with 0 hits; the new report was included.
- Local doc links and heading links passed with none broken.
- All 15 card outcomes and all eight restart rules passed the lane check.
- All four touched docs have no wide table rows or fenced lines.
- `git diff --check` and doc format checks passed.

Check logs are `/tmp/tinkered-parked-review-{build,check,test}.log`.
The final code check is `/tmp/tinkered-parked-review-check-final.log`.
Runtime source and tests were left unchanged.
No mutation lane or benchmark was run for this review.
