# The rules

Each rule has a check that a tool runs. So a
person or an AI can trust the code shape without
reading every line.

- **Seam**: only a cmd reads env, files or the
  clock of the host. Check: the cmd is the only
  place `env` goes.
- **Config is a capsule key**: the cmd calls
  `x({ ... })`. Root `tags` never fill a key.
  Check: `MissingConfig` at start.
- **One door**: a feature is reached as
  `@/<feature>`. Check: lint
  `no-restricted-imports`.
- **Exports state intent**: a cell export is
  read only. Check: `InvalidDependency` and lint
  `tinker/cell-write`.
- **No plain helpers**: every named function is
  an operation. Check: `bun run check:plain`.
- **No React state or effects**: no `useState`,
  `useReducer` or `useEffect`. Check: the client
  check in `bun run check`.
- **One wire**: the page talks to the server by
  rpc and remote data only. Check: no `fetch`
  or `WebSocket` in the client bundle.
- **Floating promises**: a root answers each call
  with a promise. Check: lint
  `no-floating-promises`.

## Why

A rule a tool checks holds for every change. A
trace then lines up with the code: each span is an
operation with a label, and each edge is a
`depends`.
