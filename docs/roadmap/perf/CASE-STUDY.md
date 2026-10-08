# Case study: the code against the fast-code rules

Date: 2026-10-08. Main at `bca0063f`.
Rules: [docs/fast-code.md](../../fast-code.md) (F1–F14, A1–A6).
Three studies, one per package, measured on that main.
Full reports and probes stay outside the repo,
in `/home/paseo/perf/rules-case/<pkg>/`.

## How to read it

- **Eliminate:** remove the break; the fix is known.
- **Mitigate:** make it cheaper; some cost stays.
- **Accept:** keep it, with the reason.
- The extension hooks (ADR 0050, 0060) stay.
  Plans only make them cheaper.

## Bugs found on the way

- React: an error thrown in `useRun`'s `onSuccess`,
  `onError`, or `onSettled` disappears from `run()`.
  `runAsync()` rejects though the operation worked.
- React: a sync `useRun` click renders twice:
  pending, then success, one task later.
- Scaffold: `auth.ts:9` builds a new better-auth
  for every request (`target: "session"`).
- Start: telemetry drops about 89% of records
  above about 16 pages a second, with no notice
  (64 records per 1 s tick).

## Core (F1–F14)

Still open from the perf study:

- Each scope handle holds 12 closures (F6).
  - Prototype: open and close 1,827 → 1,024 B.
  - b is faster: 354 → 279 ms (300,000 scopes).
  - +75 B gzip.
  - Open question: may users spread a handle
    (`{ ...scope }`) or destructure a verb
    (`const { run } = scope`)?
- `layer` reads see 2 shapes; frames gain fields late (F3).
  - Prototype: 18 → 15 polymorphic sites, +35 B gzip.
- `deps[key] = value` is megamorphic (F4).
- Brand checks see up to 4 shapes (F5).
- `track()` adds a `.then` that cuts async stacks
  to 1 frame at depth 32 (F14). Needs a decision.
- 30 wide operand loads in hot functions:
  hot names sit past context slot 255 (F9).
- A resource dependency costs about 800 B
  and 1 promise per run (F6, F7).
- A hooked run makes 2 closures;
  `runHookBody` is over 460 bytecode bytes (F1, F6).
- A cell write visits every open session,
  even ones that do not read the cell.

Fixed since the study: `OperationCtx` inlines into
`runOnce`; the `defer` closure is lazy.

## React (F1–F14, A1–A6)

- `useRun`: 1,192 B per render and 9 hook slots (F6).
- `useResource`: 856 B per render
  (1,066 B with `suspense: false`).
- The selector store: 57 B per subscriber per write.
- `useData` reads its stores at a 2-shape site (F3).
- `isThenable` goes megamorphic past 5 value kinds (F5).
- Prototype of the first three:
  b is faster, 1,636 → 1,316 ms (−19.5%).
- Playground: every tile calls `useRun` for one click;
  each keystroke saves all files to `localStorage` (A3).

## Start (F1–F14, A1–A6)

- One SSR page makes 316 promises; 71 are ours (F7).
- Each SSR page makes a reasonless abort (F8):
  1 per page, 3 with sync on.
- Compression holds every byte until the page ends.
  Fix it before any streaming work.
- Telemetry turns each log record into JSON 3 times (F11).
  - b is faster: −54.8% with one stringify.
- Sync: one commit with 1,000 streams does 1,000
  account reads and 1,000 frame serializations (F11).
- The app's server chunk has 1,029 top-level names,
  so 29 Core functions pay wide loads there (F9).
- Static hits make 3 file system calls each (F10).
- Scaffold: mail runs before the reply (A6);
  sign-up waits for the email.

## Tickets, best gain for the effort first

1. `react/run-callback-errors` (XS, bug).
2. `scaffold/auth-scope` (XS): one better-auth per process.
3. `start/abort-reasons` (XS): no reasonless abort.
4. `react/run-sync-first` (S, bug): one render per sync click.
5. `react/data-zero-alloc` (S).
6. `start/compress-stream` (S): first bytes at 2–8 ms.
7. `start/telemetry-serialize-once` (M) and
   `start/telemetry-capacity` (S, needs a choice).
8. `start/sync-frame-share` (S).
9. `core/shape-preinit` (S) and `core/run-budget` (S).
10. `core/slot-order` (S, mechanical).
11. `react/run-lean` (M) and `react/resource-lean` (M).
12. `core/handle-proto` (M): after the spread question.
13. `core/borrow-lazy`, `core/hook-run-lean`,
    `core/brand-kind` (M each).
14. `start/request-hops` (S–M): about 25–30 promises
    fewer per page.
15. `start/sync-heartbeat-wheel` (M–L) and
    `start/sync-push-revocations` (L, needs an ADR).

Core cards follow the Core lane: `scripts/ticket.sh`,
`N=61 bench/queued.sh`, mutation floor 85.

## Open choices

- Core handle: are `{ ...scope }` and
  `const { run } = scope` supported?
- `track()` and async stacks: keep the extra `.then`,
  or drop it and lose nothing else.
- Sync revocations: push a sign-out notice
  instead of checking each account on every wake.
  This needs an ADR.
