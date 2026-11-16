# 0158 `set` is the one way to change a member

Date: 2026-11-16. Status: accepted (Duke, 03:14
UTC).
Changes: ADR 0135 and ADR 0138 (the keyed cell's
handle).

## What the user said

- 2026-11-15 11:20: "solve the case with as little
  surface as possible".
- 2026-11-16 03:14: "we should keep only one api
  design, let's keep the set as you suggested".

## Context

A keyed cell had two ways to change one member:

```ts
list.update(key, (old) => ({ ...old, state }));
list.set({ ...issue, state });
```

Both replace one member. Both wake the same
readers.

The CUJ eval showed the cost. The golden code used
`update`. Three of six Sonnet runs wrote `set`,
and passed every journey. An operation that
changes a member has read it first, for a check.
So it holds the member, and `set` needs no second
read.

The known model is a key-value store: a `put` of
the whole value by its key. A store with `put`
needs no `update`.

## Decision

1. A keyed controller has no `update`.
   `set(member)` adds a member or replaces the one
   with that key.
2. The errors `MissingMember` and `KeyChanged` go.
   Only `update` raised them.
3. A plain cell keeps `update(fn)`. This decision
   is about a keyed cell only.

## Consequences

- `list.update(key, fn)` is a type error. That is
  the first step of the correction loop.
- To change a member: read it with `of(key)`,
  then `set({ ...member, field })`.
- A `set` with another key adds a member. The old
  one stays until `delete(key)`.
- Core is 81 B smaller.
