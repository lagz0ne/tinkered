# 04: Draft a summary with the existing harness

**What to build:** An optional helper reads an issue and its discussion and drafts a short summary
or next steps. Stream its visible progress. The person can cancel, discard, or explicitly post the
draft as a comment. Normal tracker use does not need model credentials.

**Blocked by:** 03 — Use the same actions from CLI and MCP.

**Status:** Doing — sole private Muse writer 257f478e; lead review follows saved implementation.

- [ ] Use `@tinker/harness` and the existing issue tools; do not create `@tinker/ai`.
- [ ] The run has an owned session; transient progress is distinct from saved comments.
- [ ] Cancel stops the turn; closing the UI view detaches its listeners without losing saved work.
- [ ] Posting a draft uses the existing comment action and only happens on explicit user action.
- [ ] Seam tests use the public lazy SDK preset in tests only; no model credentials or mocks needed.
- [ ] Document live adapter setup and state honestly whether a credentialed live run was verified.
- [ ] Checks and Core feedback are recorded, especially publishing run cells and tool composition.
