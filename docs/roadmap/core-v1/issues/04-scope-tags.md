# 04: Scope tags, all modes

**What to build:** `tag({ label, default, parse, eq })` read through commands in every mode — `required`, `optional`, `.all` — with duplicate bindings preserved nearest-first, `absent` vs `undefined`-default distinguished, defaults applied only to required/optional. (ADR 0012)

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `required` returns seeded value or default; missing → `MissingTag`
- [ ] `optional` returns presence, including `{present:true,value:undefined}` for an `undefined` default
- [ ] `.all` returns bindings only, nearest-first, no default fallback; duplicates preserved
