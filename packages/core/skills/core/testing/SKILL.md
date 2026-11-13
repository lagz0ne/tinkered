---
name: testing
description: >
  Use when you add or fix a test in a Tinker
  app: a test of an operation, a cell, a
  capsule, time or chance, or a server and a
  client in one process.
metadata:
  purpose: >
    How to test through a real scope: swap the
    clock, the random source and heavy parts,
    and join two scopes with the memory backend.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.21.0'
requires:
  - core
sources:
  - 'lagz0ne/tinkered:packages/core/src/testing.ts'
  - 'lagz0ne/tinkered:packages/core/README.md'
---

# Testing

A test makes a real scope and calls the public
units. It swaps time, chance and heavy parts.
Nothing is mocked.

Test helpers come from `@tinkered/core/testing`.
The main entry has none.

## Setup

```ts
import { createScope, data, operation } from "@tinkered/core";
import {
  makeTestClock,
  makeTestRandom,
} from "@tinkered/core/testing";

const stamps = data<number[]>({
  label: "stamps",
  initial: [],
});

const stamp = operation({
  label: "stamp",
  depends: { stamps: stamps.controller },
  run: ({ stamps }, { clock }) => {
    stamps.update((l) => [...l, clock.currentTimeMillis()]);
    return stamps.get();
  },
});

const clock = makeTestClock({ now: 1_000 });
const scope = createScope({
  clock,
  random: makeTestRandom({ seed: 42 }),
});

await scope.run(stamp);
clock.advance(500);
const seen = await scope.run(stamp);
// seen is [1000, 1500]
await scope.close();
```

- One scope per test. Close it at the end.
- Assert on what a caller can see: a return
  value, a cell, an error.

## Core patterns

### Swap a part

A preset replaces one unit in one scope.

```ts
import { createScope, data, resource } from "@tinkered/core";
import { preset } from "@tinkered/core/testing";

const compiler = resource({
  label: "compiler",
  factory: () => ({ build: (src: string) => src }),
});
const count = data({ label: "count", initial: 0 });

const scope = createScope({
  presets: [
    preset(count, 3),
    preset(compiler, () => ({ build: () => "fake" })),
  ],
});
```

### Test a capsule as the cmd installs it

```ts no-check
const app = await createScope({
  capsules: [sea({ size: 4 })],
}).ready;
expect(app.run(sea.press, { input: { x: 9 } })).toBe(1);
await app.close();
```

### Join a server and a client

The `memory` backend joins two scopes in one
process. No socket, no port.

```ts no-check
import { memory } from "@tinkered/core/testing";

const server = await createScope({
  capsules: [
    sea.board({ serve: true }),
    sea.api({ implement: seaOps }),
    memory.server({
      services: [sea.board, sea.api],
    }),
  ],
}).ready;

const client = await createScope({
  capsules: [
    memory.client({ peer: server }),
    sea.board({ read: memory.client }),
    sea.api({ remote: memory.client }),
  ],
}).ready;

await client.run(sea.api["wave.press"], {
  input: { room: "a", id: "1", hue: 7 },
});
```

A remote read starts when it has a reader. In a
test, `watch` the read first, then wait for the
value:

```ts no-check
const read = client.resolve(
  sea.board.waves.where({ room: "a" }),
);
const stop = read.watch(() => {});
// after the write arrives
expect(read.get()).toHaveLength(1);
stop();
```

### Ship test tooling with a capsule

A capsule's author puts test tooling in a plain
capsule in a `*.testing.ts` file. Only test files
import it. The build check refuses that file in a
prod bundle.

## Common mistakes

### HIGH: a mock of a module

`vi.mock` hides the graph that the test must
prove. Swap one unit with `preset`, or pass a
fake as capsule config.

### HIGH: a test of a private function

A test that calls an inner function breaks on
each refactor. Call the operation through a scope
and assert on the result.

### HIGH: real time in a test

`setTimeout` and `Date.now()` make a slow test
that fails by chance. Use `makeTestClock` and
`clock.advance`.

### MEDIUM: a scope that stays open

An open scope keeps timers and sockets. Close
each scope, and each side of a memory pair.

## Completion

- The test fails without the change and passes
  with it.
- `bun run test` passes.
- `bun run build` passes: its check finds test
  code in a prod bundle.
