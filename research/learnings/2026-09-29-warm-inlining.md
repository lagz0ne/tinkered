# A smaller helper can make a warm read slower

The tagged stack kept the saved resource record from main,
but its warm read was slower in the N=61 landing run.
The module-slot guess was wrong: the hot reads stayed below 256.

A small loop with one call showed full inlining on both builds.
The real probe repeats four calls per loop.
Its V8 trace showed main expanding one whole call.
The tip expanded three wrappers, then left calls inside them.

`fcff717` split first-time node creation out of `nodeState`.
That cut its bytecode from 47 to 28 bytes.
A later controller change cut another 35 bytes.
The warm function's inlined code fell from 611 to 557 bytes.
These smaller sizes changed the caller's inlining choices.

Putting record creation back in `nodeState` restores the
single complete expansion, with 613 bytes inlined into `warm`.
The first N=31 screen was 16.0 ns on main and 15.9 ns on the fix:
no difference we can see.
The shared empty stores and lazy tagged frames stay in place.

An inherited empty map restored V8's constant map read,
but did not restore the measured speed.
Splitting plain and namespaced resource resolve made it worse.
Both experiments were dropped.

Read the real caller's V8 trace before shrinking helpers.
A complete expansion and a partial expansion have different costs.
Bytecode size alone does not say which build will run faster.

Proof: the `perf/tagged-close` entry in `docs/roadmap/core-v1/PROGRESS.md`.
