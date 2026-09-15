# 13: StrictMode double-mount safety

**What to build:** under `<StrictMode>` (mount→unmount→mount), `<SessionProvider>` creates a fresh session on the committed mount, closes the discarded one, and leaks nothing (ADR 0031). The dev-only create/close/create cycle is correct.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] under `<StrictMode>` exactly one live session remains after mount (session-created count minus closed count == 1)
- [ ] no session resource instance from a discarded mount survives (its `defer` ran)
