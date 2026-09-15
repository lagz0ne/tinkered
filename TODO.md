# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.
Core ticket detail + reset recipes: `docs/roadmap/core-v1/PROGRESS.md`.

## Now

- [ ] **Authoring prep** — `@tinker/core` is feature-complete (v1). Next phase is authoring the
      public-facing material. Nothing is in progress yet; scope it before writing.
  - Likely items (to be turned into a real list): a `README` (what it is, install, a 60-second
    example from `packages/core/examples/basic.ts`), the public API reference, a short concepts guide
    (scope/session, data/operation/resource, `close()` shutdown modes), and the accepted-limitations
    note (ADR 0029) surfaced for users. Grounding: `docs/glossary.md`, `docs/decisions/*`,
    `docs/roadmap/core-v1/hot-paths.md`.
  - Verify: TBD once scoped.

## Shipped — core v1 (complete)

All tickets tagged; reset to any tag if a slice needs redoing. Detail in
`docs/roadmap/core-v1/PROGRESS.md`; budgets in `budgets.md`; teardown history in `teardown-redesign.md`.

- **t01–t18** — packaged scope, data (read/write/watch), operations, tags, sessions, structured close,
  sync/async resources + targets, outcome hooks + `session(fn)`, single-node + cascade release,
  observation, presets, static meta.
- **lt1–lt4** — teardown/lifetime redesign: converged `ctx.defer(end)` + `ctx.signal` (ADR 0024),
  reverse-registration LIFO close (ADR 0026), `close()` returns a `Result` never throws (ADR 0027),
  and the pivot — **`close()` is a shutdown MODE, not a wished outcome** (ADR 0028): forced (default)
  aborts + rolls resources back, graceful commits; reality-only reducer; the wish/severity machinery
  deleted. Accepted v1 limitations in ADR 0029.
- **t19 — v1 validation.** Release gate `pnpm validate` (`scripts/validate.mjs`); a regression fails
  it. All lanes green: size 15.1 KB, promises 0 sync / 5 async, heap 3.9 KB/req, mutation 77.45%,
  complexity 8, CRAP 8.73, cast-free examples, pure universal bundle, deep chains 10k+ safe.
  Wall-clock timing lanes (`bench/*.mjs`) run via `bench` in a sandbox.

## Housekeeping

- `scratch/` (the pre-package prototype) has been deleted. A few older ADRs (0009–0015) still mention
  `scratch/tinker.ts` in their Consequences as historical record of the prototype the decision came
  from — left intact as provenance; the real implementation is `packages/core/src/index.ts`.
