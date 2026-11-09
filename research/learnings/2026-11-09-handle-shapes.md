# Handle shapes: classes, not Object.create

Do not make a handle with `Object.create(handle)` over a handle you just made.
V8 then turns that handle into a prototype.
Each store on the new object makes new hidden classes.
No two handles share a shape, so V8 cannot reuse its work.
Precedent: Bynens and Meurer, "JavaScript engine fundamentals:
optimizing prototypes" (2018).

Three places did this:

- The starting handle of ADR 0128.
- A session under a root with `session` hooks.
  This was in Core before 0.12.
- A root with capsules or a signal, in `extendHandle`.

The fix uses classes:

- `HookedHandle` and `HookedSession` for hooked sessions.
- `StartingFace` and `SignalFace` for the starting handle.
- `ExtendedRoot` for a root with capsules or a signal.
- Only a root face given a signal has `closed`, so `SignalFace` is its own class.

The face forwards each member to its target.
A test lists every `Scope.RootHandle` member in an object
typed with `satisfies Record<keyof Scope.RootHandle, 1>`.
So tsc fails when a new member is not on the face.

A call after start returns `Promise.resolve(call())`.
For an async op this is the op's own promise, with no new one.
A sync throw still becomes a rejection.

Instructions per call, valgrind cachegrind,
`node --single-threaded --predictable`,
the lowest of 3 window slopes.
From 0.12.0, to 0.14.0, to the fix:

- `await` on the starting handle: 2,463, 3,026, 2,768.
- Hooked session, create, run, close: 75,084, 74,899, 32,700.
- The same session made on the face: 74,905, 127,614, 36,496.
- Root start with 3 capsules: 146,991, 207,713, 100,427.
- A sync `run` did not change: 968 plain, 979 on a capsule root.

Duke's rule (2026-10-16): flamegraphs, not timing claims.
The flamegraphs and the probe are in the review page and in
`/mnt/project-files/tinkered/plans/perf-0.14/`.

Runtime gzip: see the size line of the ticket gate in the commit.
The cap is 20,480 bytes.

The slot lane (`scripts/check-slots.mjs`) fails on 0.14.0 itself.
`resolveHeld` sits at slot 256.
The lane also looks for `index.mjs.map`.
Since 0.13 the code is in a shared `src-*.mjs` chunk.
The fix does not move `resolveHeld`.
