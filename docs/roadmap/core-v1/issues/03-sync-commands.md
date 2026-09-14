# 03: Sync commands (incl. effects)

**What to build:** `operation({ label, input?, depends, run })` as a command — typed `input` parsed from `rawInput`, read-mode deps delivered as value snapshots, write-mode `data.controller` deps used to cause effects, and nested command controllers callable. A command runs on **every** `resolve` (never memoized). A fully-sync command resolve allocates zero promises.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] a command reads deps and writes a cell; effect visible after `resolve`
- [ ] resolving twice runs the body twice (counter proves no memo)
- [ ] a bare `operation` used as a value dependency is rejected (registry error); `op.controller` is the callable form
- [ ] inferred typed input, cast-free; sync command resolve = 0 promises (bench lane)
