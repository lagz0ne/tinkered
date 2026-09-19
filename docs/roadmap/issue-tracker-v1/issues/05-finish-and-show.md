# 05: Finish the demo and its test guide

**What to build:** A polished, runnable example with a short walkthrough explaining how one saved
issue travels through the libraries, and how to test that behavior. Complete reconnect, failure,
and shutdown behavior for the flows already built. Publish a verified temporary browser preview.

**Blocked by:** 04 — Draft a summary with the existing harness.

**Status:** Done — final acceptance, tag/push, public two-tab browser proof, and writer cleanup are verified. [Completion evidence](../PROGRESS.md#t05-complete--2026-09-19).

- [x] Reconnecting restores current server state; pending/error states are visible and recoverable.
- [x] Restart persistence, two-tab updates, a rejected edit, and run cancellation have direct proof.
- [x] Teardown closes the app's resources and live connections without hanging on endless streams.
- [x] A short README maps real app behavior to each library and gives start/test commands.
- [x] The normal app runs without an external account; optional harness setup is separate.
- [x] Mobile layout and keyboard use work; the lead verifies the actual browser result.
- [x] Public imports, app build/tests, repo checks/validation, strict census, and feedback are complete.
- [x] Code, notes, and tags are pushed; the preview URL is fetched successfully before sharing.
