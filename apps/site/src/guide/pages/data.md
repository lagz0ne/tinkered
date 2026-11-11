# Data

A cell holds a value. A keyed cell holds members
under keys. A write wakes only the readers of
what changed.

## One value

```ts
const theme = data({ label: "theme", initial: "light" });

depends: { theme: theme.controller }
// theme.get(), theme.set(v), theme.update(fn)
```

- `controller` can write.
- A plain `depends: { theme }` reads the value.

## Keyed

```ts
const waves = data({
  label: "sea.waves",
  mode: "keyed",
  parse: wave,
  key: (w) => ({ room: w.room, id: w.id }),
});
```

- `set(member)` adds or replaces a member.
- `update(key, fn)` changes one member.
- `delete(key)` removes one.
- `waves.of({ room, id })` reads one member.
- `waves.where({ room })` reads the members
  whose key holds those fields.

A write to one member wakes the readers of that
member and of its parts. No other reader runs.

## Where a write lands

A write from a session stays in that session.
The edge says when it must go up:

```ts
depends: {
  own: token.controller,
  ns: token.atNamespace.controller,
  all: token.atScope.controller,
}
```
