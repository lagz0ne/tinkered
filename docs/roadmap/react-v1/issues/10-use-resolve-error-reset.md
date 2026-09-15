# 10: `useResolve` error + `reset`

**What to build:** a throwing/rejecting operation puts the failure in `error` and sets `status: "error"`; it does **not** throw to an error boundary. `reset()` returns to idle (ADR 0032).

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] a failing `resolve` leaves `error` populated and `status: "error"`, with no error-boundary throw
- [ ] `reset()` returns `status` to idle and clears `data`/`error`
