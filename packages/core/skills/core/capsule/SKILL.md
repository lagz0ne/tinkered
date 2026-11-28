---
name: capsule
description: >
  Use when you add a feature to a Tinker app,
  give it settings, install it in a cmd, or
  import it from other code. Also when start
  fails with MissingConfig, or a check prints
  tinker/seam, tinker/config or tinker/barrel.
  Also when you add an adapter: a mailer, a
  provider client, a store.
metadata:
  purpose: >
    How to write a capsule, fill its config in
    the cmd, and reach its units through the
    binding only.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.34.22'
requires:
  - core
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
  - 'lagz0ne/tinkered:docs/best-practices.md'
---

# Capsule

A capsule holds a feature's config, its exports
and its hooks. A cmd installs it with values.
Code reaches a unit through its install, kept in
a const: `waves.press`, never a bare `press`.

## Setup

```ts
import {
  capsule,
  createScope,
  data,
  operation,
  tag,
} from "@tinkered/core";
import { z } from "zod";

// src/sea/index.ts
const size = tag<number>({ label: "sea.size" });

const waves = data<number[]>({
  label: "sea.waves",
  initial: [],
});

const press = operation({
  label: "sea.press",
  input: z.object({ x: z.number() }),
  depends: { size, waves: waves.controller },
  run: ({ size, waves }, { input }) => {
    waves.update((list) => [...list, input.x % size]);
    return waves.get().length;
  },
});

export const sea = capsule({
  label: "sea",
  config: { size: size.required },
  exports: { waves, press },
});

// cmds/server.ts
const tide = sea({ size: 4 });
const app = createScope({ capsules: [tide] });
const live = await app.ready;
live.run(tide.press, { input: { x: 9 } });
live.resolve(tide.waves).get();
await live.close();
```

- `config` names the keys the feature reads. Each
  key is a tag.
- `exports` names what others may touch: an
  operation to call, a cell to read.
- The cmd calls the capsule with values. That
  call is the install. Keep it in a const, and
  reach each export through it: `tide.press`.
- `await app.ready` gives the started scope. Its
  sync calls stay sync.
- `await app.settled` gives the same end as a
  value, never a throw: `success` with `handle`,
  `cancelled` with `reason`, or `failed` with
  `error` (ADR 0165).
- `await live.idle()` waits until the scope's
  in-flight work ends.

## Core patterns

### The cmd is the seam

Only the cmd reads env, files and the host clock.
It turns them into config values.

```ts no-check
// cmds/server.ts
export default defineMain(async ({ env, signal }) => {
  const app = createScope({
    signal,
    capsules: [
      sea({ size: Number(env.SEA_SIZE ?? 4) }),
    ],
  });
  const live = await app.ready;
  return { closed: live.closed };
});
```

- One top-level `createScope`. No wrapper
  function builds it.
- A feature never reads `process.env`.

### An adapter is a backend capsule in an op slot

A mailer, a provider client or a store is an
adapter. The app's capsule declares a slot: a tag
that holds an operation (ADR 0151). A backend
capsule gives the operation, and the cmd fills
the slot with it.

```ts
import {
  capsule,
  createScope,
  data,
  operation,
  tag,
  type Operation,
} from "@tinkered/core";
import { z } from "zod";

// src/mail/index.ts
const letter = z.object({
  to: z.string(),
  body: z.string(),
});
type Letter = z.infer<typeof letter>;

// The slot. Handle<Out, In>: no answer, a letter.
const backend = tag<Operation.Handle<void, Letter>>({
  label: "mail.backend",
});

const send = operation({
  label: "mail.send",
  input: letter,
  depends: { backend },
  run: ({ backend }, { input }) =>
    backend.run({ input }),
});

export const mail = capsule({
  label: "mail",
  config: { backend: backend.required },
  exports: { send },
});

// src/mail/memory.server.ts
const sent = data<Letter[]>({
  label: "mail.memory.sent",
  initial: [],
});

const deliver = operation({
  label: "mail.memory.deliver",
  input: letter,
  depends: { sent: sent.controller },
  run: ({ sent }, { input }) => {
    sent.update((list) => [...list, input]);
  },
});

export const memoryMail = capsule({
  label: "mail.memory",
  exports: { sent, deliver },
});

// cmds/server.ts
const memory = memoryMail();
const mailer = mail({ backend: memory.deliver });
const app = createScope({
  capsules: [memory, mailer],
});
const live = await app.ready;
await live.run(mailer.send, {
  input: { to: "ana@x.io", body: "Hi" },
});
live.resolve(memory.sent).get();
await live.close();
```

- A feature takes the send op in its own slot,
  filled with `mailer.send`. It never sees which
  backend runs.
