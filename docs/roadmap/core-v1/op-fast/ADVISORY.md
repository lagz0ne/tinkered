# core/op-fast advisory notes

## Code

Jev points; it does not block a gate.
The file judge skips Core because it is over 100,000 characters.
The unit pass still reads all 251 functions.
The review pass reported 70 unit flags.
The final source pass reported 67; three wrapper hits are noisy notes.
Each state, effect, and lifetime flag is labelled false in the case bank.
Core owns the scope, run, and resource state these functions use.
That state runs the close and borrow protocol; it is not an app's data cell.
Watchers return a disposer, and root stop listeners leave during close.
Resource release owns and tracks cleanup instead of making another scope.
The noisy wrapper flag is a note; it owes no label.
The full label output is saved beside this note.
The bank and its calibration are committed.

## Tests

The seven new cases have zero test-quality flags.
The package pass points at seven old tests and one old sleep fixture.
They are outside this card and remain as on main.
The flags are error guard assertions, equality followed by shape checks,
and the timer fixture in the caught-subflow tests.
The source and built-file lanes still run every test.

The promise pass reports 46 old titles without a matched README line.
No new title is flagged.
The README now states the sync close, async cleanup wait,
operation defer, web abort code, and settle signal read guarantees.
The old titles below include type checks and private cleanup details,
which do not need a new shipped promise in this card.
Others already have a public rule but use different words:
reverse registration order is written as latest-first;
child and resource cleanup and inherited tags have their own sections.
This pass picks from six lines found by shared words.
It can miss the matching rule.
The rest are prior doc gaps, left for the lead without changing this hot-path card.

- async is typed through the graph: an op over an async resource is an async op
- concurrent calls finish in release order, not entry order
- two scopes read back their own writes
- an async build that completes during close does not publish and close stays clean
- an old build rejecting after release does not fail a session that got the replacement
- releasing the head of a deep chain does not overflow the stack
- a closed session's dependency edges are pruned so a later release skips it
- a sink returning a thenable whose then getter throws is isolated
- close runs defers in reverse registration order (LIFO)
- closing a deeply nested scope tree does not overflow
- close collects a session child born and finished during its ancestor's body wait
- scope.run runs an operation with no call args
- two resolve hooks nest in registration order
- a scope with no session hook runs session bodies and closes the child session
- interleaved resource hooks keep reverse registration order
- interleaved release hooks keep reverse registration order
- a circular resource does not hold itself open after rejection
- release awaits interleaved async hooks in reverse registration order
- a preset cleanup waits for a hookless dependent's late build
- a late hookless build cannot replace the value built after release
- a hookless factory can retry after a synchronous failure
- a late build gives its waiting run a value and ends its hook once as released
- a named run borrows a replacement built after an earlier dependency releases it
- release passed point-free to forEach releases each cell
- releaseNs on named data invalidates only resources that read that bucket
- releaseNs on parent data cleans child resources before parent resources
- releaseNs ignores data and resource buckets that were never built or already released
- releaseNs from a closed session cannot unlink the root's named pool
- releaseNs cannot unlink a root pool after its owner begins closing
- a rebuilt named data dependent leaves its old fallback entry
- releaseNs does not run a closing child's cleanup twice
- tag.all skips other tags bound on the same namespace
- a child session inherits the parent scope's injected random
- a tagged sync run that raises a managed error rejects with it
- a run's borrow is released after its sync defer, so a release and a close do not wait on it
- a then getter is read once: the body value is the first read's
- a then getter usable once still succeeds
- an op-level defer runs before the value comes back and needs no session
- a tagged subflow inside a tagged run: the inner waits (a body is running), the outer waits for it
- the first async defer keeps the tagged call pending
- a parent close inside an untouched tagged body sees that body
- the first resource build sees inherited namespaces and the call's tags
- the first nested tagged build owns its resource and both tag levels
- a data controller from an idle tagged call refuses a late write
- adopting a body's late then method keeps its tagged controller writable
- a tagged session adopts a callable made thenable by run cleanup
