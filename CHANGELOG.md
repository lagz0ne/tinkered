# Changelog

Each section is one release of
`@tinker/core` and `@tinker/react`.
The two move to one version together.

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
