# 07: Structured close + `onClose`

**What to build:** `close(outcome)` that closes children first, joins owned pending work, runs `onOutcome` then `cleanup` (LIFO, collect-and-continue), runs userland `onClose`, seals the layer (late acts fail with a `Disposed` registry error), and is safe to call twice (a second close awaits the first). Concurrent sessions stay isolated. (ADRs 0011, 0017)

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] closing a parent closes its child first (child cleanup runs before parent teardown)
- [ ] owned pending work is joined before teardown (handshake gate, not a sleep)
- [ ] a late `getController`/`set` on a closed scope → `Disposed`
- [ ] a throwing hook does not stop the others; errors surface as an aggregate
