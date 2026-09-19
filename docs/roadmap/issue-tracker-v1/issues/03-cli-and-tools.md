# 03: Use the same actions from CLI and MCP

**What to build:** List/create/update/comment through CLI commands and MCP tools. A browser sees
those changes live. All mutations reach the running app's authority; a second process must not
silently own a separate source scope or bypass publication.

**Blocked by:** 02 — Edit, assign, and discuss issues.

**Status:** Review — writer commit e8ddeef; independent final gates and landing remain.

- [ ] HTTP routes and MCP tools use the same declared issue operations and input rules.
- [ ] CLI uses the existing driver and HTTP frame to reach the running server.
- [ ] MCP connects through a documented supported transport; no private library imports.
- [ ] Tests through CLI `run` and the real MCP SDK client prove saved results and managed errors.
- [ ] A change through one non-browser entry appears in the browser without a refresh.
- [ ] Checks and Core feedback are recorded; duplicated domain logic is a review finding.
