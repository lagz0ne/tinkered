# Testing

A test makes a real scope with the capsules the
cmd installs, and calls them through the
installs. It swaps time, chance and heavy parts.
Nothing is mocked.

## Time and chance

```ts
const clock = makeTestClock({ now: 0 });
const tide = sea({ size: 4 });
const scope = await createScope({
  clock,
  capsules: [tide],
}).ready;
const woke = scope.run(tide.nap);
clock.advance(1_000);
await woke;
```

`makeTestRandom({ seed })` makes chance repeat.

## Swap a part

Fill a slot with a test backend, as the cmd
fills it with the real one:

```ts
const memory = memoryMail();
const mailer = mail({ backend: memory.deliver });
createScope({ capsules: [memory, mailer] });
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
