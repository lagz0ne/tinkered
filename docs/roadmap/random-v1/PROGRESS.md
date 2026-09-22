# random-v1 — ambient Random capability

Random is the next ambient ctx capability after the clock (ADR 0062). It removes
the last hidden source of non-determinism we did not yet cover: `Math.random` and
`crypto.randomUUID`. Config (tags) and `Date`/"now" (clock) are settled and are
not capabilities — see ADR 0062.

The model is the clock (ADR 0034). It mirrors it site for site.

## Tickets

- **t01+t02 ambient random + test seam** — landed together (one core contributor):
  the ambient field cannot be tested deterministically without its seeded seam.
- **t03 docs + lint** — landed: core README `### Random` (5 promise lines), glossary
  `random` + `TestRandom` rows (ambient-capability row now lists `random`), ADR 0062
  → accepted, and `scripts/check-ambient.mjs` (a `pnpm validate` lane): package src and
  examples read time/randomness off ctx, never a hidden global; only the
  `systemClock`/`systemRandom` source lines carry the `ambient-source` marker.

## Anchors (SCIP, `scripts/scip.sh refs`, indexed on main c3a33ba)

- `Clock.Handle#` — def `src/index.ts:171`, 11 references, all in `src/index.ts`.
  These were the carry-sites the new `Random.Handle` copied one for one (the two
  ctx type literals, the Operation/Resource/Empty/Extension ctx classes,
  `Scope.Options`, the `Layer` record, `this.clock = owner.clock` in each ctx).
- `systemClock.` — def `src/index.ts:1240`, 1 reference (the scope default).
  `systemRandom` copies it, wired as the `random ?? systemRandom` default.
- `makeTestClock().` — near `src/index.ts:1264`. `makeTestRandom` copies its
  shape (a factory returning a `Random.Handle`, seeded instead of virtual-timed).

## Landed (t01+t02 — branch random-v1/t01)

`packages/core/src/index.ts` (+64), `packages/core/tests/random.test.ts` (+59, new).

New public symbols:

- `Random` namespace (`Handle` = `next()`/`uuid()`, `Options` = `seed?`) — ~ln 195.
- `systemRandom` (default) and `makeTestRandom({ seed })` (mulberry32; uuid drawn
  from the same stream, v4 nibbles set) — ln 1330–1357.
- `randomFor(parent, options)` — ln 2601–2604; `parent.random` when nested, else
  `options?.random ?? systemRandom`; wired into `makeLayer` at ln 2631.
- `random` field on `Operation.Ctx`, `Resource.Ctx`, `Scope.Options`, `Layer`, and
  each ctx class, assigned `owner.random`.

Gates (lead re-run, worktree): `vp run -r build` / `vp check` (0 errors) /
`vp run core#test` all EXIT 0, 392 tests (7 new).

Seven behavior tests (title = promise): same seed replays `next()`; same seed
replays v4-shaped `uuid()`; different seeds differ; `uuid()` is distinct per call;
no-seed `makeTestRandom` is a deterministic default; no `random` option reads the
system source; a child session inherits the parent's injected random.
