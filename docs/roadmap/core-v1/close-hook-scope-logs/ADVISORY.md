# Close-hook-scope advisory notes

All new closing tests match README promises.
The mixed cleanup-error test also matches.
The final promise scan returned 0.
Its log is `/tmp/close-hook-jev-promises-final.log`.

## Tests kept

The three reference-and-value flags are false.
A fresh value and a fresh object are separate promises.
Their reasons are saved here.
These rows come from plain rules, not model judges.
The label tool has an empty `TESTS` bank.
It rejected the attempted label with exit 1 for an unknown judge.
Log: `/tmp/close-hook-test-label-attempt.log`.
The three flags each check two separate promises:

- Named data release checks both the rebuilt value and a new resource object.
- Parent data release checks both the child's new value and a new resource object.
- A late session close checks both its Result's shape and a fresh Result object.

## Old test debt

Assumption: this card keeps old test debt for a follow-up.
The user limits the work to the closing signal.
These files and tests were not changed by this card:

- `packages/core/tests/errors.test.ts:4` and `:8` use
  `isError` inside `expect`, instead of a control-flow guard.
- `packages/core/tests/namespaces.test.ts:53` and `:847`
  use the same guard assertion.
- `packages/core/tests/caught-subflow.test.ts` still has a sleep.

These are real old style debts; they get no false label.
The final test scan returned 0, with no changed-test flag.
Its log is `/tmp/close-hook-jev-tests-final.log`.

## Old README gaps

Assumption: these old behavior claims wait for a README follow-up.
They are public promises in old tests, not new claims from this card.
They are kept here rather than adding other features to this change.
Each title below is the exact title the tool printed.

- async is typed through the graph: an op over an async resource is an async op
- two scopes read back their own writes
- an async build that completes during close does not publish and close stays clean
- an old build rejecting after release does not fail a session that got the replacement
- releasing the head of a deep chain does not overflow the stack
- a closed session's dependency edges are pruned so a later release skips it
- a sink returning a thenable whose then getter throws is isolated
- close runs defers in reverse registration order (LIFO)
- close collects a session child born and finished during its ancestor's body wait
- scope.run runs an operation with no call args
- two resolve hooks nest in registration order
- a scope with no session hook runs session bodies and closes the child session
- interleaved resource hooks keep reverse registration order
- interleaved release hooks keep reverse registration order
- a circular resource does not hold itself open after rejection
- release awaits interleaved async hooks in reverse registration order
- a warmed context-aware pool without cleanup can feed a client
- a hookless session client frees its hold on a root resource when it closes
- a late hookless build cannot replace the value built after release
- a hookless factory can retry after a synchronous failure
- a late build gives its waiting run a value and ends its hook once as released
- a named run borrows a replacement built after an earlier dependency releases it
- release passed point-free to forEach releases each cell
- releaseNs on named data invalidates only resources that read that bucket
- releaseNs on parent data invalidates a child resource that read its bucket
- releaseNs ignores data and resource buckets that were never built or already released
- releaseNs from a closed session cannot unlink the root's named pool
- releaseNs cannot unlink a root pool after its owner begins closing
- a rebuilt named data dependent leaves its old fallback entry
- releaseNs does not run a closing child's cleanup twice
- a child session inherits the parent scope's injected random
- a tagged sync run that raises a managed error rejects with it
- a run's borrow is released after its sync defer, so a release and a close do not wait on it
- a then getter is read once: the body value is the first read's
- an op-level defer runs before the value comes back and needs no session
- a tagged subflow inside a tagged run: the inner waits (a body is running), the outer waits for it
- the first async defer keeps the tagged call pending
- a parent close inside an untouched tagged body sees that body
- the first resource build sees inherited namespaces and the call's tags
- a data controller from an idle tagged call refuses a late write
- adopting a body's late then method keeps its tagged controller writable
- a tagged session adopts a callable made thenable by run cleanup

## Review fix round

Preflight, tests, and promises returned 0.
The four new tests have no plain test flag or README gap.

The seven old test flags keep the reasons above.
The fresh promise scan found 40 old gaps.

Its log is `fix-jev-promises.log` in this folder.
The existing gap list above still applies.

The fresh scan also flagged these unchanged tests:

- concurrent calls finish in release order, not entry order
- closing a deeply nested scope tree does not overflow

All 71 real code flags have false labels and reasons.
Core owns its layer and lifetime state and joins its close work.

The scoped bank is `jev-cases.jsonl` in this folder.
The lead owns its merge and calibration.

No shared Jev file was changed.
