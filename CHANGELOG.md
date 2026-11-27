# Changelog

Each section is one release of
`@tinkered/core`, `@tinkered/react`,
`@tinkered/bun`, `@tinkered/cli` and
`@tinkered/entry` (from 0.29.1), and
`@tinkered/devtools` (after 0.31.1).
Up to 0.25.1 the last was `@tinkered/analyze`.
Up to 0.17.10 they were `@tinker/*`.
They move to one version together.

## 0.34.17

A foreign callback lives in a capsule (#70,
Duke's comment).

- `@tinkered/core` capsule skill: the pattern
  "A foreign callback lives in a capsule". A
  `MessagePort` listener is written in place in
  the `start` hook and enters a run with the
  hook's `run`; `closing` takes it off.
- `@tinkered/cli`: `tinker/plain` passes a
  function in a list written in place in a
  library call's options:
  `Bun.build({ plugins: [{ setup() {} }] })`.
  Before, only objects counted. A named plugin
  in the list still fails.

## 0.34.16

An adapter is a backend capsule in an op slot
(#67, Duke's pick).

- `@tinkered/core` capsule skill: the pattern
  "An adapter is a backend capsule in an op
  slot", with a mail example. A backend
  capsule's operation fills the app capsule's
  slot: `mail({ backend: queuedMail.deliver })`.
- New common mistake: an adapter as
  `{ key: fn }` in a tag.
- `@tinkered/cli`: `tinker/plain` says
  "a plain function in an object, `{ key: fn }`"
  for a function in an object value (not in a
  call's options). Its fix is that section.
- `tinker/plain` stays as strict as before.

## 0.34.15

`@tinkered/cli`: the graph names a call through
a capsule export or an op slot (#69).

- An op or a cell a capsule exports is named
  as its import is: `depends: { send: mail.send }`
  gives `calls{mail.send}`, not `calls{?}`.
- A call of the op a tag holds (an op slot,
  ADR 0151) gives `calls{slot:<tag label>}` and
  `faults{?}`. Before, it gave `calls{?}`.
- A graph rule cannot prove a `slot:` call, as
  with `?`: the finding names the slot.
- An app with such an op gets a `tinker/graph`
  finding on its line: run `tinker graph --write`.

## 0.34.14

`@tinkered/cli`: the graph check compares
parts by name (#68).

- A line that lacks a part, or has one more,
  is one difference for that part. Before, a
  missing part shifted each later part, so the
  check named each of them.
- A part only the file has reads
  `no <name>, tinker.graph says <part>`.

## 0.34.13

`@tinkered/cli`: `tinker.graph` names its format;
an old file is one finding (#68).

- `tinker graph --write` writes
  `# tinker.graph 2` as the first line.
  `tinker graph` prints no format line.
- A file of another format, or with no format
  line (format 1, up to 0.34.12), is one
  finding: run `tinker graph --write`, read the
  diff, and commit it. Before, each line was a
  finding (1374 in one app).
- A change to the line shape raises the format,
  with a line here that names the shape.
- An app that reads `tinker.graph` skips the
  lines that start with `#`.

## 0.34.12

`@tinkered/bun`: `serve` takes a `hostname`
(#63).

- `serve({ port, hostname: "127.0.0.1" })`
  listens only on that address (Node's
  `listen(port, host)`, Bun's `hostname`).
- Unset, it listens on every interface, as
  before.
- The `url` cell and the
  `tinker: listening on <url>` line name the
  address.

## 0.34.11

`@tinkered/bun`: a 413 behind a proxy
reaches the client as 413, not 502 (#61).

- Before, `serve` closed the connection
  with the body still unread. The socket
  then reset, and a proxy that was still
  sending the body answered 502.
- Bun's own 413 (past `maxRequestBodySize`)
  did the same. Now each cap is `serve`'s:
  Bun's limit is out of the way.
- Now a reply that leaves the body unread
  waits: `serve` reads the rest and drops
  it, then sends the reply (nginx's
  lingering close, RFC 9112 9.6).
- The connection then stays open.
- `serve` reads for up to 30 s. Past that,
  the reply closes the connection, as
  before.

`@tinkered/bun`: the socket compresses
large frames (#62).

- A client that offers permessage-deflate
  gets it: one shared compressor, no
  context kept between frames.
- A frame of 1 KiB or more goes compressed.
  A smaller one goes as is.

## 0.34.10

`@tinkered/cli`: a view line for each React
view (#58).

- `tinker graph` adds a line for each top-level
  declaration that calls `useData` or `useRun`
  from `@tinkered/react`:
  `view src/home/home.tsx#SignIn reads{…} runs{…}`.
- `reads` and `runs` use the op line's words.
  A first argument the graph cannot name is `?`.
- Only a named import counts. A custom hook gets
  its own line; a component that calls it gets
  none.

`@tinkered/cli`: each op line lists the faults
its rpc calls can end with (#60).

- `faults{…}` follows `exits{…}`: each fault of
  Core's `Fault` set, for a call of a named
  contract member. The set is read from Core's
  own type.
- A `?` in `calls{}` gives `faults{?}`.

Each op line gets a new part, so a committed
`tinker.graph` needs `tinker graph --write`
once after the upgrade.

## 0.34.9

`@tinkered/core`: `api.contracts` is the
object given to `rpc()` (#54).

- Before, the type said `contracts`, but the
  value was `undefined`.
- Now each address's `input` and `output`
  schemas are on `api.contracts[address]`.
- `rpc()` refuses an address named `contracts`,
  `receive`, `addresses` or `uploads`: the
  handle's own members. `remoteData` refuses
  them as cell names, with its own message.

`@tinkered/core`: `DataValidationFailed`'s type
names both payloads (#55).

- A parse gives `{ label, cause }`. An rpc
  call's input check gives `{ address, issues }`.
- Narrow with `"label" in error.payload`.
- Types only: no byte changed.

`@tinkered/core`: a keyed resource watch on a
closed scope raises `Disposed`, also while
another reader watches the entry (bug 18).

`@tinkered/cli`: the graph names more, and a
rule can select by resource (#56, #59).

- Each graph line ends in `uses{…}`: the
  resources an op's `depends` names.
- A graph rule selects ops by `writes` or by
  `uses` (ADR 0167, amended).
- The graph names a capsule's rpc contract
  member and an `atScope` controller, in place
  of `?`.

## 0.34.8

`@tinkered/bun`: a reply that leaves the
request body unread closes the connection.

- Before, a handler that answered before it read
  the body kept the connection open. The client
  went on sending, and a graceful `stop()` could
  wait on it.
- Now `serve` adds `connection: close` to a
  handler's reply, and to its own 404 and 413,
  when the body was not read to its end.
- `ws.server`'s bytes POST does the same, also
  on a bare `Bun.serve` host.
- A body read to its end keeps the connection
  open.

`@tinkered/react`: `useData` stays quiet when
its scope closes.

- Before, a scope that closed between React's
  commit and its subscribe threw `Disposed`
  from the subscribe.
- After a close, a written cell reads its
  initial value again (ADR 0069). React saw
  that as a change and rendered again, and the
  render threw `Disposed`.
- Now a subscribe on a closed scope takes no
  subscription, and `useData` keeps the last
  value it read while the scope was open.
- A render after the close still throws
  `Disposed` (ADR 0144 d3).

`@tinkered/core`: a keyed watch on a closed
scope throws `Disposed` and leaves no part.

- Before, a refused watch left its part, and
  the next `where` gave back the same reader.
- Before, a new part's watch on a closed scope
  threw nothing when another part was watched.
  On a `remoteData` board it asked the server.
- The no-rpc size cap is 23,457 B, up 10 B for
  this check (Duke 2026-11-24).
- The core/rpc skill says a read guard also
  gets one member by its whole key
  (ADR 0138 d11).

## 0.34.7

`@tinkered/bun`: each handler reads a body
up to its own `maxBody`, 1 MiB when unset
(#57).

- Before, `serve` set one limit for the server:
  the largest `maxBody`. So one 16 MiB
  `bytes()` key let every route read 16 MiB.
- Now a read past the handler's own `maxBody`
  fails, by Content-Length or by count.
  `serve` answers 413 and closes the connection.
- A `bytes()` key still takes its own max.
- The largest `maxBody` is still Bun's
  `maxRequestBodySize`, the server backstop.
- A handler with a body gets a copy of the
  request. Its `server.requestIP`, `timeout`
  and `upgrade` still take that copy.

`@tinkered/core`: no API change.

- A member ask's fault now puts its part in
  fault (bug 17, ADR 0139 d4).
- Before, one member refused showed the fault
  in `board.faults`, but the part stayed
  `ready`.

## 0.34.6

`@tinkered/core`: no API change. A stream
call keeps its `signal` and `tags` for its
stream (ADR 0169), as `fetch` does.

- A stream call with a `signal` or `tags`
  answers at once. Before, a stream run here
  never answered.
- A remote stream with a `signal` or `tags`
  reads every value. Before, it was cut when
  the call answered.
- The caller's signal ends the stream clean,
  as a break does.
- The call's tags bind the stream's own run
  and its lifecycle hooks.
- A signal that already aborted starts
  nothing.

## 0.34.5

`@tinkered/cli`: `tinker.json` takes
`graph.rules`, and `tinker check` tests them
(ADR 0167).

- A graph rule says: each op that writes these
  cells must call this op.
- The graph stage reports each op that breaks
  a rule as `tinker/graph-rule`.
- A `?` in `calls{}` on the way is a finding:
  the rule cannot be proved.
- `except` names an op, with its reason.

`@tinkered/core`: no API change.

- The core/operation skill has a section
  "one check written in two operations".
- It says: read `tinker.graph` before you write
  a check, and call the op that already makes it.

## 0.34.4

`@tinkered/core`: no API change.

- Core's hot run path is back under its
  bytecode budget.
- A plain op and a plain run are 2-5% faster
  in the bench.
- A capsule check now also guards an `ns` call
  made after its run closed.

## 0.34.3

`@tinkered/bun`: a ws stop in the same frame
as its watch now ends the watch.

- Before, the server kept a watch's stop only
  after its session opened.
  A stop sent in the same frame found nothing.
  The server stream ran until the socket closed.
- Now the stop is kept at once.
  A watch stopped before it starts runs nothing.
- A watch now counts toward `maxWatches`
  from the moment it arrives.

## 0.34.2

`@tinkered/entry`: `http.request` puts its
attributes on its own span (ADR 0058).

- Before, it opened a second span by hand,
  `http GET /path`, only to hold the method, the
  path and the status.
- Now `http.request`'s own span holds
  `http.request.method`, `url.path` and
  `http.response.status_code`. A trace has one
  span less per request.

## 0.34.1

`closed` now follows a start's first cause, as
`settled` does (ADR 0165 d2).

- Before, a `close()` during start, then a start
  error, gave `settled` cancelled but `closed`
  failed, with the error in `teardownErrors`.
- Now both report cancelled, and the late error
  is dropped.
- A start error that comes after a start timeout
  is also left out of `teardownErrors`.

## 0.34.0

A start's first cause now wins, and `settled` is
the twin of `ready` (ADR 0165).

- New: `scope.settled`, a promise that never
  rejects. It resolves to
  `{ status: "success", handle }`,
  `{ status: "cancelled", reason }` or
  `{ status: "failed", error }`.
- The first event that ends a start wins: a stop
  signal, a start hook's throw, a start timeout,
  or a `close()`. `ready` rejects with it, and
  `settled` names it. A later error is dropped.
  Before, the last event won (bug 3).
- Breaking: the handle's `settled()` is now
  `idle()`. Same behavior: it waits until the
  scope's in-flight work ends. Rename each call.

## 0.33.0

`remoteData` drops its old keyed board (ADR 0135;
Duke 2026-11-20 14:13: "During that journey,
we'll clean outdate, old deadcode").

- Breaking: `remoteData(cells, { config })` is
  gone. A board takes its cells only. A board
  read by part uses keyed cells (ADR 0136 to
  0138).
- Breaking: `board({ serve: true, fill })` is
  gone.
- Breaking: `transport.lifecycle` drops `isOwn`
  and `parts`. It gives `refuse`, `isRefused`,
  `runOf`, `hooksOf` and `runHooks` only.

## 0.32.5

A remote part whose last reader leaves while its
stream opens now ends that stream.

- Before, the stop signal fired during the open,
  before the stream listened for it. So the
  server stream stayed open until the root
  scope closed.
- Now the stream checks the signal once it
  opens, and ends at once if it already fired.

## 0.32.4

The bun client no longer opens a stray socket
after a drop.

- Before, a drop (a close or a `reset`) emptied
  the unsent messages, but the tick already
  scheduled still ran. With nothing to send, it
  opened a new socket that stayed open until the
  scope closed.
- Now a tick with nothing to send opens no socket.

## 0.32.3

Tests only: no code changes (ADR 0032 d2).

- A new React test pins that `useRun` does not
  render a hidden view when its run ends. The
  show then renders the latest state.

## 0.32.2

A `close()` after a failed build's dependency
is released now resolves (ADR 0063, ADR 0027).

- Before, the failed instance still held its
  dependency but had lost its edges. So the
  dependency's release waited for it forever,
  and the close that joins that release hung.
- Now a failed instance keeps its edges: the
  release ends it first, then the dependency.

## 0.32.1

A keyed resource whose source settles after the
scope closed no longer throws an unhandled
`Disposed` (ADR 0157).

- Before, the parked read woke after the close,
  read its source, and got `Disposed`, which
  nobody caught.
- Now a source that settles after the close
  wakes nothing.

## 0.32.0

A watch of `board.status(read)` now holds the
read's part, as a reader of the part does
(ADR 0164).

- Before, only a value read asked the server. A
  page that showed "loading" from the status
  alone, and read the value after `ready`,
  waited forever.
- Now the first holder asks, status or value.
  They share one ask. The part leaves with its
  last holder.
- The first holder hears `pending`, then
  `ready` or `fault`. A part that rides a ready
  part is `ready` at once.
- `get()` of a status is still a peek: it holds
  nothing.

## 0.31.17

A `ScopeProvider create` inside a `<Suspense>`
keeps its root under StrictMode (ADR 0031
amended).

- Before, each time the Suspense showed its
  content again, StrictMode replayed the effect:
  the root closed and a new one started, so a
  `SessionProvider` below it lost its data and
  the child suspended again, forever.
- Now a replay after the children rendered takes
  the same root back.
- A change you may see: on unmount, a rendered
  owned root closes one microtask later.

## 0.31.16

`await invalidate` on a refused keyed part waits
for its new answer (bug 12, ADR 0147; Duke
2026-11-19, option A).

- Before, it returned before any ask, while the
  part still showed its old fault.
- Now it ends with the reopened stream's first
  value or fault, or when the part leaves.

## 0.31.15

A session handle that leaked out of its body
refuses calls once the body ended (bug 9,
ADR 0071).

- Before, in a graceful root close, a session's
  body could end while its owned work still ran.
  A handle that leaked out of the body still took
  `onClose`, `resolve` and `controller` then.
- Now those calls throw `Disposed` once the body
  ended, with or without `session` hooks.
- Work the session still owns keeps running, as
  a graceful close says (ADR 0028).
- Core's size caps rose (Duke, 2026-11-20): no-rpc
  to 23,256 B, with rpc to 35,136 B.

## 0.31.14

A key the server refuses stops asking until you
`invalidate` it, and `invalidate` takes plain
keys (bug 13, ADR 0140 and ADR 0137 amended;
Duke 2026-11-19, option B).

- Any fault but `link` ends asking, for every
  key: `refused`, `invalid`, `failed`,
  `missing`, `encode`, `decode`.
- A change you may see: a plain key that got
  `failed` or `missing` used to open its stream
  again with back-off. Now it waits.
- A `link` fault still opens again with
  back-off.
- `invalidate` takes plain keys:
  `board.invalidate({ notes: {} })` wakes a
  refused plain key. It resolves on the new
  value or fault.
- An `invalidate` sent while the stream opens is
  kept: if that open ends on a fault, the stream
  opens once more.
- On a definition keyed by parameter, it wakes
  every parameter's refused entry.

## 0.31.13

React's tests now catch more mistakes, and
three dead checks are gone. No behavior change.

- Since ADR 0144, each provider remounts its
  subtree when its scope changes. So the scope
  checks in `SessionProvider`, `useResource` and
  `useRun` could never fire; they are removed.
- New tests cover `<Activity>` hide and show,
  late builds dropped by a refetch, a reset's
  new key, server renders, cell swaps, and
  `NoProvider` for every hook.
- React's mutation lane runs with a 60 s Stryker
  timeout and an 8 s per-test timeout; it scores
  88.5% on kills alone.

## 0.31.12

A `SessionProvider` inside a `<Suspense>` no
longer builds and closes its session in a loop
under StrictMode (ADR 0031).

- Before, each time the Suspense showed its
  content again, StrictMode replayed the
  provider's effect. It closed the session and
  opened a new one with no data, so the child
  suspended again, forever.
- Now a replay after the children rendered
  takes the same session back. The children keep
  their data.
- A change you may see: on unmount, the session
  closes one microtask later (it used to close
  in the effect's cleanup).

## 0.31.11

A keyed resource's readers share one entry
after its last watcher leaves and comes back
(bug 1, ADR 0150, ADR 0157).

- The entry still leaves its map when its last
  watcher leaves.
- Before, a reader that still held that entry
  could watch it again, and the next reader of
  the key built a second entry, with no change.
  Under StrictMode, or when a page swap kept a
  reader of the key, each source change then
  built the key twice.
- Now a watch of a dropped entry joins the key's
  live entry, or puts the dropped one back when
  the key has none. A read of it goes to the
  live entry too.
- So readers share one entry, a read with no
  change builds nothing, and an end runs before
  the next build of its key.

## 0.31.10

`useRun` keeps its latest state across a
Suspense hide and show, and fires its callbacks
once per run (bugs 15 and 16, ADR 0032).

- Before, a Suspense hide and show cleared a
  running run to `idle`.
- Before, `onSuccess` and `onError` never fired
  when the run ended while hidden or after the
  component unmounted.
- Now a show keeps the latest state, and each
  run fires its callbacks once. React state is
  still not written after an unmount.
- A change you may see (Duke agreed, 2026-11-19):
  under StrictMode, a replay keeps the run's
  state (was `idle`).
- A change you may see (Duke agreed, 2026-11-19):
  switching the provider
  remounts the subtree (ADR 0144), so the old
  run's callbacks now fire, as after an unmount.
  Changing the operation still drops the old
  run's callbacks.

## 0.31.9

Your own signal ends a remote stream clean, not
`failed` (bug 14, ADR 0133).

- Before, a caller's own `signal` that stopped a
  remote stream made it end `failed`, with a bug
  log on the server.
- Now a stream ends clean when its own session
  stopped it (memory and ws).
- An `AbortError` the caller did not cause (for
  example from a `meta` op) still ends `failed`.

## 0.31.8

A late answer no longer wakes a waiting keyed
part (bug 11, ADR 0139).

- A part the server refused waits for a trigger
  (`invalidate`, `refetchInterval`).
- Before, a late answer for it turned it
  `ready` with no stream, so later changes
  never reached it.
- Before, a broken link on a waiting part never
  healed.
- Now a late answer leaves a waiting part, and
  the parts that ride it, in their fault. So
  does an answer for a live part that holds it.
- Of late answers, only a broken link wakes it:
  it shows `link` and opens again with back-off.

## 0.31.7

A call stopped by its own signal fires its
`ctx.closing` too (bug 10, ADR 0104, ADR 0090).

- Before, a call signal aborted `ctx.signal`
  but not `ctx.closing`.
- So a session resource that ends its waits
  from `ctx.closing` kept the call pending
  until the root closed.
- Now the stop fires the closing signal first,
  then aborts `ctx.signal`. The call ends.

## 0.31.6

A root close called from a session's defer runs
the capsule close hook, and the first close's
mode wins (bug 8, ADR 0104, ADR 0029).

- Before, the root saw that close as re-entrant.
  It skipped the capsule close hook and closed
  forced.
- So a hook never ran (sync never ended its
  streams), and an app's graceful close turned
  forced: resources ended `cancelled`.
- Now the first root close always runs the close
  hook, once. A later close joins it, so its
  mode wins.
- A close called from inside a defer still gets
  an answer at once.

## 0.31.5

`close()` resolves after two resources read
each other (bug 7, ADR 0027).

- A reads B and B reads A: the resolve raises
  `CircularResource`, as before.
- Before, each failed instance held the other,
  so `close()` never resolved.
- Now a read of a resource still in its own
  build makes no hold. The close resolves.

## 0.31.4

A good build after a failed one ends as the
release or the close says (bug 6, ADR 0063).

- A resource whose sync build throws, then
  builds well on the next resolve, used to end
  that good build `failed` at its release or
  close.
- Now each build's ends run with that build's
  end: the failed build's with `failed`, the
  good build's with `released` or the close's
  status.
- Two failed builds each keep their own error.
- The sync and the async close share one path.
  An async close now runs sync ends in one job,
  in the same order.

## 0.31.3

A keyed resource read held past its scope's
close no longer builds (bug 2, ADR 0157).

- A held reader that reads or subscribes after
  the scope closed throws `Disposed` first.
- Before, it built once more, and that build's
  end never ran.
- A held resource read after the close already
  threw `Disposed`; a keyed one now does too.

## 0.31.2

A cell's `eq` that throws no longer stops
every watcher in the process (bug 5, ADR 0152).

- Before, an `eq` that threw while a write told
  its watchers left the round on. After that,
  no watcher in the process heard a write.
- Now that throw ends the round, as a watcher's
  throw does. The write throws the error.
  Later writes are heard again.
- A throw from the `eq` of a write you make
  inside a watcher still only fails that write.
  A watcher may catch it; its round goes on.
- A cell with no `eq` of its own runs the same
  write code as before.

## 0.31.1

A ws call failed as not sent is not sent later
(bug 4, ADR 0141).

- In `@tinkered/bun/client`, a link that closes
  before the next tick fails each waiting call
  as `link`, `sent: false`.
- Before, the call's frame stayed in the buffer.
  The tick then sent it on a new socket,
  and the server ran it.
- Now the close drops the frames not yet sent.
  So `sent: false` means the server never got it.
  A call sent again on `sent: false` runs once.

## 0.31.0

`tinker graph` prints facts, and `tinker check`
flags a plain in-app link (ADR 0161).

- `tinker graph [root]` prints one line per
  operation: its exits, and what its `run`
  reads, writes and calls, each by label.
  `--write` writes `tinker.graph`.
- `tinker check` has a new stage, `graph`. Each
  line that differs from `tinker.graph` is a
  `tinker/graph` finding.
- The graph is facts only, one line per op. A
  `?` in a set means the graph could not see.
- `tinker check` has a new rule, `tinker/link`.
  A plain `<a href>` to an app page is a
  finding. A server path takes
  `rel="external"`.
- `apps/site` commits its `tinker.graph`.

## 0.30.1

A page build refuses server code, and app code
has no barrel (ADR 0160).

- `pageGuard()` from `@tinkered/cli/vite`: a
  Vite plugin for the page build. It refuses an
  import of a `.server.` file, a `bun:` or
  `node:` name, `@tinkered/entry`, or
  `@tinkered/bun` other than `/client`. The
  error names the import and its file.
- `tinker check` has a new rule,
  `tinker/barrel`. A file in `src/` or `cmds/`
  exports only what it declares.
- The skills no longer teach a feature door.
- `apps/site` has no barrel.
- `vite-plus` is an optional peer of
  `@tinkered/cli`.

## 0.30.0

A span says its session and its exit (ADR 0162).
A devtools capsule needs only the hooks and a tap.

- With a tap on, each span opened in a session
  carries `attributes["session.id"]`: a number
  per root, the innermost session's. Root spans
  carry none. An exporter writes it as a string
  and adds a name for the root.
- `Scope.Handle.id` reads that id. A `session`
  hook reads `handle.id` at open and at close.
- An operation span that ends `ok` carries
  `attributes["tinker.exit"]`: the answer's
  `kind`, or `"refused"` for a refusal. A plain
  value carries none.
- No tap, no work. With a tap on, a run is 1.2%
  to 2.0% slower (Duke accepted it).
- The Core size cap rose by 64 B, to 23232 B.

## 0.29.3

A page cannot import `@tinkered/entry/cmd` or
`@tinkered/entry/server` by mistake.

- Both entries get a `browser` export condition.
  It points to an empty file.
- A page build that imports a value from them
  fails at that name.
- A page that loads one anyway stops with
  `BackendInPage`.
- `import type` still works.
- Bun and Node get the same code as before.

## 0.29.2

`@tinkered/entry` gets its code, moved from the
template's `tinker/` base. An app gets it by
version, not by copy. The names and behavior are
the template's, with one change in `routes`.

- `@tinkered/entry/cmd`: `defineMain`, `runMain`,
  `createMainHost`, `observeServerPanics`.
- A main that answers with no `closed` exits 1
  with `MainClosedMissing`.
- `runMain` and `createMainHost` take
  `defineMain(...)` as it is.
- `@tinkered/entry/server`: `routes`,
  `requestBody`, `backendStop`, `requestStop`,
  `http`, `httpRequest`, `httpBackend`, `health`,
  `baseVersion`, `abortReasons`, `Errors`,
  `isError`.
- `baseVersion` is the package's own version.
- The change: every reply after the first has
  its body cancelled. The `routes` capsule owns
  each cancel; the root's close waits for them.
- A cancel that fails is a warning in the root's
  log.

## 0.29.1

A new package, `@tinkered/entry`: the backend of
a Tinker app. This release sets it up. Its
entries are empty.

- `@tinkered/entry/cmd`: a command, a program
  with no port.
- `@tinkered/entry/server`: a server, a program
  that listens on a port.
- The code moves in from the template next. Then
  `@tinkered/bun` moves in as `@tinkered/entry/bun`.

## 0.29.0

`tinker check` can run the tests, and a test must
reach each exit of an operation (ADR 0159). An
app with no `tests` in `tinker.json` runs as
before.

- An exit is one way out of an operation: each
  `kind` of its answer, a refusal, or a plain
  return.
- `tinker.json` names the test command:
  `{ "tests": "bun run test" }`. The check then
  runs two more stages: tests, then exits.
- A declared exit that no test reached is a
  `tinker/exit` finding.
- New entry `@tinkered/cli/test`: the capsule
  `exits`. A server test scope lists
  `exits({ file: process.env.TINKER_EXITS })`.
- A page scope lists
  `exits({ store: localStorage })`. The exits go
  to the key `tinker.exits`, as counts. A setup
  file of the browser tests leaves them in
  `.tinker/exits/`.
- The gate reads `src` and `cmds`.

## 0.28.0

A keyed cell has one way to change a member
(ADR 0158). This release breaks code that says
`list.update(key, fn)`.

- A keyed controller has no `update`. Read the
  member, then `set` it:
  `list.set({ ...member, state })`.
- `set(member)` replaces the member with that key.
- The errors `MissingMember` and `KeyChanged` are
  gone.
- A plain cell keeps `update(fn)`.

## 0.27.2

No change to the packages. This release is the
first one that CI publishes `@tinkered/cli` to npm
with no token.

- `scripts/npm-setup.sh` works with npm 12. It
  runs outside the repo, and it sets trust only
  at a first publish.

## 0.27.1

Skill text only.

- The `core/rpc` skill has a new part, "Guard a
  call or a read": a start hook, `input.meta`,
  `input.refuse`, the tags it binds, and
  `board.part(input)` for the part of a read.

## 0.27.0

`derived` is now a `resource` with a `config`
(ADR 0157). This release breaks code that says
`derived`.

- `resource({ config, depends, factory })` is
  keyed by its config values. It builds again
  when a source changes.
- Move each `derived({ ... })` to it. The
  factory's second argument is `{ config }`:
  `(deps, c)` becomes `(deps, { config: c })`.
  A `derived` with no config takes `config: {}`.
- Each build is a span of kind `resource`.
- The factory also gets `defer`. An end runs
  before the next build, when the last reader
  leaves, and when the scope closes.
- An operation may name the read in `depends`.
- `WriteInDerived` is `WriteInRead`. Its payload
  names `resource`. A build that a source's
  change set off may now write a cell.
- The analyze rule `tinker/keyed-prop` is
  removed (ADR 0155 is withdrawn). A list reads
  once and passes each member to its item.
- `Data.Derived` is `Data.Built`. The namespace
  `Derived` is gone: see `Resource.Keyed` and
  `Resource.KeyedCtx`.

## 0.26.0

One command, and its check corrects the writer
(ADR 0156).

- `@tinkered/analyze` is now `@tinkered/cli`.
  Its bin is `tinker`.
- `tinker check` runs two stages: types (the
  app's `tsc`, the kind gate, the cast gate),
  then rules (Tinker's rules and the app's other
  lint). Only the first stage that fails prints.
- Each finding prints its fix: the `Right:` part
  of the skill section with its rule id.
- `tinker check: OK` and exit 0 is the only sign
  that the work is done. `--json` prints the same.
- `tinker skill list` and `tinker skill load`
  replace the two `intent` commands.
- `@tinkered/cli/config` exports `gates`.
  `@tinkered/cli/tsconfig.json` is the base
  config.
- New rule ids: `tinker/kind` and `tinker/cast`.
- An exception to a gate is a gap row: a
  `// tinker-gap: G<n>` marker now allows a gate
  finding and counts it. A `lint-disable`
  comment that turns a gate off is a finding.
  A marker never allows a `tsc` error.

To move an app:

- `bun add -d @tinkered/cli`, and remove
  `@tinkered/analyze`.
- Rename `tinker-analyze.json` to `tinker.json`.
- The lint plugin is `@tinkered/cli/lint`.
- Run `bun --bun tinker check`.

## 0.25.1

A list item reads its own member (ADR 0155).

- `@tinkered/analyze` has a new page rule,
  `tinker/keyed-prop`. A keyed part's list, or
  one member of it, passed as a JSX prop is a
  finding. Pass the key; the child reads
  `useData(part.of(key))`.
- The React skill states the rule.
- An app may see a new finding after the
  upgrade. Hedl has one.

## 0.25.0

Each backend owns its wire (ADR 0140 steps 2
and 3, ADR 0154). No change for an app that uses
`ws` or `memory`.

- Core keeps the meaning, in values: the faults,
  the route table, `meta`, one `renew`.
- The codec and the text envelope moved into
  each backend: `ws` and `memory`.
- `memory` still sends each value through the
  codec, so a test sees what the wire does.
- `watch` is required. A `remote` with no
  `watch` fails the start (`remote.watch`).
- The execution id is the call's own field,
  `execution`, not `meta.execution`. A hook's
  `meta` no longer has it.
- On the socket it still rides as `m.execution`.
  An open page and a new server agree.
- For a backend author: `transport` lost
  `sendInput`, `openInput`, `TextServe`,
  `TextStream`. A client's `send` and `open` take
  the call as a value and give a `Reply`.
- Core with rpc: 35,071 to 34,696 B gzip.

## 0.24.0

A client board can ask again on a clock, per keyed
cell (ADR 0139 decision 3). TanStack's name.

```ts
board({
  read: ws.client,
  refetchInterval: { tasks: 30_000 },
});
```

- Each part in use asks again whole, every 30 s.
- A cell left out never asks by time. That is the
  default, as in TanStack.
- The clock stops when the part's last reader
  leaves.
- A part that rides a wider part asks nothing on
  its own clock.
- A part that waits on a fault (`refused`,
  `invalid`) wakes on it.

## 0.23.1

A cell write is a little faster. No API change.

- A watcher that throws is caught at the watcher
  loop, not around each write.
- The `WriteInDerived` check stays in the write;
  its error is built outside it.
- One cell, one watcher, 4M writes: 81 to 80 ns
  per write. 0.21.1 took 75 ns.
- The rest is the catch that keeps a throwing
  watcher safe. Vue and Preact pay it too.

## 0.23.0

A keyed read can name a window: an order and a
limit (ADR 0139 decision 2). The store sorts and
cuts. Core does not.

```ts
useData(board.tasks.where(
  { project },
  { order: "-created", limit: 50 },
));
```

- The board's `load` gets the part and the window
  as one input. A window it does not take is
  refused.
- A window keeps the store's order. Its members go
  in the one cell, so `of(key)` sees them.
- A signal in the part asks the whole window
  again. `invalidate` of the part asks each window.
- A window does not ride a whole part, and a whole
  part does not ride a window.
- A new window starts `pending`, with no rows.
- A board with no `load` fails a window (`failed`):
  nothing sorts.

### Size

- Core cap 23,040 B (+192), with rpc 35,072 B
  (+256).

## 0.22.0

A unit that depends on a slot tag now gets what
it would get from the unit in that slot
(ADR 0151). Before, it got the handle.

- A resource in a slot arrives built. An async one
  waits before the body runs.
- A cell in a slot arrives as its value.
- An operation in a slot arrives as a subflow.
- `.all` and `.optional` give each unit the same
  way, in the order the tag holds them.
- `tag.controller` gives the controller of the cell
  or operation in the slot.
- A resource that reads a slot rebuilds when the
  resource in the slot is released.
- `scope.resolve(tag)` and a start hook's config
  still read the handle as bound.
- A list or record inside one tag value stays as
  bound.

```ts
const store = tag<Resource.Handle<Db>>({
  label: "store",
});
const rows = operation({
  label: "rows",
  depends: { store },
  run: ({ store }) => store.all(),
});
```

### Speed

- An operation that reads a slot: 3.5 to 6% faster.
- An inline `scope.run({ depends, run })`: 3.8%
  slower. It checks its depends on each call.

### Upgrade

- Code that read a slot in `depends` and then
  resolved the handle by hand now gets the value.
  Drop the extra step.
- A slot that held a cell only to pass a resource
  can hold the resource now.

## 0.21.3

Two services with one address now fail the start
(ADR 0153). Before, the first one won.

- Two boards with a cell of the same name served
  one address. The second board's client got the
  first board's rows, with no fault.
- The server transport now raises
  `DuplicateAddress` at start, in `ws.server` and
  in the memory transport.
- The fault names both units. A board gives its
  cell's label:

```
DuplicateAddress
  address: "flows"
  services: ["approvals.flows", "admin.flows"]
```

### Upgrade

- A server with a clash does not start. Rename one
  cell, or one rpc key.
- To keep the old rule (the first wins, with a
  warning at start), set `strict: false`:

```ts
ws.server({ path: "/rpc", services, strict: false });
```

- A test that relied on the first winning needs
  `strict: false` too.

### Install

From npm:

```bash
bun add @tinkered/core@0.21.3 \
  @tinkered/react@0.21.3 \
  @tinkered/bun@0.21.3
bun add -d @tinkered/analyze@0.21.3
```

## 0.21.2

A write made while watchers hear another write
now waits its turn (ADR 0152). Each watcher hears
writes in the order they were made.

- A chain of writes deeper than 100 raises
  `UpdateDepth`. It names the last cells written.
  Before, a derived that wrote its own source
  looped about 2,900 times and kept a wrong value.
- A cell write inside a derived's factory raises
  `WriteInDerived`.
- A watcher that throws ends only its own round.
  The first error goes to the first write.
- A derived slot may hold an operation (ADR 0150,
  point 9). The factory gets a caller.
- A plain write allocates nothing new: on the bench
  `write` and the standard ten show no difference
  from 0.21.1.

### Install

From npm:

```bash
bun add @tinkered/core@0.21.2 \
  @tinkered/react@0.21.2 \
  @tinkered/bun@0.21.2
bun add -d @tinkered/analyze@0.21.2
```

## 0.21.1

`tinker/plain` reads a derived's `depends` and
`factory` as unit bodies, as it reads an
operation's `run`. 0.21.0 called them plain
functions. Core, React and Bun have no code
change.

### Install

From npm:

```bash
bun add @tinkered/core@0.21.1 \
  @tinkered/react@0.21.1 \
  @tinkered/bun@0.21.1
bun add -d @tinkered/analyze@0.21.1
```

## 0.21.0

Core has `derived`: a computed read, keyed by
its config (ADR 0150). It replaces a `useMemo`
that keeps a slice stable. React reads it with
`useData`. Bun and analyze have no code change.

### Install

From npm:

```bash
bun add @tinkered/core@0.21.0 \
  @tinkered/react@0.21.0 \
  @tinkered/bun@0.21.0
bun add -d @tinkered/analyze@0.21.0
```

### Derived

```ts
const viewer = tag<string>({ label: "pr.viewer" });

export const prView = derived({
  label: "pr.view",
  config: { viewer: viewer.required },
  depends: (c) => ({
    rows: prs.where({ viewer: c.viewer }),
  }),
  factory: ({ rows }) => rows.get().length,
});

const view = useData(prView({ viewer }));
```

- The config is the key: strings, finite
  numbers, and slots (a cell, a read, a capsule
  export, a resource). No operation.
- Every reader of one config shares one entry.
  The last watcher leaves, and the entry goes.
- It computes again only when a source changed.
- A pending resource suspends React. A failed
  one is the entry's fault.
- With no required key, the bare unit reads:
  `useData(total)`.

### Size

Core grows by about 1 KiB gzip. The core cap
rises by 1 KiB, to 22,528 B.

### What to change in an app

- Nothing is required.
- A `useMemo` that keeps a slice stable can move
  to a `derived`.

## 0.20.1

A Workflow SDK flow file passes `tinker/plain`
(ADR 0148, issue #35). Core, React and Bun have
no code change.

### Install

From npm:

```bash
bun add @tinkered/core@0.20.1 \
  @tinkered/react@0.20.1 \
  @tinkered/bun@0.20.1
bun add -d @tinkered/analyze@0.20.1
```

### Flow files

A flow file ends in `.flow.ts` or
`.flow.server.ts`. In it, a function whose body
starts with `"use workflow"` or `"use step"`
passes:

```ts
export async function nameFlow() {
  "use workflow";
  return await suggest();
}

async function suggest() {
  "use step";
  return callOperation("naming.suggest");
}
```

- A workflow may call its steps by name.
- Other code that calls a step by name gets a
  finding at the step.
- `start(nameFlow, [...])` is no call by name.
- A helper in a flow file still fails.

### What to change in an app

- Remove each `plain.entries` row you wrote for
  a workflow or a step, and name the file
  `*.flow.server.ts`.

## 0.20.0

`tinker/plain` looks at who calls a function
(ADR 0149). Core, React and Bun have no code
change.

### Install

From npm:

```bash
bun add @tinkered/core@0.20.0 \
  @tinkered/react@0.20.0 \
  @tinkered/bun@0.20.0
bun add -d @tinkered/analyze@0.20.0
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.20.0
bun add $R/tinker-core-0.20.0.tgz \
  $R/tinker-react-0.20.0.tgz \
  $R/tinker-bun-0.20.0.tgz
bun add -d $R/tinker-analyze-0.20.0.tgz
```

### A call by name takes the pass away

A function passes `tinker/plain` when something
else calls it: Core, a library, React. Now the
check also reads the calls. A passing function
that your code calls by name is a finding:

```text
src/page.tsx:3 tinker/plain a helper, called
by name at src/page.tsx:7
```

Your code may call by name:

- an operation, through the scope;
- a closure: a function that reads a name of a
  function around it;
- an entry in `tinker-analyze.json`.

### What to change in an app

- **New findings.** Make each helper an
  operation, or write it inline.
- **`cn` is not built in.** List it:

  ```json
  "src/ui/classes.ts": {
    "cn": "shadcn's registry imports it."
  }
  ```

- **The listener pass is gone.** A named
  function handed to `addEventListener` is a
  finding. Write the listener inline.

## 0.19.0

Each rpc call has an execution id (ADR 0147).
React, Bun and Analyze have no code change.

### Install

From npm:

```bash
bun add @tinkered/core@0.19.0 \
  @tinkered/react@0.19.0 \
  @tinkered/bun@0.19.0
bun add -d @tinkered/analyze@0.19.0
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.19.0
bun add $R/tinker-core-0.19.0.tgz \
  $R/tinker-react-0.19.0.tgz \
  $R/tinker-bun-0.19.0.tgz
bun add -d $R/tinker-analyze-0.19.0.tgz
```

### The execution id (ADR 0147)

- The client makes one id per call. It goes as
  `meta.execution`.
- The server binds it as the `execution` tag.
- A fault has it: `error.execution`.
- The server's `rpc call failed` log line has
  the same id, with tracing off too.
- A call ends at its reply, as a TanStack Query
  mutation does.

To see your own write at once:

```ts
await run(api.move, { input });
await run(board.invalidate, {
  input: { tasks: { project } },
});
```

Read the id on the server:

```ts
const audit = operation({
  depends: { id: execution.optional },
  run: ({ id }) => id.present && id.value,
});
```

## 0.18.2

`@tinkered/analyze` reads gap markers. Core,
React and Bun have no code change.

### Install

From npm:

```bash
bun add @tinkered/core@0.18.2 \
  @tinkered/react@0.18.2 \
  @tinkered/bun@0.18.2
bun add -d @tinkered/analyze@0.18.2
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.18.2
bun add $R/tinker-core-0.18.2.tgz \
  $R/tinker-react-0.18.2.tgz \
  $R/tinker-bun-0.18.2.tgz
bun add -d $R/tinker-analyze-0.18.2.tgz
```

### Gap markers (ADR 0145)

A gap is a finding that waits on a Tinker
change. Name the gaps doc in
`tinker-analyze.json`:

```json
{ "gaps": "docs/tinker-core-feedback.md" }
```

Mark the line, and give it a row:

```ts
// tinker-gap: G3
const answer = await fetch("/api/auth");
```

- The finding is allowed while row `G3` is open.
- A row allows at most its `Lines` count.
- A stale marker, a closed or missing row, or a
  row over its count breaks `tinker/gap`.
- Each run prints `gaps: G1 3/3, G3 5/5`.

## 0.18.1

A faster fan-out in React. No API changed.

### Install

From npm:

```bash
bun add @tinkered/core@0.18.1 \
  @tinkered/react@0.18.1 \
  @tinkered/bun@0.18.1
bun add -d @tinkered/analyze@0.18.1
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.18.1
bun add $R/tinker-core-0.18.1.tgz \
  $R/tinker-react-0.18.1.tgz \
  $R/tinker-bun-0.18.1.tgz
bun add -d $R/tinker-analyze-0.18.1.tgz
```

### `useData` holds its scope (ADR 0144)

- A `useData` call reads the scope from context
  in its first render only.
- React then keeps no changing context item on
  that component. A sibling that does not render
  costs less.
- Site bench, one write to 50 components, in
  Chromium: 47.2 µs to 40.3 µs.

### One behaviour changes

```tsx
<ScopeProvider scope={scope}>
  <Page />
</ScopeProvider>
```

- When `scope` becomes another scope, `Page`
  mounts again.
- Before, `Page` stayed and read the new scope.
- Typed text, focus, and scroll below the
  provider start fresh.
- `create` mode and `SessionProvider` did this
  already.

### The same as before

- A render after the scope closed raises
  `Disposed`.
- `useData` with no provider raises `NoProvider`.
- Core, Bun and analyze have no code change.

## 0.18.0

The packages are now `@tinkered/*`, and each
release goes to npm too (ADR 0146).

### Upgrade

- Rename every import: `@tinker/core` is now
  `@tinkered/core`. The same for react, bun and
  analyze.
- In `package.json`, rename the keys. Then pick
  npm or the GitHub URLs below.

### Install from npm

Once npm has the packages:

```bash
bun add @tinkered/core @tinkered/react \
  @tinkered/bun
bun add -d @tinkered/analyze
```

### Install from GitHub

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.18.0
bun add $R/tinker-core-0.18.0.tgz \
  $R/tinker-react-0.18.0.tgz \
  $R/tinker-bun-0.18.0.tgz
bun add -d $R/tinker-analyze-0.18.0.tgz
```

## 0.17.10

A new package, `@tinker/analyze`: the rule checks
in one command.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.10
bun add $R/tinker-core-0.17.10.tgz \
  $R/tinker-react-0.17.10.tgz \
  $R/tinker-bun-0.17.10.tgz
bun add -d $R/tinker-analyze-0.17.10.tgz
```

The four URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-core-0.17.10.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-react-0.17.10.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-bun-0.17.10.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-analyze-0.17.10.tgz

### `@tinker/analyze` (ADR 0145)

- `tinker-analyze check` reads an app's files and
  prints each broken rule: file, line, rule id.
- After the findings, each broken rule names its
  next step and the skill to read.

```text
src/a.ts:1 tinker/plain a plain function

tinker/plain: make it an operation
  read: @tinker/core#core/operation
```

- Rules: `tinker/plain`, `tinker/one-wire`,
  `tinker/react-state`.
- The app's exceptions go in
  `tinker-analyze.json`, each with a reason.
- `@tinker/analyze/lint` is the Oxlint plugin:
  `tinker/cell-write`, `tinker/blank-lines`,
  `tinker/body-steps`.
- Core, React and Bun have no code change.

## 0.17.9

Core and React ship agent skills. A run hook
can ask which op it wraps.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.9
bun add $R/tinker-core-0.17.9.tgz \
  $R/tinker-react-0.17.9.tgz \
  $R/tinker-bun-0.17.9.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.9/tinker-core-0.17.9.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.9/tinker-react-0.17.9.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.9/tinker-bun-0.17.9.tgz

### Skills for agents (ADR 0143)

- `@tinker/core` holds six skills in
  `skills/core/`: the entry, operation, data,
  capsule, rpc and testing.
- `@tinker/react` holds one in `skills/react/`.
- The format is Agent Skills. An app reads them
  with TanStack Intent:

```bash
bun add -d @tanstack/intent
bunx intent install
bunx intent list
bunx intent load @tinker/core#core/operation
```

- Each code example in a skill is compiled
  against this release.
- Each rule has an id, such as `tinker/plain`.
  A mistake in a skill carries the id of its
  rule.

### A run hook asks which op it wraps (ADR 0142)

- `event.is(op)` is a type guard. A true answer
  gives `op`, `call`, `input` and `next()` that
  op's types.
- `event.input` is the input the body gets. A
  raw call is parsed at the read.

```ts
hooks: {
  run(event) {
    if (!event.is(press)) return event.next();
    const { room } = event.input;
    return event.next();
  },
},
```

### Upgrade

- Change the three URLs.
- No code changes.

## 0.17.8

A shorter request path. No API changed.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.8
bun add $R/tinker-core-0.17.8.tgz \
  $R/tinker-react-0.17.8.tgz \
  $R/tinker-bun-0.17.8.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.8/tinker-core-0.17.8.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.8/tinker-react-0.17.8.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.8/tinker-bun-0.17.8.tgz

### The WebSocket client

- The frame of a tick goes in the next task,
  with no timer. Before, it waited at least
  1 ms on Bun and Node, and 4 ms in a browser
  when timers nest.
- One call at a time, Bun to Bun:
  1,362 µs to 108 µs.
- A call or a watch takes its `abort` listener
  off the scope's signal when it ends.
  Before, each call left one there.

### The server side

- A run that is not the transport's own makes
  no logger: a run hook reads `op` first.
- The protocol reads `log` only when it logs
  a fault.

### Core and React

- Trace ids come from a table. A traced request
  on Node: 22,489 to 17,975 instructions.
- React holds the scope and the namespace in
  one context. One update: 147.1k to 142.3k
  instructions.

### Upgrade

- Change the three URLs.
- No code changes.

## 0.17.7

Two client sets reach one memory server again.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.7
bun add $R/tinker-core-0.17.7.tgz \
  $R/tinker-react-0.17.7.tgz \
  $R/tinker-bun-0.17.7.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.7/tinker-core-0.17.7.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.7/tinker-react-0.17.7.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.7/tinker-bun-0.17.7.tgz

### Memory

- A memory client reaches the memory server in
  its peer, whichever `createMemory()` made it,
  as two sockets reach one URL.
- 0.17.6 needed a server for each pair: a second
  client set (a signed one) on the default server
  gave `failed`, "memory: no server here".
- A peer with no memory server is `link` with
  `sent: false`.

### Upgrade

- Change the three URLs.
- A second `pair.server(...)` added only for
  0.17.6 can go.

## 0.17.6

Clear exits at the transport SPI (ADR 0141): a
backend ends with a value, and a throw is a bug.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.6
bun add $R/tinker-core-0.17.6.tgz \
  $R/tinker-react-0.17.6.tgz \
  $R/tinker-bun-0.17.6.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.6/tinker-core-0.17.6.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.6/tinker-react-0.17.6.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.6/tinker-bun-0.17.6.tgz

### rpc and remoteData

- A backend's `send` resolves with
  `{ ok: true, text }`, `missing`, or `link` with
  `sent`. Its `open` resolves with `{ ok: true }`
  or the same exits. Neither throws.
- A throw in a backend is a bug. Core logs the
  cause with the address and gives `failed` with
  `from: "local"`. It is never `link`, so a keyed
  part waits for `invalidate`.

### Memory

- Each `createMemory()` has its own server ops. A
  second pair in one scope now reaches its own
  server. It gave `CapsuleMissing`, shown as
  `link`.
- A memory server that closes ends its open
  watches as `link`, and its close settles. It
  hung until the client closed.
- A closed peer is `link` with `sent: false`.

### Upgrade

- Change the three URLs.
- A transport of your own: `send` and `open`
  return a value, not a throw (`transport.Exit`).
- A test that read a broken setup as `link` now
  reads `failed`, from local, with the cause in
  the log.

## 0.17.5

A fault says who spoke: the server, or this side
(ADR 0141).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.5
bun add $R/tinker-core-0.17.5.tgz \
  $R/tinker-react-0.17.5.tgz \
  $R/tinker-bun-0.17.5.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.5/tinker-core-0.17.5.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.5/tinker-react-0.17.5.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.5/tinker-bun-0.17.5.tgz

### rpc and remoteData

- Each fault has `from`: `"server"` or `"local"`.
- A local fault has `sent`. It is `false` when
  nothing left, so the server ran nothing.
- An address no one serves is the new server
  fault `missing`, as HTTP 404. It was `link`.
- A keyed part on a `missing` address waits for
  `invalidate`, as for `refused`. It no longer
  asks again with back-off.

### @tinker/bun

- A 404, on the socket or on a bytes POST, is
  `missing`.
- A socket drop says `sent` per call: a message
  that never left on the socket is
  `sent: false`.

### Upgrade

- Change the three URLs.
- Code that read an unknown address as `link`
  reads `missing`.
- A server on 0.17.5 sends `missing` for an
  unknown address. Move the client and the server
  together.

## 0.17.4

A keyed part has its own state, and a fault that
is the server's answer ends the asking (ADR 0139,
decisions 1, 4 and 5).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.4
bun add $R/tinker-core-0.17.4.tgz \
  $R/tinker-react-0.17.4.tgz \
  $R/tinker-bun-0.17.4.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.4/tinker-core-0.17.4.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.4/tinker-react-0.17.4.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.4/tinker-bun-0.17.4.tgz

### remoteData

- `board.status(read)` gives a part's state:
  `pending` until its first answer, then `ready`
  or `fault`. It is `undefined` when no reader
  holds the part.
- The page tells "not read yet" from "nothing
  there": a part with no member is `ready`.
- A part that rides a ready part is `ready` at
  once.
- A `refused` or `invalid` part waits for a
  trigger. There is no ask again until an
  `invalidate` names it. Only a broken link asks
  again by itself.
- `board.part(call)` gives a guard the part of a
  keyed join or ask, typed. Any other call gives
  `undefined`.

### Upgrade

- Change the three URLs.
- Read a part's fault from `board.status(read)`.
  `board.faults` is still per key: a later good
  answer of another part clears it.
- A page's "Try again" calls `invalidate` with the
  part. A refused part no longer asks again every
  few seconds.
- `part`, `status` and `states` are now reserved:
  a board cell must not use these names.
- A guard that parsed the part by hand can use
  `board.part(call)`.

## 0.17.3

A keyed signal carries its trace, as a push does.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.3
bun add $R/tinker-core-0.17.3.tgz \
  $R/tinker-react-0.17.3.tgz \
  $R/tinker-bun-0.17.3.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.3/tinker-core-0.17.3.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.3/tinker-react-0.17.3.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.3/tinker-bun-0.17.3.tgz

### remoteData

- A keyed pass runs `remoteData.send`, a producer
  span. Each signal of the pass carries it as
  `meta.traceparent`.
- The reader's ask runs under `remoteData.receive`,
  a process span that links the send (OTel
  messaging).
- A pass from `invalidate` sends under that call:
  the send is in the writer's trace.
- A pass from a set on the cell sends in the
  request's trace, with no parent span: a write
  hook does not see its writer's span. The
  single-cell push is the same.

### Upgrade

- Change the three URLs.

## 0.17.2

A keyed board's `load` runs in a session of its
own, closed when it returns. Before, it ran on the
root: a session resource it used stayed open.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.2
bun add $R/tinker-core-0.17.2.tgz \
  $R/tinker-react-0.17.2.tgz \
  $R/tinker-bun-0.17.2.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.2/tinker-core-0.17.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.2/tinker-react-0.17.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.2/tinker-bun-0.17.2.tgz

### remoteData

- A load gets the ask's signal. Its session closes
  when it returns, as a `fill`'s tagged call does.
- A transaction that begins on first use now ends
  with the load. Found by Hedl's Checks board.
- A tab that drops the ask stops the load.

### Upgrade

- Change the three URLs.

## 0.17.1

A keyed part that a part in use holds whole opens
no stream of its own: it rides that part's stream.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.1
bun add $R/tinker-core-0.17.1.tgz \
  $R/tinker-react-0.17.1.tgz \
  $R/tinker-bun-0.17.1.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.1/tinker-core-0.17.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.1/tinker-react-0.17.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.1/tinker-bun-0.17.1.tgz

### remoteData

- A list that reads `where({})` and rows that read
  `of({ id })` share one stream. A set sends one
  signal and one ask.
- When the covering part leaves, a rider rides
  another cover, or opens its own stream.

### Upgrade

- Change the three URLs.

## 0.17.0

Keyed data: `data` has a mode, and a keyed cell
holds members under keys (ADR 0135 to 0138).
`remoteData` serves a keyed cell part by part.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.0
bun add $R/tinker-core-0.17.0.tgz \
  $R/tinker-react-0.17.0.tgz \
  $R/tinker-bun-0.17.0.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.0/tinker-core-0.17.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.0/tinker-react-0.17.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.0/tinker-bun-0.17.0.tgz

### Core

- `data({ mode: "keyed", key, parse })` makes a
  keyed cell. `key` reads the key from a member.
- Its controller: `set(member)`, `update(key, fn)`,
  `delete(key)`, and the reads `of(key)` and
  `where(part)`.
- `cell.of(key)` and `cell.where(part)` name a read.
  `scope.resolve(read)` gives its reader.
- A write wakes the readers of its member and of its
  parts, and no other.
- New errors: `MissingMember`, `KeyChanged`,
  `InvalidKey`.

### remoteData

- A keyed cell on a board is served by part. The
  first reader of a part asks for it. The last
  reader leaves it.
- The guard (`onStart`) runs at each ask.
- `board.invalidate` marks parts dirty, on the
  server and on the client.
- `board({ serve: true, load })` reads parts from a
  store. The server then keeps no member.
- A keyed cell takes no `config`. `invalidate` is a
  reserved key.
- Guide: `docs/keyed-projector.md`.

### React

- `useData(cell.where(part))` and
  `useData(cell.of(key))` read one part or member.

### Upgrade

- Change the three URLs.
- Nothing else: every old call keeps its type.
- A board cell named `invalidate` must take
  another name.

## 0.16.2

A stop during start ends the start, so `serve`
never listens after a stop (ADR 0134).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.16.2
bun add $R/tinker-core-0.16.2.tgz \
  $R/tinker-react-0.16.2.tgz \
  $R/tinker-bun-0.16.2.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.16.2/tinker-core-0.16.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.2/tinker-react-0.16.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.2/tinker-bun-0.16.2.tgz

### Core

- After a stop, a start hook's `next()` rejects.
  A stop is a close, a stop signal, or a start
  timeout. So no hook does its after-work.
- Before, a `close()` during start ran the close
  hooks first. Then `serve` still listened, and
  nothing closed the port.
- A stop signal during start ends the start once
  the running hooks return. `ready` rejects with
  the signal's reason; `closed` is `cancelled`.
- A signal that aborted before start: no start
  hook runs.

### Upgrade

- Change the three URLs.
- Remove a gate capsule that checks the stop
  signal after `serve`'s `next()`.
- A test that waits for `ready` after a stop
  during start: `ready` now rejects with the
  stop's reason.

## 0.16.1

A stopped stream no longer leaks, and no longer
fails its root's close (ADR 0133). No API change.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.16.1
bun add $R/tinker-core-0.16.1.tgz \
  $R/tinker-react-0.16.1.tgz \
  $R/tinker-bun-0.16.1.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.16.1/tinker-core-0.16.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.1/tinker-react-0.16.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.1/tinker-bun-0.16.1.tgz

### Core

- A call given a `signal` that rejects with that
  signal's reason is cancelled for its caller.
  Before, the caller's root kept the reason as a
  panic: its `close()` said `failed`.
- This hit every rpc stream a reader left, and
  every session that opened a keyed `remoteData`
  project. Each kept about 4,000 B on the tab.
- rpc and keyed `remoteData` no longer call
  `AbortSignal.any` over a long-lived signal.
  Node 22 kept about 180 B per call.
- `bench/heap-stop.mjs` holds the budget:
  64 B kept per stop; now 5 to 7 B.

### Upgrade

- Change the three URLs. No code change.
- A `try/catch` around a subflow you stop by its
  own `signal` now leaves the session clean.

## 0.16.0

`serve` is a capsule; `run` is the host
(ADR 0132). `testCapsule` is gone (ADR 0131).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.16.0
bun add $R/tinker-core-0.16.0.tgz \
  $R/tinker-react-0.16.0.tgz \
  $R/tinker-bun-0.16.0.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.16.0/tinker-core-0.16.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.0/tinker-react-0.16.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.0/tinker-bun-0.16.0.tgz

### Breaking

- `@tinker/bun`: `serve(main, pages)` is gone.
  - Put `serve({ port, pages, websocket,
handlers })` first in `capsules`.
  - Call `run(main)` in the host file.
  - `main` answers its root: `createScope(...)`.
  - A handler's start returns `{ fetch,
websocket? }`; `ws.server` does.
- `@tinker/core/testing`: `testCapsule` is gone.
  Test tooling is a plain capsule in a
  `*.testing.ts` file.

## 0.15.0

rpc and remoteData are Core primitives
(ADR 0130). Units take tags (ADR 0129).
A new package: `@tinker/bun`.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.15.0
bun add $R/tinker-core-0.15.0.tgz \
  $R/tinker-react-0.15.0.tgz \
  $R/tinker-bun-0.15.0.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.15.0/tinker-core-0.15.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.15.0/tinker-react-0.15.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.15.0/tinker-bun-0.15.0.tgz

### rpc in Core

- `rpc`, `channel`, `bytes`, `remoteData`
  and `transport` are in `@tinker/core`.
- `memory` is in `@tinker/core/testing`.
- An app without rpc bundles no rpc code.
- A watch its link drops fails as `link`,
  as a call does (it threw a plain error).
- Contracts take any Standard Schema.

### Moving an app

- `~/components/rpc`, `remote-data`:
  import from `@tinker/core`.
- `~/components/protocol`: read it from
  `transport`.
- `~/components/memory`: import from
  `@tinker/core/testing`.
- `~/components/ws`: the server from
  `@tinker/bun`, the client from
  `@tinker/bun/client`.
- `~/base/bun-host`: `serve` from
  `@tinker/bun`.
- `~/components/bun-sql`, `bun-sqlite`:
  `@tinker/bun/sql`, `@tinker/bun/sqlite`.
- A bytes field marks your own field:
  `bytes(z.custom<RpcBody>(), { max })`.
- A bad rpc output raises `SchemaRejected`,
  not a `ZodError`.

### Unit tags

- `operation`, `resource` and `data` take
  `tags: [...]`.
- The handle keeps them. The non-secret
  ones go on the unit's span.
- An inline op has `tags` undefined. So a
  handle no longer passes as an inline op:
  a wrong input now shows as a type error.

## 0.14.1

Faster handles. No API change.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.1
bun add $R/tinker-core-0.14.1.tgz \
  $R/tinker-react-0.14.1.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.1
npm install $R/tinker-core-0.14.1.tgz \
  $R/tinker-react-0.14.1.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.14.1/tinker-core-0.14.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.14.1/tinker-react-0.14.1.tgz

### Core

- Handles are classes, not `Object.create`
  over a handle just made. V8 can now share
  one shape between them.
- A session under a root with `session` hooks
  takes 56% fewer instructions than in 0.12.
- A session made on the starting handle:
  51% fewer than in 0.12.
- Root start: 32% fewer than in 0.12.
- A sync `run` does not change.
- Notes: `research/learnings/2026-11-09-handle-shapes.md`.

### Upgrade

- Change the two URLs. No code change.
- Do not take a verb off a handle
  (`const { run } = scope`). ADR 0108 forbids it,
  and it no longer works on the starting handle.

## 0.14.0

A root with capsules has a starting type
(ADR 0128). Breaking.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.0
bun add $R/tinker-core-0.14.0.tgz \
  $R/tinker-react-0.14.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.0
npm install $R/tinker-core-0.14.0.tgz \
  $R/tinker-react-0.14.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.14.0/tinker-core-0.14.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.14.0/tinker-react-0.14.0.tgz

### Starting handle

- `createScope({ capsules })` returns a
  `Scope.Starting`. Its `run`, `settle`,
  `session` and `controller(op).run` always
  return a promise.
- `await scope.ready` gives the started
  `Scope.Handle`. Its sync calls stay sync.
- `createSession()` on it gives a starting
  session; its `ready` gives the started
  session.
- `isStarting(scope)` tells the two apart.
- A root with no `capsules` does not change.
- `capsules` that may be unset (a variable)
  types as either. Narrow it with
  `isStarting`.

### React

- `ScopeProvider` takes a starting root. It
  waits for `ready`: a `<Suspense>` above shows
  its fallback; a failed start reaches the
  error boundary.
- In `create` form it renders nothing until
  start ends, and does not suspend.

### Upgrade

- Await each call on a capsule root, or take
  `const live = await scope.ready` first.
- Pass the started handle to code that wants
  a `Scope.Handle`, and to `renderToString`.
- Make `no-floating-promises` an error: it
  finds each call that is not awaited.

## 0.13.0

A call waits for start, and a capsule's author
ships test tooling as a test capsule
(ADR 0127).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.13.0
bun add $R/tinker-core-0.13.0.tgz \
  $R/tinker-react-0.13.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.13.0
npm install $R/tinker-core-0.13.0.tgz \
  $R/tinker-react-0.13.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.13.0/tinker-core-0.13.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.13.0/tinker-react-0.13.0.tgz

### A call waits for start

- While a root starts, `run`, `settle`,
  `session` and `controller(op).run` wait for
  every start, then run.
- So do sessions made during start.
- After a failed start or a close, a waiting
  call meets the closed scope: `run` raises
  `Disposed`; `settle` returns its result.
- `await using scope = createScope(...)`
  closes the scope at the end of the block.

### Test capsule

- `testCapsule(of, def)` from
  `@tinker/core/testing`: a capsule only tests
  install, labelled `<of>.testing`.
- Its ops reach `of` through `of`'s exports.
- A prod file does not import it, so the
  bundler leaves it out.

### Upgrade

- A run before `ready` no longer raises
  `NotResolved`; it waits. A test that checked
  that error now gets the value.
- A sync op's `run` returns a promise while
  the root starts. `await` it there.
- `await scope.ready` before a call still
  works; it is no longer needed.

## 0.12.0

A capsule exports a foreign value as is
(ADR 0125). An edge picks the layer a write
lands on (ADR 0126).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.12.0
bun add $R/tinker-core-0.12.0.tgz \
  $R/tinker-react-0.12.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.12.0
npm install $R/tinker-core-0.12.0.tgz \
  $R/tinker-react-0.12.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.12.0/tinker-core-0.12.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.12.0/tinker-react-0.12.0.tgz

### Foreign exports

- A value in `exports` that is not a unit,
  such as a React component, is exported as
  is: `talk.Panel`.
- The capsule is then a module to use
  anywhere.

### Placed edges

- `cell.atScope.controller`: a write lands at
  the root, outside any namespace.
- `cell.atNamespace.controller`: a write lands
  at the root, in the caller's namespace.
- `cell.controller` does not change: the
  caller's own layer.
- They work from a session, a tagged call and
  a call with a `signal`.
- A read view (a capsule's cell export) has
  neither.
- `tinker/cell-write` also flags both on
  another capsule's raw cell.

### Upgrade

- Nothing breaks. The 0.11.0 way to write the
  root, a `scope`-target resource that takes
  the controller, still works.

## 0.11.0

A capsule's cell export is read-only
(ADR 0123).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.11.0
bun add $R/tinker-core-0.11.0.tgz \
  $R/tinker-react-0.11.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.11.0
npm install $R/tinker-core-0.11.0.tgz \
  $R/tinker-react-0.11.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.11.0/tinker-core-0.11.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.11.0/tinker-react-0.11.0.tgz

### Read views

- A cell in `exports` is now a read view on the
  handle: `talk.point`.
- It has no `controller` and no path to the
  cell.
- `depends: { p: talk.point }` hands a reader:
  `get()` and `watch()`.
- `scope.resolve(talk.point)` and a hook's
  `load(talk.point, meta)` answer the reader.
- `useData(talk.point)` reads it in React.
- To change the cell from outside, call an op
  the capsule exports.
- The raw cell, imported from its own file,
  keeps full power.

### Upgrade

- `talk.point.controller` is now a type error.
  Use the raw cell inside the capsule, or an
  op the capsule exports.
- `mail.outbox === outbox` is false for a cell
  export. Ops and resources keep the same
  object.
- New lint `tinker/cell-write` (warn): a
  `.controller` on another capsule's cell.

## 0.10.1

The first release under tag `v0.10.1`.
It has Core and React only.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.10.1
bun add $R/tinker-core-0.10.1.tgz \
  $R/tinker-react-0.10.1.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.10.1
npm install $R/tinker-core-0.10.1.tgz \
  $R/tinker-react-0.10.1.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.10.1/tinker-core-0.10.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.10.1/tinker-react-0.10.1.tgz

The React tarball names Core by its URL.

### Bun is the main runtime

- Core and React declare
  `"engines": { "bun": ">=1.4" }`, next
  to Node `>=22.18.0`.
- CI has a `bun` job on Bun 1.4. It runs the
  Core and React tests on Bun. Then it loads
  the built Core and React on Bun: a scope
  starts, reads a cell, and closes.
- Node 22 is still tested, in the `gates`
  job.

### Start is sunset

Start is gone from this repo (ADR 0122).

- Removed: `packages/start`,
  `apps/start-min`, `apps/start-scaffold`,
  and the `tinker` CLI.
- The removed code stays in tag
  `start-archive`.
- Old `start-v*` releases stay up. Their
  tarball URLs still download.
- Asset names are the same. Only the tag
  name changed: `start-vX.Y.Z` is now
  `vX.Y.Z`.
- To move up from 0.10.0: replace the two
  `start-v0.10.0` URLs with the two above.

### A hook opens a session

Core, ADR 0121 section 14.

Every hook event now has
`session(options, meta)`:

- It opens a child session of the hook's
  owner, as `createSession` does. The owner
  is the root in `start` and `close`, and the
  hook's session in the others.
- It takes the hook's `ns` and trace, unless
  `options` names its own. In a `run` hook,
  the session's spans sit under the run's
  span.
- The caller closes it. The owner's close
  closes it too. The hook's `signal` does
  not.
- Every `session` hook runs on it. A
  `session` hook that calls `session()` must
  guard itself, or it opens sessions without
  end.
- Once the root closes, it raises `Disposed`.
  In a `close` hook, that holds before
  `next()` too.
- `scope.capsules` gets one line per capsule:
  unit `<label>:session`, with `role`,
  `explain`, and `opened`. The type is
  `Capsule.Opened`. The first call writes the
  line, even when that call fails. `opened`
  counts the sessions that opened.

### A defaulted config key may be left out

Core, ADR 0121 section 15. No code changed;
tests now pin this rule.

- A config key whose tag has a default may
  be left out of the capsule call. The hook
  and every unit read the default.
- A key whose tag has no default must be
  named.

### React

No code change. React moves to 0.10.1 with
Core.