- The backend's operation has its own
  `depends`: a queue, an identity, a client. Its
  capsule's `start` hook can check them.
- A real backend and the memory one fill the same
  slot: `mail({ backend: queue.deliver })` in the
  server cmd, `memory.deliver` in a test.
- `Operation.Handle<Out, In>` names the answer
  first, then the input.
- The graph names the slot:
  `calls{slot:mail.backend}`.

### A foreign callback lives in a capsule

A `MessagePort`, a `ResizeObserver` or a process
hook calls your code outside any run. Put the
listener in the capsule's `start` hook, written
in place. It enters a run with the hook's `run`.

```ts
import { capsule, data, operation, tag } from "@tinkered/core";

// src/kit/port-link.ts
const port = tag<MessagePort>({ label: "port.port" });

const got = data<unknown[]>({
  label: "port.got",
  initial: [],
});

const take = operation({
  label: "port.take",
  depends: { got: got.controller },
  run: ({ got }, { input }: { input: unknown }) => {
    got.update((list) => [...list, input]);
  },
});

export const portLink = capsule({
  label: "port",
  config: { port: port.required },
  exports: { got, take },
  hooks: {
    async start({ next, run, config, closing }) {
      config.port.addEventListener(
        "message",
        (event) =>
          void run(
            take,
            { input: event.data },
            { role: "handler", explain: "One message" },
          ),
        { signal: closing },
      );
      config.port.start();
      await next();
    },
  },
});
```

- Each message is one run of `take`: a span, and
  its deps come through the graph.
- `closing` takes the listener off when the scope
  closes.
- A run with a `signal`, such as
  `run(pump, { signal: closing }, note)`, opens a
  child session (ADR 0090). A `cell.controller`
  write lands in that session, and the root never
  sees it. Depend on `cell.atScope.controller` to
  write the root (ADR 0126).
- A library's plugin, such as `setup` in
  `Bun.build({ plugins: [...] })`, is written in
  place in the call, inside an operation.
- Code that runs before any scope, such as a
  frame's script, gets its own cmd: it makes the
  scope, and a capsule's `start` hook does the
  work.

## Common mistakes

### HIGH: root tags fill a capsule key [tinker/config]

Start fails with `MissingConfig`. A capsule reads
its config from its own call only.

Wrong:

```ts no-check
createScope({
  tags: [size(4)],
  capsules: [sea],
});
```

Right: `const tide = sea({ size: 4 })`, then
`capsules: [tide]`.

### HIGH: a feature reads env [tinker/seam]

Wrong:

```ts no-check
const press = operation({
  label: "sea.press",
  run: () => Number(process.env.SEA_SIZE),
});
```

Right: declare a `config` key, and let the cmd
pass the value.

### HIGH: a barrel [tinker/barrel]

A barrel passes on what other files export. Its
importer cannot see which files it reaches. One
of them can be a `.server.` file, and then the
page build takes server code.

Wrong:

```ts no-check
export * from "./todo-list";
export type { Todo } from "./todo.schema";
```

Right: delete the re-export. Import the name from
the file that declares it, as
`import { TodoList } from "@/todo/todo-list";`.
A file exports only what it declares.

Check: `tinker check` prints each re-export and
its line.

### HIGH: an adapter as `{ key: fn }` in a tag [tinker/plain]

A tag that holds an object of functions hides
each call. The functions have no span and no
deps, and the graph shows `calls{?}`.

Wrong:

```ts no-check
const mailer = tag<{
  send: (letter: Letter) => Promise<void>;
}>({ label: "mail.mailer" });

mail({ mailer: { send: async (l) => post(l) } });
```

Right: make the adapter a backend capsule, and
fill the app capsule's op slot with its
operation: `mail({ backend: queue.deliver })`.
See "An adapter is a backend capsule in an op
slot".

Check: `tinker check` prints each function in the
object.

### HIGH: a bare unit or a capsule handle in a call

`scope.run(press)` reaches past the capsule. So
does `scope.run(sea.press)` or
`depends: { send: mail.send }` in another
feature: it names no install, and a second
install of `sea` or `mail` breaks it (ADR 0172).

Wrong:

```ts no-check
await live.run(press, { input: { x: 9 } });
const greet = operation({
  depends: { send: mail.send },
});
```

Right: keep the install in a const and reach
through it: `live.run(tide.press, ...)`. A
feature that needs another one's op takes it in a
slot: `welcome({ send: mailer.send })`.

### MEDIUM: a function that makes units

`createSea()` that returns new units makes a
second graph that no tool can read. Declare each
unit once, at module level. Two installs of one
capsule are two bindings; pass the binding as
config.

## Completion

- The app starts: no `MissingConfig`.
- `tinker check` prints no `tinker/barrel`.
- `grep -rn "process.env" src` prints no line.
