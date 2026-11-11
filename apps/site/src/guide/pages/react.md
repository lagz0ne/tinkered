# React

React is a thin host. It reads cells and runs
operations. It holds no state and no effect of its
own.

## The root

```tsx
const live = await app.ready;
createRoot(el).render(
  <ScopeProvider scope={live}>
    <App />
  </ScopeProvider>,
);
```

## Read and act

```tsx
function Board({ room }: { room: string }) {
  const list = useData(sea.board.waves.where({ room }));
  const press = useRun(sea.api["wave.press"]);
  return list.map((w) => (
    <Tile key={w.id} wave={w} onPress={press.run} />
  ));
}
```

- `useData(cell)` re-renders when that cell
  changes.
- `useRun(op)` gives `run`, `data` and
  `error`.

## Banned

- `useState`, `useReducer`: a cell holds state.
- `useEffect`: a resource holds the effect.
- `fetch`, `WebSocket`: the rpc client is the
  only wire.

`bun run check` fails on each one.
