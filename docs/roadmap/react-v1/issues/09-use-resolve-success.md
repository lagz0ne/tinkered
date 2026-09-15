# 09: `useResolve` success path

**What to build:** `useResolve(op)` returns `{ resolve, status, data, error, reset }` for an operation; it is imperative and never suspends (ADR 0032). Calling `resolve(input)` runs the command and drives `status` idle→pending→success with `data`. Uses the deterministic-async fixture (01).

**Blocked by:** 02, 01

**Status:** ready-for-agent

- [ ] `resolve(input)` transitions idle→pending→success and exposes `data`
- [ ] a `rawInput` is parsed through the operation's `input` parser (ADR 0006)
- [ ] `resolve` from an event handler does not suspend the tree
