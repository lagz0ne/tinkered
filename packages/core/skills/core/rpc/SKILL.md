---
name: rpc
description: >
  Use when the page must call the server or read
  server state live in a Tinker app: an rpc
  contract, its server operations, a remote data
  board, a guard, or a fault. Also when a check
  prints tinker/one-wire.
metadata:
  purpose: >
    How to declare one contract for both sides,
    serve it, call it, and read server cells
    on the client with remote data.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.21.3'
requires:
  - core
  - capsule
sources:
  - 'lagz0ne/tinkered:packages/core/src/rpc.ts'
  - 'lagz0ne/tinkered:packages/core/src/remote-data.ts'
---

# rpc and remote data

`rpc` is a call: the client asks, the server
answers. `remoteData` is a live read: the server
writes a cell, each client that reads it gets the
change. Both are one contract that both sides
import.

Core owns the meaning. A backend owns the wire:
`ws` from `@tinkered/bun`, `memory` for tests.

## Setup

One file, `src/sea/contract.ts`, for both sides:

```ts
import {
  capsule,
  data,
  operation,
  remoteData,
  rpc,
} from "@tinkered/core";
import { z } from "zod";

const wave = z.object({
  room: z.string(),
  id: z.string(),
  hue: z.number(),
});

export const waves = data({
  label: "sea.waves",
  mode: "keyed",
  parse: wave,
  key: (w) => ({ room: w.room, id: w.id }),
});

export const seaBoard = remoteData({ waves });

export const seaApi = rpc({
  "wave.press": {
    input: wave,
    output: z.object({ count: z.number() }),
  },
});

export const sea = capsule({
  label: "sea",
  exports: { board: seaBoard, api: seaApi },
});

// src/sea/ops.server.ts
const press = operation({
  label: "sea.press.do",
  input: seaApi["wave.press"].input,
  depends: { list: waves.controller },
  run: ({ list }, { input }) => {
    list.set(input);
    return { count: list.get().length };
  },
});

export const seaOps = { "wave.press": press };
```

- The server operation takes its `input` from the
  contract. Its return must fit `output`.
- The server is the only writer of `waves`.

## Core patterns

### Install each side

```ts no-check
// cmds/server.ts
capsules: [
  sea.board({ serve: true }),
  sea.api({ implement: seaOps }),
  ws.server({
    path: "/rpc",
    services: [sea.board, sea.api],
  }),
],

// cmds/browser.tsx
capsules: [
  ws.client({ url }),
  sea.board({ read: ws.client }),
  sea.api({ remote: ws.client }),
],
```

- Each side is its own scope. Each side runs
  alone.
- A service must be in `services`, or no client
  can reach it.
- An address is a call's key or a cell's name.
  Two services with one address fail the start
  with `DuplicateAddress`. So two boards cannot
  both have a cell named `flows`: rename one.

### Call and read on the client

```ts no-check
// any operation or page on the client
await scope.run(sea.api["wave.press"], {
  input: { room: "a", id: "1", hue: 7 },
});

// React
const press = useRun(sea.api["wave.press"]);
const list = useData(
  sea.board.waves.where({ room }),
);
```

- The first reader of a part asks the server for
  it. A write sends the member it changed, not
  the list.
- `board.invalidate` marks a part dirty, so its
  readers ask again.
- A call ends at its reply, as a TanStack Query
  mutation. To see your own write at once, run
  `board.invalidate` on its part after the call.

### Handle a fault

A failed call is a fault from a fixed set:

- `refused`: a guard said no.
- `failed`: the server threw. The cause stays in
  the server log; the client gets a trace id.
  `error.execution` is the call's id: the server
  log line has the same id, with tracing off too.
- `invalid`, `encode`, `decode`: a bad shape.
- `link`: the wire is down.

```ts no-check
try {
  await scope.run(sea.api["wave.press"], { input });
} catch (error) {
  if (sea.api.fault.is(error)) error.fault;
}
```

A remote data read never throws. Its last fault
is data: `sea.board.faults`.

## Common mistakes

### HIGH: `fetch` or `WebSocket` on the page [tinker/one-wire]

Wrong:

```ts no-check
const res = await fetch("/api/waves");
```

Right: add an address to the contract and call it.
Check: `bun run check` fails when the client
bundle holds `fetch`, `XMLHttpRequest`,
`EventSource` or `WebSocket`.

### HIGH: the client writes a remote cell

The client side of a board is read only. To change
server state, call an rpc address. The server
operation writes the cell, and the change comes
back by the board.

### HIGH: a list as one remote value

A single cell sends the whole list on each
change. Use `mode: "keyed"`, and read with
`where` or `of`.

### MEDIUM: the page imports server code

The page imports `@/sea`. The server imports
`@/sea/index.server`. `bun run check` fails when
a server module is in the client bundle.

## Completion

- A test joins both sides with the `memory`
  backend. Read [testing](../testing/SKILL.md).
- `bun run check` passes its client check.
