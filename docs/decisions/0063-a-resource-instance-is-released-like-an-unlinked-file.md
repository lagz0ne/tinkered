# 0063 A resource instance is released like an unlinked file

Date: 2026-09-23. Status: accepted (2026-09-23, tag `namespace-v1/t02b-1`). Refines: 0026 (teardown is reverse-registration LIFO), 0044 (a
resource dep is its value), 0059 (namespaces). Replaces the separate "superseded build" teardown path.

## Context

ADR 0059 gave a resource one bucket per namespace. Releasing ONE namespace's bucket (`releaseNs`) was
built three times and churned each time: a parallel set of namespace release functions drifted from
the default ones, and review found holes at every seam: a release freeing a bucket a live run still
held, a new namespace's run joining an old release and deadlocking, a failed build's cleanup lost,
and a dependency cleaned before the dependent built on it (N5).

Two facts on `main` explain the churn. A cleanup hook is tagged with the resource HANDLE
(`DeferEntry` is `{ fn, resource }`), so every bucket of one resource shares one list and a
per-bucket release has to guess which hooks are its own. And a build that finishes after its
resource was released tears down through a separate "superseded" path that skips the ordered
drain. That is exactly the shape ADR 0026 names as its one documented caveat (a cleanup registered
before an async dependency settles can run out of order).

The user decided (2026-09-23): one release mechanism; every resource goes through the same protocol.

**The analogy** is POSIX `unlink`. Unlinking removes a file's NAME at once; the file lives until the
last open descriptor closes, and only then is it freed. Effect's `RcMap` is the same shape: a key is
invalidated at once, the resource is finalized when its last holder lets go.

## Decision

1. **An instance is the unit of lifetime.** A resource instance is one bucket's state: the default
   bucket (today's `NodeState` fields) or a named one (`NsResourceState`). Storage stays as it is.
   The warm resolve path still reads the default fields directly. Only the lifetime protocol is
   shared.
2. **Hooks and borrows belong to an instance, not a handle.** A factory's `ctx.defer` is tagged with
   its instance. A run's borrow is taken on the instance it selected, at selection, before any
   factory runs. Nothing in a release re-reads a live map to find hooks or holders.
3. **Release unlinks.** `release(target)` unlinks every instance of the target at its owner;
   `releaseNs(target, ns)` unlinks one. Unlinking removes the instance from selection at once (the
   next resolve builds a fresh one), fixes its outcome to `released` (ADR 0026 Q4: first end wins),
   and cascades to the instances built on it, as release cascades today.
4. **An unlinked instance finishes when nothing holds it.** Holders are the runs that borrowed it and
   the instances built on it: a dependent holds its dependencies. Finishing runs the instance's hooks
   in reverse registration order with its outcome, then drops its holds on its dependencies, which
   may finish next. A dependency therefore never finishes before a live dependent, whatever order
   the hooks were registered in.
5. **A late build is not a special case.** A build that settles after its instance was unlinked still
   delivers its value to the run waiting on it. Its late hooks attach to the same instance and run
   when that instance finishes. The separate superseded teardown path is removed.
6. **Close keeps ADR 0026.** Close unlinks every instance of the layer with the close outcome. Among
   instances ready at the same moment, order stays reverse registration (LIFO). The hold gate only
   adds that a dependency waits for its dependents, which is what LIFO already produces when hooks are
   registered in dependency order.

## As built

- A release drains the instances it unlinked together, once that release's borrowers settle
  (ADR 0026 Q2), dependents before dependencies and reverse registration otherwise. An instance
  nothing holds does not finish ahead of the rest of its release.
- A resource that cannot register a hook stays off the lifetime bookkeeping: its factory takes no
  `ctx`, none of its resource dependencies can hook, and no layer carries a preset. It builds and
  closes on the fast path, as before this decision. `factory.length >= 2` is the same signal core
  already uses to hand a factory a real `ctx`.
- Measured with `bench/ab.sh`, N=61 alternating runs pinned to one core, `origin/main` against the
  branch: `op` -6.8%, `opres` (an operation borrowing a resource) -13.1%, `run` -5.9%, `inline`
  -4.8% (faster in 61 of 61 pairs each); `lifecycle` +0.8%, `cold` -0.9%, `create` +1.0% (noise).
  A first version cost `lifecycle` +145% by dropping the fast close for every resolved resource;
  the bench caught it before landing.

## Consequences

- One lifetime implementation for default and named buckets, used by `release`, `releaseNs`, and
  close. No parallel namespace release functions.
- ADR 0026's documented caveat (cleanup registered before an async dependency settles) no longer
  misorders declared dependencies: the dependent holds the dependency instance whatever its hook
  order.
- The warm resolve path is untouched. The borrow path of an operation with resource dependencies
  changes (instance instead of handle), so landing needs a `bench` run. `bench` is not available in
  this container today; the ticket stays open until it is.
- Work is two tickets: the protocol first (no new API, every existing test green, N5 fixed for the
  default path too), then the `releaseNs` verb on top of it.

## Alternatives rejected

- **Named buckets only on the new protocol, default path unchanged** — two lifetime models; the seam
  between them is where the three earlier attempts broke. The user chose one mechanism.
- **A dependency-ordering pass at close** — ADR 0026 rejected a scheduler; holds give the same order
  without one and only matter when a dependency was unlinked first.
- **Keep handle-tagged hooks and filter by namespace** — hooks would still need guessing from a
  shared list; tagging the instance removes the guess.
