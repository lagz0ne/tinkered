# Remote data

`remoteData` reads server cells on the client.
The server is the only writer. A write reaches each
client that reads that part.

## The board

```ts
const waves = data({
  label: "sea.waves",
  mode: "keyed",
  parse: wave,
  key: (w) => ({ room: w.room, id: w.id }),
});
export const seaBoard = remoteData({ waves });
```

- Server: `sea.board({ serve: true })`. An op
  writes `waves.controller`.
- Client: `sea.board({ read: ws.client })`.

## Read a part

```tsx
const list = useData(
  sea.board.waves.where({ room }),
);
const one = useData(
  sea.board.waves.of({ room, id }),
);
```

- The first reader of a part asks for it.
- A guard runs at each ask.
- A write sends the member it changed, not the
  list.
- `board.invalidate` marks a part dirty, so its
  readers ask again.

## Faults are data

`useData(sea.board.faults)` holds each part's
last fault. A read never throws.
