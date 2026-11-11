# The request path: where the time went

Duke saw the bench page show Tinker a little slower than Jotai.
This note records what the search found, what changed, and the proof.

## No release made Core or React slower

Chromium, the update row, Tinker over Jotai, for each release
from 0.12.0 to 0.17.7: 1.05 to 1.13.
The fan-out row: 0.89 on each release.
The old playground page and the new site page give the same ratios.

The new page reads slower for two other reasons:

- Its spreads are tighter, so it prints a gap the old page hid.
- Each timed mount was an operation, so each mount exported a span.
  The span cost was inside the timed batch, the same for each library.
  The mount row read 200 µs. Without the span it reads 94 µs.

The fix: a timed mount runs in a namespace with `observe: false`.

## React: one context, not two

Each provider above a component is one more step in React's walk
for each sibling that does not render again.
`ScopeProvider` put two providers there: the scope and the namespace.
Now one context holds both.
Precedent: react-redux 7 keeps the store and its subscription in one context.

- Instructions per update (Node, happy-dom): 147.1k to 142.3k.
- Chromium, turn by turn: 5.44 µs to 5.22 µs.
- Tinker over Jotai: 1.087 to 1.064.

A reducer in place of `useSyncExternalStore` gave 0.98.
Duke kept `useSyncExternalStore` (2026-11-11): ADR 0030 stands.

## The rpc client waited 1 ms for each frame

`post` sent the frame of a tick from `setTimeout(fn, 0)`.
Bun and Node wait at least 1 ms for a timer.
A browser waits 4 ms once timers nest five deep (the HTML timer clamp).

The fix: the next task, with no timer.

- Bun and Node: `setImmediate`.
- A browser: a `MessageChannel`, as React's scheduler does.

The browser branch does not run in `bun test`.
A `MessageChannel` in Bun and Node keeps the process alive,
so it cannot replace `setImmediate` there.
React's scheduler makes the same choice for the same reason.

`guide.list` over one socket, Bun to Bun:

- One call at a time: 1,362 µs to 108 µs.
- 8 in flight: 292 µs to 75 µs for each call.
- Client CPU for each call: 164 µs to 40 µs.

Chromium, 8 in flight: 191 µs to 138 µs.
A lone call from Chromium stays near 430 µs.
A raw frame to the same server, with no client code, takes 260 µs there.

## The rpc client kept one listener for each call

A call with no signal of its own gets the scope's signal.
Each call added an `abort` listener to it and never took it off.
16,000 calls took the client from 62 MB to 123 MB.

The fix: the call takes its listener off when it ends.
A test counts the listeners on the scope's signal.

## A route match ran URLPattern two times

`routes` ran `pattern.test` on each row, then `pattern.exec` on the match.
On a small table that was 43% of a health request.

The fix:

- A row with no param is one Map read by `"METHOD /path"`.
  Precedent: Hono's router answers a static path from a map.
- A row with a param keeps its URLPattern, matched once.
- The first row that fits still wins, by table order.

## A hook made a logger for runs that were not its own

Core makes an event's logger on the first read of `log`.
The socket hooks took `log` out of the event before they looked at `op`.
So each run in the scope made one logger: five closures.

The fix: a hook reads `op` first.
The protocol reads `log` only when it logs a fault.

## Trace ids: hex by a table

`hex` made 16 digits with `toString(16)` and `padStart`.
On V8 it was 28% of a traced request whose sink reads the ids.
Each real sink reads them.

The fix: a table of the 16 digit codes and one `String.fromCharCode`.
Precedent: the `uuid` package writes its text from a byte table.

Time for one id, above the loop's own cost:

- Node 22: 311 ns to 9 ns.
- Bun 1.4: 127 ns to 45 ns.

A session, a run through three hooks, and a close, with a sink:

- Node 22: 2,354 ns to 1,359 ns.
- Instructions (cachegrind): 22,489 to 17,975.
- Bun 1.4: 3,130 ns to 2,704 ns.

Tried and dropped, each slower on Bun than `padStart`:

- A table of 256 two-digit strings, joined with `+`.
- One `fromCharCode` for each word, then `+`.
- A string table read with `[]`.

`hexOf` sits after the hot names in `index.ts`.
So it takes no context slot below 256.

## The server, old tree against new, turn by turn

The site server on Bun, main thread CPU for each unit,
the median of 6 runs:

- `GET /api/health`: 40.9 µs to 29.7 µs.
- One rpc call, 8 in flight: 51.1 µs to 39.5 µs.

The server's memory grows to about 155 MB under load, then stops.
That is the heap, not a leak.

## Found, not changed

- `AbortSignal.any` costs 4.1 µs on Node 22 and 0.9 µs on Bun.
  `routes` and the socket server call it for each request.
- A call with a signal costs 1.2 µs more on Node and 1.7 µs on Bun.
  It gets its own layer, a listener, and the waiting end (ADR 0090).
- The telemetry worker uses 20 to 27 µs of CPU for each rpc call.
  It is off the request thread.
- Core has 1 byte left under its size cap with rpc (32,767 of 32,768).

## How it was measured

- Instructions: `valgrind --tool=cachegrind`,
  `node --single-threaded --predictable`, the lowest of 3 slopes.
- Chromium: Playwright, two builds turn by turn.
- The server: `/proc/<pid>/task/*/stat`, CPU for each thread,
  old tree and new tree turn by turn.
- `benchd` does not run in the cloud session that did this work.
  So no number here is a `bench/queued.sh` row.
