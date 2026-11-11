# Operation

An operation is an action: a label, an input
shape, its deps and a `run`. Every call is a span.

## Write one

```ts
const press = operation({
  label: "wave.press",
  input: z.object({ x: z.number(), y: z.number() }),
  depends: { waves: waves.controller },
  run: ({ waves }, { input, clock, random }) => {
    const hue = Math.floor(random.next() * 360);
    const at = clock.currentTimeMillis();
    waves.set({ ...input, id: random.uuid(), hue, at });
    return { hue };
  },
});
```

- `input` checks the raw input at the door.
  Bad input fails with `DataValidationFailed`.
- `depends` names what the run reads and writes.
- The ctx brings `clock`, `random`, `signal`
  and `obs`. A test swaps them; nothing is
  mocked.

## Call one

The same op, from any place:

```ts
await scope.run(press, { input: { x: 1, y: 2 } });
const result = await scope.settle(press, {
  input: { x: 1, y: 2 },
});
```

- `run` answers the value or throws.
- `settle` answers `{ status, value | error }`.
- In React, `useRun(press)` gives `run`,
  `data` and `error`.

## Why every function is one

A plain helper has no span and no deps. An
operation has both. So a trace shows each step,
and a tool can draw the call graph from code.
