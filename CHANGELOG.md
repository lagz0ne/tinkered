# Changelog

Each section is one release of
`@tinker/core`, `@tinker/react` and,
since 0.15.0, `@tinker/bun`.
They move to one version together.

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
