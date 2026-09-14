# 17: Typed data/command presets

**What to build:** `preset(node, replacement)` as a test-only substitution — a `data` replacement validated by `parse`, a command replacement (`run`), applied to downstream consumers only. Warm-reload is not a preset (ADR 0015).

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] a data preset is seen by a downstream command, validated by `parse`
- [ ] a command preset replaces the run for downstream consumers
- [ ] preset use outside tests is flagged (lint rule)
