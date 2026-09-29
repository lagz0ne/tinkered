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

## The fixed version

- **op:** 69.9 to 66.2; slower 5/31; b is faster.
- **opsink:** 68.1 to 63.6; slower 4/31; b is faster.
- **oplog:** 282.0 to 274.4; slower 7/31; b is faster.
- **opobs:** 184.1 to 1241.8; slower 31/31; b is slower.
- **tagged:** 170.6 to 169.0; no difference we can see.
- **session:** 573.0 to 573.6; no difference we can see.
- **cold:** 662.4 to 666.5; no difference we can see.

`opobs` now makes two UUIDs and formats the ids for each root span.
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
