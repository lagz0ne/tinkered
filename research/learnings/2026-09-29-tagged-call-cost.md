# Learnings: a tagged call from 2130 ns to ~500 ns (2026-09-28/29)

Sessions perf/tagged-close, fp (round 1), fp2 (round 2), fp3 (round 3), the fix rounds, and the
reviews. Timing only through `bench/queued.sh` on benchd (N=31 or 61, one core, A/B alternating,
base `c5d1921`); V8 evidence from `--print-bytecode`, `--trace-turbo-inlining`, `--trace-deopt`,
`--print-opt-code --code-comments` on the TypeScript source under type stripping. Reports:
`/home/paseo/next/tinkered-inv-reports/fp-fable.md`, `fp2-fable.md`, `fp2-fix-fable.md`,
`fp3-fable.md`, `fp2-opus.md`, `fp3-check-astra.md`, `fp3-review-opus.md`.

## What cost what (`tagged` median ns against main, all B faster 31/31)

| step                                                               | commit    | tagged | session | what it removed                                                                                                                                          |
| ------------------------------------------------------------------ | --------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main                                                               | `c5d1921` | ~2140  | ~1680   | —                                                                                                                                                        |
| idle end in place (step 1)                                         | `6e8d8b1` | 1368   | 965     | the async close protocol on a session with nothing to tear down: 10 promises, 3 async frames, a sweep, a cancel reason, a record scan, two settle passes |
| plain value ends with no tick (step 2) + replay bare + tag seed    | `abffebf` | 1044   | 745     | the body promise, its reaction, one await; the replay's controller and handle; the flat tag list                                                         |
| sync prefix outside the async function                             | `22e164d` | 992    | 660     | the async frame on the in-place path; `runSession`'s own async wrapper (one promise and two turns per `session()`)                                       |
| fix round (B1/B2/B5/B6/B7)                                         | `9687dbc` | 1121   | 859     | nothing; it restored the aborted flag, watcher and swept guards, one `then` read. The switch-off default cost `session` 190 ns                           |
| Opus: route, slot room, shared empty collections, lean child start | `fb35497` | 909    | 781     | the `SESSIONS` table walk, per-layer chain copies, five collections and a pair object per idle layer                                                     |
| decision A (handle closes with its body) + R2 (a value in place)   | `3b00ac4` | 716    | 522     | the last promise and the caller's microtask hop                                                                                                          |
| run-side cuts 1–7 + Opus's piece D                                 | `10f8c61` | 477    | 533     | the child's `NodeState` memo per data read, the tag `Map`, the body closure, two per-run closures, the executor closure and its context, idle-end guards |
| reviewer fix round (ctx rebuilt per run, and nine more)            | `9f11949` | 514    | 535     | +37 ns: the ctx object on every run again (finding 1)                                                                                                    |

Promises per tagged sync call: 17 → 0 made by core (the census's two are its own `await`).

## Where the numbers came from

- `bench/promises.mjs` with an `async_hooks` stack trace per promise (`/tmp/fp-fable/promise-trace.mjs`
  at the time): the 17 were 1 API promise, 1 census await, and 15 that served cases the run was not in.
- `--print-bytecode-filter='*'` on one call lists which functions V8 compiled at all: "not compiled on
  the loop" proves a path is gone (the whole close chain, `OperationCtx`'s constructor, `handleFor`).
- `--print-opt-code --code-comments` on the optimized `runTagged` shows inline allocations by their
  map constants: `Map(FUNCTION_CONTEXT_TYPE)` is a closure context, `Map[56]` a closure, `Map[160]` the
  17-field `NodeState`, `Map[240]` the layer record. Counting them before and after is the cheapest
  allocation census; static counts include cold branches.
- Heap per request (`bench/heap.mjs`): 5351 → 2656 B when the close protocol left.

## Traps

- **`Function.length` proves nothing about a body.** Cut 3 skipped the ctx when `run.length < 2`.
  A wrapper `(...a) => fn(...a)`, a defaulted `(d, ctx = x)`, and `arguments[1]` all read ctx with a
  length of 0 or 1. 636 tests missed it; a side-by-side comparison of 758 schedules (Astra) and four
  hand probes (Opus) caught 16 cases. Reverted; six seam tests pin the three forms.
- **The existing suite is not a behavior oracle for a close-path change.** Five outcome regressions in
  22e164d (a live signal after close, lost watcher events, a parent close inside a sync body no longer
  cancelling, a `then` getter read twice or outside the try) passed all 636 tests. They surfaced only
  from a main-vs-branch comparison over 433 schedules. Run that comparison before calling a close
  change behavior-neutral; keep the harness (`fp2-check-astra/`, `fp3-check-astra/`).
- **mitata's timing mode.** Each probe process lands in one of two speed modes about 200 ns apart, and
  the median moves with how many processes land in each. Read verdicts by pairs (k/31), compare medians
  loosely, and prefer two samples of one build over one.
- **A `pkill -f` pattern matched another agent's driver.** Stop a process only by its own exact PID.
- **The slot guard reads the built dist.** A guard run on a stale `dist/` said headroom 0 while a fresh
  build said −1. Rebuild before reading it. Every new hot name needs a cold one moved below the
  release block first.
- **Complexity cap 8 and the pre-commit hook.** A ten-condition idle test does not commit; split the
  predicate. A python edit whose assertion fails must gate the `git add` that follows it, or a rebase
  commits conflict markers.
- **A default parameter on an async function widens its bytecode**, and a closure passed as a body is
  a closure plus a context per call even when V8 inlines the callee. Pass plain parameters; call the
  replay directly where no hook needs a function.
- **A shared resolved `Result` must not be handed out.** A late `close()` on a session that ended in
  place now gets its own object; the shared promise is only a marker.

## What still stands between ~500 and the floor

The layer record itself (240 bytes, 27 fields) and its parent link, the `{ tags, ns }` options object,
the tags list copy, the op body's own work on the child, and the idle end's detach. A leaner layer
record is the next lever; the rest is small. R1 (tags as values, no child session) measured 220 ns and
was rejected: it drops the run's lifetime, its failure boundary and its session hooks.
