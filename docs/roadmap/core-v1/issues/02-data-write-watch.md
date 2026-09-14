# 02: `data` write + watch

**What to build:** writing a data cell — `set`/`update` (parse-validated, eq-guarded), a synchronous flush to watchers, and `watch`/unsubscribe. The write lane allocates zero promises.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `set`/`update` reflected on the next `read` synchronously
- [ ] a watcher fires exactly once on a real change, never on an eq-equal write; unsubscribe stops it
- [ ] an invalid write throws a registry error (add the entry here, ADR 0004)
- [ ] write+flush lane: 0 promises (bench lane, ADR 0016)
