# clock v1 — build progress

The first ambient capability on `@tinker/core`: a `Clock` on every `ctx`, Effect's
default-service model, swapped by a `TestClock` (ADR 0034). It is a **core** change
(`packages/core/src/index.ts`), so tickets extend the core numbering and gate.

- **Decision:** `docs/decisions/0034-clock-is-an-ambient-ctx-capability.md`.
- **Glossary:** `docs/glossary.md` (`ambient capability`, `clock`, `TestClock`).
- **Gate + tag:** `scripts/ticket.sh <NN> "<title>"` → tag `core/t<NN>` (check + `vp run -r test`
  - `core#size`, mutate best-effort). A red gate makes no checkpoint.

## Surface (v1)

```ts
export type Clock = {
  currentTimeMillis(): number;
  currentTimeNanos(): bigint;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};
// systemClock (default) · makeTestClock({ now }) -> Clock & { advance(ms), setTime(ms) }
// Scope.Options.clock?: Clock   ·   ctx.clock on Operation.Ctx + Resource.Ctx
```

Anchors: `ctx` types `index.ts:113` (op) / `:140` (resource); `EMPTY_CTX` `:813`; options
`:264`; layer-inherits-parent pattern `:1703` (`parent ? parent.obs : ...`); internal span
clock `Obs.clock` `:794` (kept separate in v1 — see ADR 0034 Consequences).

## Order & status

Linear; each ticket is one green checkpoint with a decisive, deterministic seam test
(no wall-clock sleeps — ADR 0003). Mark `x` when its tag exists.

| tag      | ticket                                                                                           | blockers | status |
| -------- | ------------------------------------------------------------------------------------------------ | -------- | ------ |
| core/t20 | Ambient clock plumbing + `currentTimeMillis`/`Nanos` + `makeTestClock` (now/advance/setTime)     | —        | [x]    |
| core/t21 | `sleep` on TestClock — virtual time + `advance` resolves + signal aborts a pending sleep         | 20       | [ ]    |
| core/t22 | `sleep` on systemClock — real `setTimeout`, signal clears + rejects, forced close → `cancelled`  | 20       | [ ]    |
| core/t23 | Validation milestone — `pnpm validate` green, cast-free README + example, universal bundle; SHIP | 21, 22   | [ ]    |

### Verify (the observable proof for each)

- **t20** — an operation reads `clock.currentTimeMillis()`; under
  `createScope({ clock: makeTestClock({ now: 1000 }) })` it returns `1000` (deterministic, no
  `Date` mock); a default scope returns ≈ `Date.now()`; a child session reads the parent's clock
  (inherited, like `obs` — no per-session override). `currentTimeNanos()` is consistent with millis
  (`now·1e6` under the test clock). `vp check` + `vp run -r test` + `core#size` green.
  - _astra round 1 (FIX → addressed):_ blocker — a factory that defaults its first param has
    `fn.length < 2` and hit the shared empty ctx, reading real time; fixed with a **per-layer**
    empty ctx (`emptyCtxFor`) that carries the layer's clock/signal (regression test added).
    Also: system `currentTimeNanos` now high-res via `performance` (precision-safe split);
    `makeTestClock` truncates millis and is fraction-safe; `setTime` now has a test; default-clock
    test bounded by a second `Date.now()`; private-helper TSDoc removed.
- **t21** — an op does `await clock.sleep(1000, signal)`; the promise is unsettled before
  `advance`; `testClock.advance(1000)` resolves it; `advance(500)` twice also resolves it; aborting
  the signal before `advance` rejects with the signal reason and drops the scheduled wake.
- **t22** — with `systemClock`, aborting the signal rejects the sleep promptly (no full-duration
  wait, so the test stays fast/deterministic); a forced `close()` while an op awaits a long
  `sleep` aborts it and the run settles `cancelled` (its `defer` sees `cancelled`), and `close()`
  resolves a `cancelled` `Result` (ADR 0028).
- **t23** — `pnpm validate` all lanes green (size cap, mutation ≥60, cast-free examples, pure
  universal bundle); README + `packages/core/examples/basic.ts` show the clock cast-free; mutation
  run isolated (`vp run core#mutate` alone).

## Review loop (mandatory, per ticket)

After a tag lands, send its diff to the standing reviewer and drive to `SHIP` before the next
ticket (serial — a fix often re-touches the same file):

```
paseo agent: codex/gpt-6-astra, thinking=xhigh, mode=full-access (read-only reviewer)
prompt: "review tag core/t<NN>; git show core/t<NN>; ADR 0034; ask for a full case checklist
         + all findings at once (blocker/should-fix/nit) and a SHIP/FIX verdict; do not edit,
         do not ask questions"
```

Use neutral wording in review prompts (the cyber-filter drops attack/reentrancy/deadlock/escape).
Address every blocker (fix + re-gate, `git tag -f`), record accepted nits.

## Code navigation

Lean on SCIP for symbol nav before edits (per CLAUDE.md): regenerate the core index and find every
use of a ctx field before threading `clock` through the build sites.

```bash
cd packages/core && scip-typescript index --output ../../.scip/core.scip
scip print --json ../../.scip/core.scip | head
```

## Reset (git techniques)

- Undo current (unlanded) work: `git reset --hard core/t<last>`.
- Redo a landed ticket: `git reset --hard core/t<blocker>`, rebuild, re-run the gate.
- Inspect a checkpoint: `git switch --detach core/t21`.
