# 03: Use the same actions from CLI and MCP

**What to build:** List/create/update/comment through CLI commands and MCP tools. A browser sees
those changes live. All mutations reach the running app's authority; a second process must not
silently own a separate source scope or bypass publication.

**Blocked by:** 02 — Edit, assign, and discuss issues.

**Status:** Done — code `3303f5a`; [independent final proof](../PROGRESS.md#t03-complete--2026-09-19).

- [x] HTTP routes and MCP tools use the same declared issue operations and input rules.
- [x] CLI uses the existing driver and HTTP frame to reach the running server.
- [x] MCP connects through a documented supported transport; no private library imports.
- [x] Tests through CLI `run` and the real MCP SDK client prove saved results and managed errors.
- [x] A change through one non-browser entry appears in the browser without a refresh.
- [x] Checks and Core feedback are recorded; duplicated domain logic is a review finding.
