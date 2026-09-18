# 2026-09-18 — A resource dependency is its value (core/t31, ADR 0044)

**Change.** A bare resource in `depends` now delivers its built value, never a promise. Declared
deps are built before the body runs; a still-building async dep is awaited by core, then the body
runs with the value; a failed async build rejects the call before the body runs (sticky until
release). Async-ness is typed through the graph (`Scope.AsyncBody<D>`): a body over an async
resource must return a promise. The lazy deps Proxy is gone (W10/W12 in core: 0).

**Why.** Every consumer of an async resource paid an `await` that carried no meaning
(`(await tx).insert`, `(await thread).run`); the user named it as not the intended DX. The DI
container analogy (NestJS async providers, Effect layers): acquire before inject.

**Numbers** (in-container, `taskset -c 7`, alternating A/B main vs worktree, min and median of 7, `bench/core-probe.mjs`):

| scenario                                     | main              | core/t31          | delta                 |
| -------------------------------------------- | ----------------- | ----------------- | --------------------- |
| `op` (data dep only)                         | 89.0 (med 106.4)  | 99.2 (med 101.7)  | +10.2 min / −4.7 med  |
| `run` (scope.run, data dep)                  | 116.4 (med 117.7) | 110.6 (med 113.6) | −5.8 min / −4.1 med   |
| `opres` (op over a built sync resource, NEW) | 415.1 (med 424.4) | 320.5 (med 328.6) | −94.6 min / −95.8 med |

`opres` drops by ~100 ns: no Proxy + lazy-state allocation per call; a resource slot is one record
lookup (`resourceSlot`), no controller allocation. `op`/`run` have no resource dep: the flag that
gates the per-dep resource check is read once at controller creation (cached per node), and the
parked builds pass through a module slot, not a symbol property.

**Reading the `op` min.** Main's seven samples were 89.0 once and 106.3–106.7 six times; the
worktree sat at 99.2–103.3 every time. The +10 ns min is one main outlier against a bimodal
in-container run, the median is −4.7 ns; `run` improves on both. Recorded honestly; the +2 ns
min rule is re-checked on the sandbox `bench` when it is available (it is not in this container).

**Shape rules learned.**

- A call-path check that only some ops need is gated by a declaration-time flag, hoisted to the
  cached controller — never re-read per call.
- Hand a per-call side result to the caller through a module slot read immediately, not through a
  symbol key on the user-visible object (a symbol miss costs more than the whole check).
- Keep the body call site's exact shape (`override ? override(...) : target.run(...)`); a call
  through a local alias measured slower.
- The imperative verb (`resolve`) keeps returning the same settled promise for an async resource —
  identity-stable for Suspense-style retries; only the dependency slot changes shape.
