# 0072 A tagged call that ended in place returns its value

Date: 2026-09-29. Status: accepted. Amends: 0038 ("a tagged call is always async").
Replaces: the R2 line under "Options considered" in 0071.

## Context

ADR 0071 lets an idle session end in place.
A tagged call that ended in place still wrapped its value in a promise, because ADR 0038 said a
tagged call is always async.
That wrapper and the caller's await were most of what was left.
A prototype that returns the value directly measured 811 ns per tagged call, against 992 ns with
the wrapper (benchd, N=31).

ADR 0071 first listed this as rejected.
The user chose it (2026-09-29) on one test: does it keep full observation?
It does, and the other cheap option (tags as plain values, 220 ns) does not.

## Decision

The precedent is `AsyncLocalStorage.run(store, fn)`: it returns what `fn` returned, a value or a
promise, as `fn` gave it.

- **A tagged call that ended in place returns its value.**
  The type is `T | Promise<Awaited<T>>`, like an untagged run.
- **A tagged call that must wait still returns a native promise.**
  Waiting means a promise body, a cleanup step, a resource, a child, pending work, a signal
  handed out, a failure, or a session hook.
- **`settle` follows the same rule.**
  It returns the `Result` directly when the call ended in place.
- **`session()` keeps its promise.**
  Only tagged calls change.
- **Observation is unchanged.**
  The operation's span nests under its caller; run hooks fire once; session hooks still wrap
  every tagged call (a hooked call takes the full path); a panic stays in the run's own session
  and its caller stays in the error path.

## Consequences

- `await op.run({ tags })` works as before.
- `op.run({ tags }).then(...)` or `.catch(...)` without an await no longer type-checks.
  Use `await`, or wrap it: `Promise.resolve(op.run({ tags }))`.
- A failure still comes back as a rejected promise.
  A failed call is not idle, so it takes the full path.

## Options considered

- **Keep "always async"** (992 ns).
  Rejected: nobody should chain `.then` on a tagged call instead of awaiting it, and the wrapper
  was most of the cost left.
- **Tags as plain values, no child session** (220 ns).
  Rejected: session hooks stop seeing tagged calls, a tagged subflow's error loses its caller in
  the path, and there is no per-run close or release to observe.

## As built

- A tagged subflow called before the first `await` in a running body always returns a
  promise; after an `await` it can return its value.
- Promises per tagged call made by core: 17 → 0 when it ends in place.
