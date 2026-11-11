# Testing

A test makes a real scope. It swaps time, chance
and heavy parts. Nothing is mocked.

## Time and chance

```ts
const clock = makeTestClock({ now: 0 });
const scope = createScope({ clock });
const woke = scope.run(nap);
clock.advance(1_000);
await woke;
```

`makeTestRandom({ seed })` makes chance repeat.

## Swap a part

```ts
createScope({
  capsules: [sea.board({ serve: true })],
  presets: [preset(waves, [])],
});
```

## Both sides, one process

The `memory` backend joins a server scope and a
client scope in one test:

```ts
const server = await createScope({
  capsules: [
    sea.api({ implement: seaOps }),
    memory.server({ services: [sea.api] }),
  ],
}).ready;
const client = await createScope({
  capsules: [
    memory.client({ peer: server }),
    sea.api({ remote: memory.client }),
  ],
}).ready;
await client.run(sea.api["wave.press"], {
  input: { room: "a", x: 1, y: 2 },
});
```
