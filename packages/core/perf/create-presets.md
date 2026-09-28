# Empty-preset create — 2026-09-28

Empty presets now return before the loop starts.
The filled-list loop lives in `applyPresets`.
`readMany` runs once; each scope still owns its `nodes` Map.
Nested lists, preset order, and validation keep their old behavior.

- Code: `ade88a540588b5385f6922d50bfef1d8d41e9f0f`.
- Base: `337978ed7fb0d792b0d13f05abe457cdd91ff8db`.
- The base was `origin/main` when this ticket began.
- Base tree: `/home/paseo/next/tinkered-inv-main`.
- Its built source map matches its source files.
- Only `seedPresets` and the new `applyPresets` differ in core.

## V8 proof

V8 now puts preset setup inside `createScope`, called inlining.
The short empty path fits where the full loop did not.
The traces use `--no-concurrent-recompilation` for fixed compile order.
Default compile scheduling can pick other inline bodies.

- `seedPresets`: 266 → 76 bytecode bytes, V8's instructions.
- `base-presets-bytecode.log:2`: `Bytecode length: 266`.
- `fixed-presets-bytecode.log:2`: `Bytecode length: 76`.
- `fixed-inline.log:350`: `ir` is inlined into `Jr`.
- Those built names mean `seedPresets` and `createScope`.
- All eight prior inline bodies remain; the new total is nine.
- `fixed-opt-code.log:889` lists those nine bodies.
- `base-presets-opt-code.log:94` calls `ArrayIteratorPrototypeNext`.
- The fixed optimized create code has no iterator allocation or that call.

The trace driver runs 30,000 creates and keeps 64 returned handles.
It reads no clock; the timing proof comes from the queue below.
Logs and the name map live in `packages/core/scratch/create-presets/`.

## Queue proof

Each scenario has 61 A/B pairs, through `bench/queued.sh` on one core.
Each number below is the median in ns per call.
“B slower” counts pairs where this change took longer than the base.
A verdict needs a median gap over 2% and more than 45 of 61 pairs.
Other results mean “no difference we can see.”

- **create:** 205.5 → 184.1 ns.
  Change: −10.41%; B slower: 0/61.
  Verdict: B faster.
- **op:** 101.0 → 101.0 ns.
  Change: 0.00%; B slower: 25/61.
  Verdict: no difference we can see.
- **run:** 113.1 → 113.1 ns.
  Change: 0.00%; B slower: 26/61.
  Verdict: no difference we can see.
- **session:** 1684.0 → 1682.0 ns.
  Change: −0.12%; B slower: 31/61.
  Verdict: no difference we can see.
- **tagged:** 2142.0 → 2133.0 ns.
  Change: −0.42%; B slower: 27/61.
  Verdict: no difference we can see.
- **lifecycle:** 947.5 → 925.0 ns.
  Change: −2.37%; B slower: 18/61.
  Verdict: no difference we can see.
- **cold:** 754.7 → 739.7 ns.
  Change: −1.99%; B slower: 9/61.
  Verdict: no difference we can see.

Lifecycle won only 43 pairs; cold's gap stayed below 2%.
No scenario has a “B slower” verdict.
The queue run ended with `BENCH_EXIT=0`.

```bash
N=61 A=../tinkered-inv-main \
  SCEN="create op run session tagged lifecycle cold" \
  bench/queued.sh
```

Paseo restarted after create finished.
The lead recovered its 122 rows; the other six scenarios then ran together.
The local proof folder holds `ab-create.csv`, `ab-rest.csv`, and `ab-all.csv`.
The combined file has 854 rows: 61 complete pairs for all seven scenarios.
`bench-summary.json` keeps the unrounded changes and pair counts.

## Checks

```bash
vp run -r build && vp check && vp run -r test
EXIT=0
```

- Core tests: 636 passed.
- `vp check`: 0 errors, 21 warnings.
- Promises: sync 0, async 5, tagged 17.
- `node scripts/validate.mjs`: all 44 lanes PASS.
- Hot names: 248; last slot: 250; headroom: 5 names.
- Changed-function strict style scan: OK.
- TSDoc check: 0 S26 rows.

The full-file style scan hits the unchanged `panics[0]` at line 2102.
The base has the same S14 hit; `panics` is an array, not a tuple.
The ticket's allowed code area excludes that function.

Jev's file judges skip core because it exceeds their size limit.
Its unit checks passed both changed helpers.
All 55 findings that need labels concern unchanged core helpers.
Their false labels and reasons are in `jev-cases.jsonl` and `jev-labels.txt`.
These stay in the local proof folder because the global bank is outside the ticket's file limit.

Core feedback: none; this change needed no API workaround.
