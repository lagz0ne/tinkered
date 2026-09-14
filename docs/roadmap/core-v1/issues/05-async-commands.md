# 05: Async commands + work ownership

**What to build:** async command bodies (await/reject), input snapshot captured before suspension, concurrent calls that are independent (no shared memo), and an owner that tracks unfinished work. Proves no-ALS parallel safety.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] a rejecting `run` rejects `resolve`; the cause is preserved
- [ ] two overlapping gated resolves (handshake: enter → await test promise → assert) return their own results regardless of completion order
- [ ] the owner reports work as pending until it settles
- [ ] no-ALS: overlapping sessions with different data/tags, reversed completion, correct results
