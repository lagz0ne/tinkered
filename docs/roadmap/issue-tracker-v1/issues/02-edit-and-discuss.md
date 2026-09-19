# 02: Edit, assign, and discuss issues

**What to build:** Open an issue, edit its title/description, select a demo assignee, move it through
Open/In progress/Done, and add comments. Show saved activity and a filtered list or board. Other tabs
see each saved change. Unsaved drafts remain local.

**Blocked by:** 01 — Create an issue and see it live.

**Status:** Done — code `1be5dfc`; independent lead gates and browser proof passed.

- [x] Detail and list remain consistent after edits, comments, and status changes.
- [x] Selected details use sync family identities where they simplify subscriptions.
- [x] A stale concurrent edit is reported clearly rather than silently losing a person's change;
      define a small revision check for saved edits, while comments append independently.
- [x] A rejected edit changes neither saved history nor published state.
- [x] Public-seam and browser tests cover distinct promises; tests need no sleeps or mocks.
- [x] Checks and Core feedback are recorded, especially cell ownership and subscription cleanup.

Detail uses HTTP reads triggered by list snapshots. A sync family did not simplify this slice.
[Lead proof](../PROGRESS.md#t02-complete--2026-09-19).
