# 0067 An error is a value; a panic is stamped at its origin; `settle` recovers

Date: 2026-09-25. Status: accepted. Supersedes: 0066's receipt tracking (the promise subclass).
Keeps: 0066's goal (no failure vanishes; every failure keeps its location), 0017, 0028.

## Context

ADR 0066 decided that a subflow failure nobody receives fails its layer. To know "received",
core returned a Promise subclass from every async subflow run: native `await` never calls an
overridden `then`, so only a subclass made `await` visible. That cost ~0.5 µs per awaited async
subflow and grew with the number of operations (perf/async-subflow cut it 28%; the rest is the
lost `await` fast path).

The user's real need (2026-09-25): tell where an error happened, for sync and async, and capture
a panic at its tip, with a Result like session close has.

## Decision

The precedent: Rust (`Result` vs `panic!`), Go (`err` vs `panic` / `recover`), Effect (`Exit`
with a `Cause` that is a `Fail` or a `Die`).

- **An error** is a managed error: an `Error` with a string `kind` and a `payload` (the shape
  every package's `makeError` builds). It is a value. A caller may catch it with `try/catch`;
  if the caller handles it, the layer does not fail.
- **A panic** is anything else thrown (a `TypeError`, a bug, a primitive). It is sticky: it fails
  the layer it ran in even if a caller catches it with `try/catch`.
- **`settle`** recovers: `op.settle(call)` (and `scope.settle(op, call)`) never throws and
  returns a Result. A panic received through `settle` does not fail the layer. `run` keeps
  throwing and rejecting as today.
- **The Result** mirrors session close:
  `{ status: "success", value } | { status: "failed", error, kind: "error" | "panic", origin }
| { status: "cancelled", reason }`.
- **The origin** is stamped once, where the error was first thrown (the innermost run wins):
  `{ label, span?, path }`. `.run` stamps it for a sync throw and an async rejection alike.
  `originOf(error)` reads it; `cause` chains are followed. A primitive throw cannot be stamped:
  its location stays on its failed span. Session close's failed Result gains `origin` too.
- **Work nobody owns:** a subflow that settles failed after its caller has settled, not through
  `settle`, fails the layer (0066's orphan rule, unchanged).
- Cancellation is unchanged: a cancel reason on an aborted layer is `cancelled`, never a panic.
- **No cooked promise, ever** (user, 2026-09-25): core never returns a Promise subclass or a
  custom thenable. Every run returns a native promise, so `await` keeps its fast path.
- **`ctx.raise(kind, payload)` is the official way to raise an error** (user, 2026-09-25), an
  ambient tool beside `ctx.clock`, `ctx.random`, and `ctx.log` on operation and resource ctx. It
  throws a managed error and stamps its origin from the ctx it came from, at the throw site.
  `.run` still stamps any error that reaches it unstamped.

## As built

- errors/t01 (2026-09-25): settle, Result, origin, ctx.raise, native promises; until t03 a
  dropped subflow's failure (panic or error) that settles while its caller runs stays with the
  caller and shows only on its span.
- errors/t01b (2026-09-25): `settle` reports what `run` would do. A value returned under a forced
  close is `success`, as a program that catches SIGINT and exits 0 exits 0.

## Consequences

- An author who expects a failure raises a managed error, or calls through `settle`. A stray
  `catch {}` can no longer swallow a bug.
- Packages that recover from a `.run` on purpose (a route mapping a failure to a response, a tool
  error sent back to the model, a command's exit code) move to `settle`.
- Classifying and stamping happen only on the failure path: a successful run pays nothing.
- A third-party error that happens to carry a string `kind` and a `payload` counts as managed.

## Alternatives rejected

- **Keep receipt tracking (0066):** airtight, but its cost grows with every async operation.
- **Stamp only, no sticky panic:** cheap, but a `catch {}` hides a bug from the layer outcome.
- **`run` returns a Result always:** every call site changes; `settle` gives the same where wanted.
