# Changelog

Each section is one release of
`@tinker/core` and `@tinker/react`.
The two move to one version together.

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
