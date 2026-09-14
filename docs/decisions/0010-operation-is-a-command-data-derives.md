# 0010 `operation` is a command; `data` is the only reactive value

Date: 2026-09-14. Status: accepted.

## Context

The prototype fused two natures into one `operation`: a cached, reactive derive
(`doubled`, `display`) and a run-once, effectful command (`saveUser`, a data
writer). Three reviews showed the fusion is unsound: a no-input effect is
memoized and runs once; a reactive refresh can replay an effect with stale input;
`resolve()` is ambiguous between "read a cache" and "perform a call". pumped-fn
kept these apart (reactive `atom` vs executable `flow`); the prototype had
collapsed them.

An operation that takes `input` and runs is a function — a command. The right
split is not to give one unit two modes, but to move derivation off it.

## Decision

- **`operation` is a command.** It declares typed `input` (parsed once from
  `rawInput`), reads its `depends` at call time, and runs on each
  `resolve(input)`. Effects are allowed. It is **not** reactively memoized and is
  never re-run by dependency changes. It is imperative.
- **`data` is the only reactive value** — a cell. There is **no** separate
  `derive`/`compute` unit and no "derived" form of `data`.
- **Dependencies have a mode.** A `data` dependency is either **read** (bare
  `data` → the value, a snapshot at resolve/build time) or **write**
  (`data.controller` → a handle to `get`/`set`/`watch`).
- **Derivation is a pattern, not a unit.** A value "derived" from others is just
  a `data` cell that an `operation` or `resource` maintains by depending on it in
  write mode and writing it (watching its inputs in write mode to stay fresh).
  Consumers watch that cell. Equivalently, a consumer may skip materialization and
  watch the source cells directly, combining them itself.

## Consequences

- Effects can never be silently memoized (commands always run); nothing replays an
  effect on dependency change. There is no derived-value staleness or async-derive
  path to reason about — the reactive lane is only `data` cells, writes, and watch.
- Still five units; `data` stays a single, simple concept (a cell).
- Reactive materialized derivation costs an explicit `resource` that watches
  inputs and writes an output cell — deliberately explicit, not implicit magic.
- Code change in `scratch/tinker.ts`: remove the operation-as-derive/memo path;
  `operation` becomes a run-each-time command; move every demo's derives to either
  a written `data` cell or direct consumer `watch`.
