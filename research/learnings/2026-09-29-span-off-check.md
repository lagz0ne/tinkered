# Keep observation off cheap

`stack/t04` adds W3C ids when a span opens.
The first version put id creation in `openSpan`, after its off check.
Plain calls got slower even though they made no ids.

The fix keeps `openSpan` small and moves the observed work to `createSpan`.
Callers pass the `Obs` record they already read.
The built file keeps these as two functions.
The timing screen below proves the off path recovered.
It does not prove why V8 chose different code.

## How it ran

- Base: `origin/main`, `de72d42`.
- First version: `0e57097`.
- Fixed version: `f36bfac`.
- Two screens, each with 31 A/B pairs per case.
- One core through `bench/queued.sh` and `benchd`.
- Each screen held `/tmp/mutation.lock`.
- Each case used batch mode in 31/31 runs on each side.
- Values below are median ns per call, base then branch.
- A verdict needs a gap over 2% and over 23/31 pairs in one direction.
- Both screens ended with exit 0.

## The first screen found the off-path cost

- **op:** 68.9 to 80.4; slower 30/31; b is slower.
- **opsink:** 67.9 to 76.0; slower 30/31; b is slower.
- **opobs:** 186.5 to 1256.0; slower 31/31; b is slower.
- **oplog, tagged, session, cold:** no difference we can see.

## The off-path fix, before review

- **op:** 69.9 to 66.2; slower 5/31; b is faster.
- **opsink:** 68.1 to 63.6; slower 4/31; b is faster.
- **oplog:** 282.0 to 274.4; slower 7/31; b is faster.
- **opobs:** 184.1 to 1241.8; slower 31/31; b is slower.
- **tagged:** 170.6 to 169.0; no difference we can see.
- **session:** 573.0 to 573.6; no difference we can see.
- **cold:** 662.4 to 666.5; no difference we can see.

That version of `opobs` made two UUIDs and formats the ids for each root span.
Its extra work remains visible: about 1.06 microseconds per call.
There is no claim that tracing is free.
With observation off, the ambient random stream stays untouched.
The trace tests prove that through the public API.

## Proof

- Build, `vp check`, core, Hono, and HTTP tests passed after the split.
- The final source uses all 253 hot names: last slot 255, no headroom.
- The raw rows live in the writer worktree's `.bench` folder.
- First screen: `stack-t04-ab.csv`.
- Fixed screen: `stack-t04-ab-guard.csv`.
- Full logs and the writer report: `stack-t04-proof/`.
- The lander still runs 61 pairs before landing.

## Fix round: draw now, format on read

The lead rejected the observed-call cost above.
The new span class replaces the old `createSpan` function.
It adds no module-level name.
The hot count stays 253, last slot 255, with zero spare slots.

- Random bits come from the ambient `random.next()` at open.
- A fresh root takes five draws: three for its trace, two for its span.
- A child or a seeded root takes two draws for its span.
- The trace stores 52 + 52 + 24 bits in three numbers.
- The span stores 32 + 32 bits in two numbers.
- A zero final part becomes one, so neither id can be all zero.
- Getters make lowercase hex text only on read and cache it.
- Each trace has one shared text cache, used by all its children.
- A child copies parent bits without retaining the parent span.
- Empty attributes and event lists are made on first use.
- Public ID reads still return strings.
- Tests cover late reads, seeded replay, zero, and fractional draws.

### Three layouts, each against the same base

Each screen used `de72d42`, N=31, and the same seven cases.
All held the mutation lock and ran through the queue.
All rows used batch mode in 31/31 pairs and exited 0.
These are separate base comparisons, not a direct layout A/B test.

- First: four trace numbers, with draws in the span constructor.
- `opobs`: 188.1 to 270.9 ns; slower 31/31; b is slower.
- Second: move shared trace creation to a static class method.
- `opobs`: 184.9 to 263.0 ns; slower 31/31; b is slower.
- Third: pack the trace into three exact numeric parts.
- `opobs`: 187.1 to 246.9 ns; slower 29/31; b is slower.
- The constructor shrank from 365 to 248 bytes of V8 bytecode.
- V8 inlined the five random calls and the clock into that constructor.
- It inlined the constructor into the standalone open helper.
- The larger operation call path considered it but did not inline it.
- The trace does not print a reason for that choice.
- Runs with V8 tracing flags are diagnostic proof, not timing proof.

### Final screen

- **opobs:** 187.1 to 246.9; slower 29/31; b is slower.
- **op:** 67.4 to 63.5; slower 3/31; b is faster.
- **opsink:** 66.9 to 62.9; slower 1/31; b is faster.
- **oplog:** 282.3 to 278.3; slower 10/31; no difference we can see.
- **tagged:** 182.5 to 179.0; slower 16/31; no difference we can see.
- **session:** 621.7 to 626.7; slower 20/31; no difference we can see.
- **cold:** 724.4 to 714.9; slower 15/31; no difference we can see.

The observed-call target is still missed by 59.8 ns in this screen.
No other checked case is slower.
The remaining work draws five numbers and saves the bits and trace cache.
No ID text is built in this case.
Deferring those draws would break the agreed order of the random stream.
Reducing the ID width or pooling saved spans would change the contract.
The three trials do not prove that no other layout could be faster.
The lead must take this remaining gap to the user before landing.

Raw rows are `stack-t04-lazy-1.csv` through `stack-t04-lazy-3.csv`.
Logs and V8 proof are in `.bench/stack-t04-fix-proof/`.
The earlier report stays as history of the rejected UUID path.

## Private ID stream (lead fix round 2)

The ambient-draw design above changed application results with observation on.
It is superseded by a private xorshift128 generator.
`makeTestRandom` registers a second seeded state in a module-private WeakMap.
The system and custom sources use core's state, seeded once from crypto.
The public mulberry32 code and its draw order are unchanged.
Four 32-bit words fill a trace without the old seeded zero gaps.
Reusing the no-op function as the off logger leaves one spare hot-name slot.

The first layout draws four words for a trace and two for each span.
N=31 through the queue, base `de72d420`, gives:

- opobs: 184.3 -> 213.2 ns; slower 31/31; b is slower
- op: 69.7 -> 65.9 ns; slower 1/31; b is faster
- opsink: 71.9 -> 67.3 ns; slower 3/31; b is faster
- oplog: 317.5 -> 304.4 ns; slower 5/31; b is faster
- opres: 304.1 -> 276.0 ns; slower 14/31; no difference we can see
- tagged: 172.6 -> 173.5 ns; slower 14/31; no difference we can see
- session: 569.7 -> 575.5 ns; slower 17/31; no difference we can see
- cold: 668.6 -> 669.8 ns; slower 16/31; no difference we can see

All eight cases used batch mode, 31/31 per tree; `BENCH_EXIT=0`.
