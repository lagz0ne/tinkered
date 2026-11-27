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
  library_version: '0.34.18'
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
- A keyed cell `tasks` serves `tasks` and its ask,
  `tasks.ask`. An rpc op must not use either name.

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
- Watching `board.status(read)` also holds the part.
- `board.invalidate` marks a part dirty, so its
  readers ask again.
- `sea.board({ read, refetchInterval: { waves:
30_000 } })` makes each part in use ask again
  every 30 s. With none, it never asks by time.
- A call ends at its reply, as a TanStack Query
  mutation. To see your own write at once, run
  `board.invalidate` on its part after the call.

### Guard a call or a read

A guard is an operation with the input
`transport.hook.start`. It runs before each call
or each read of the service it is on.

```ts no-check
// src/sea/ops.server.ts
import { operation, tag, transport } from "@tinkered/core";

const viewer = tag<string>({ label: "sea.viewer" });

export const signedIn = operation({
  label: "sea.signedIn",
  input: transport.hook.start,
  run: (_, { input }) => {
    const who = input.meta.who;
    return who
      ? { tags: [viewer(who)] }
      : input.refuse({ signIn: true });
  },
});

export const inRoom = operation({
  label: "sea.inRoom",
  input: transport.hook.start,
  depends: { me: viewer.required },
  run: ({ me }, { input }) => {
    const room = seaBoard.part(input)?.room ?? "";
    if (!me.startsWith(room)) {
      return input.refuse({ notIn: room });
    }
  },
});

// cmds/server.ts
sea.board({ serve: true, onStart: [signedIn, inRoom] }),
sea.api({ implement: seaOps, onStart: [signedIn] }),
```

- `input.meta` is what the client's backend sent
  with the message: `ws.client({ url, meta })`.
- `input.refuse(payload)` ends the call. The
  client gets a `refused` fault with the payload.
- A returned `{ tags }` binds each tag for the
  later guards and for the operation. They take
  it with `depends: { me: viewer.required }`.
- No return lets the call go on.
- The guards in `onStart` run in order.
- On a read, `board.part(input)` gives the key of
  the part the client asks for. Do not read
  `input.input` by hand.
- A part can be one member, by its whole key.
  After a set, Core asks again for each changed
  member by its whole key (ADR 0138 d11).
- So a guard for `where({ userId })` also gets
  `{ teamId, userId }`. Check each field the
  part has, not only the field the page asked:

```ts no-check
const part = teamBoard.part(input) ?? {};
if ("teamId" in part && !teams.includes(part.teamId)) {
  return input.refuse({ notMember: part.teamId });
}
```

### Handle a fault

A failed call is a fault from a fixed set:

- `refused`: a guard said no.
- `failed`: the server threw. The cause stays in
  the server log.
  `error.traceId` is the call's trace (unset with
  tracing off): one id finds every log line on
  both sides.
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

`tinker graph` lists them: an op line's
`faults{}` names each fault its member calls can
end with.

A remote data read never throws. Its last fault
is data: `sea.board.faults`.

A key whose stream ends on any fault but `link`
waits: `refused`, `invalid`, `failed`, `missing`,
`encode`, `decode`. It never asks again by itself.
After a sign-in, name it in `board.invalidate`. A
keyed key takes its part; a plain key takes `{}`:

```ts
import { data, remoteData } from "@tinkered/core";
import type { Scope } from "@tinkered/core";

declare const scope: Scope.Handle;
const notes = data({ initial: [] as string[] });
const board = remoteData({ notes });

await scope.run(board.invalidate, {
  input: { notes: {} },
});
```

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
