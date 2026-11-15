# Gaps

Each row is a place where the site breaks a
Tinker rule for now. `tinker check` allows a
line marked `// tinker-gap: G<n>` while its row
is open. It fails when a row has more marked
lines than its count. So a count only goes down.

## G1: a keyed cell has no type

- Status: open
- Lines: 1
- Where: `src/sea/tide.ts`.
- Why: a read's `cell` is not typed, so the
  tide casts it to its keyed type. A unit cannot
  name a part whose key comes at run time (Core
  gap, `docs/roadmap/core-feedback.md`).
- Closes when: Core types the `cell` of a read.
