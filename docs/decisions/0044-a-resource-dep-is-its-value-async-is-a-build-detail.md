# 0044 A resource dependency is delivered as its value; async is a build detail, typed through the graph

Date: 2026-09-18. Status: accepted. Refines: 0020 (delivery in natural form), 0009 (`ResourceValue`),
0026 (what a body reads is fixed before it runs). Retires: lazy resource deps (core/t14 era; the
`lazyDepsProxy`).

## Context

An async resource (a db pool, a transaction, a harness thread, a lazily imported SDK module) was
delivered to every dependent body as its **build promise**, even after the build settled: ADR 0020
said "async → a promise, per ADR 0009's `ResourceValue`". Every consumer paid an `await` that
carries no meaning — `(await tx).insert(...)`, `(await thread).run(...)`, `const sdk = await
pending` — and new users tripped on it (drizzle/t01, harness/t01 core feedback). The user named it:
that is not the intended DX.

The delivery was lazy on purpose: a resource dep was built on first access inside the body, so a
body that ignored it never built it. Laziness and value delivery cannot both hold for an async
resource: a factory first touched inside a body returns a promise from a property read, and nothing
can await there.

**The analogy** is a DI container with async providers (NestJS `useFactory: async`, Effect layers):
the container acquires before it injects, and the consumer never sees a promise. Ours is simpler:
async-ness is computed by the type system from the declared graph, so a body knows statically
whether it is async.

## Decision

1. **A resource dependency delivers its built value.** `Scope.SlotValue<Resource.Handle<T>>` is
   `Awaited<T>`. The body reads `tx.insert(...)`, never `(await tx)`.
2. **Declared dependencies are built before the body runs** (the same rule ADR 0026 gives data:
   everything a body reads is fixed before it runs). A sync build stays sync: when every declared
   resource dep is already built or builds synchronously, the body is called at once and the call
   keeps today's sync fast path. When a declared dep's build is **pending**, core awaits every pending
   build, then calls the body with the values. Declare what you use — a dep you never read is dead
   code, not a lazy option.
3. **Async is contagious, statically.** A factory or run body whose declared deps include an async
   resource (one whose `Handle<T>` has `T extends PromiseLike`) must itself return a promise; the
   `operation()` / `resource()` / inline `run` signatures constrain the body's return type
   (`R extends AsyncBody<D>`), so a sync body over an async dep is a compile error, and the op's or
   resource's own type is a promise — the contagion follows the declared graph.
4. **A failed async build fails the call before the body runs**, with the build's error, exactly as
   a throwing sync factory does today; the failure stays memoized on the node until release.
5. **The imperative verbs keep their promise.** `scope.resolve(res)` / `controller(res).resolve()`
   still return `ResourceValue<T>` (the same settled promise, stable identity) for an async resource —
   "resolve" may build, and a caller outside any body has nothing else to await.

```text
declared deps → all built or sync   → body now  (sync fast path unchanged; no Proxy per call)
             → one pending          → await all pending, then body with values (the call is a promise;
                                       the type already said so)
             → one failed           → the call fails with the build error; body never runs
```

## Consequences

- The lazy deps Proxy (`lazyDepsProxy`, `LAZY_TRAPS`, the pending-descriptor dance) is deleted; the
  W10 census watch drops to zero in core; an op over a resource no longer allocates a Proxy per call.
- The eight laziness tests are replaced by the promises above (value delivered; pending build
  awaited; failed build fails the call; contagion typed; imperative verbs unchanged).
- Integrations shed their awaits: harness (`backend.start`, `thread.run`, `await pending`), drizzle
  (`tx.insert`), and every user op over a db or a thread. READMEs and examples follow.
- Perf rule: `op` and `run` (no resource dep) must not move; a new probe scenario `opres` (op over a
  built sync resource) records the Proxy removal; alternating A/B, min of 5.
- Presets keep the factory's async-ness: a replacement for an async resource returns a promise
  (the type says so); the "don't preset a void resource async" note stands.

## Alternatives rejected

- **Keep the promise, fix the wording** — the `await` carries no information; the type knows better.
- **Deliver a value only when already built, a promise when pending** — a dep's shape would depend
  on timing; a body cannot be written against it.
- **Retype every op over any resource as async** — kills the sync fast path for the common case
  (a sync pool, a config resource); the contagion must follow async factories only.
- **Keep laziness and pre-build only async deps** — a resource's async-ness is unknown until its
  first build, so the first call would see a promise and later calls a value.
