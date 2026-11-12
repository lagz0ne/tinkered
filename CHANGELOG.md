# Changelog

Each section is one release of
`@tinkered/core`, `@tinkered/react`,
`@tinkered/bun` and `@tinkered/analyze`.
Up to 0.17.10 they were `@tinker/*`.
They move to one version together.

## 0.20.1

A Workflow SDK flow file passes `tinker/plain`
(ADR 0148, issue #35). Core, React and Bun have
no code change.

### Install

From npm:

```bash
bun add @tinkered/core@0.20.1 \
  @tinkered/react@0.20.1 \
  @tinkered/bun@0.20.1
bun add -d @tinkered/analyze@0.20.1
```

### Flow files

A flow file ends in `.flow.ts` or
`.flow.server.ts`. In it, a function whose body
starts with `"use workflow"` or `"use step"`
passes:

```ts
export async function nameFlow() {
  "use workflow";
  return await suggest();
}

async function suggest() {
  "use step";
  return callOperation("naming.suggest");
}
```

- A workflow may call its steps by name.
- Other code that calls a step by name gets a
  finding at the step.
- `start(nameFlow, [...])` is no call by name.
- A helper in a flow file still fails.

### What to change in an app

- Remove each `plain.entries` row you wrote for
  a workflow or a step, and name the file
  `*.flow.server.ts`.

## 0.20.0

`tinker/plain` looks at who calls a function
(ADR 0149). Core, React and Bun have no code
change.

### Install

From npm:

```bash
bun add @tinkered/core@0.20.0 \
  @tinkered/react@0.20.0 \
  @tinkered/bun@0.20.0
bun add -d @tinkered/analyze@0.20.0
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.20.0
bun add $R/tinker-core-0.20.0.tgz \
  $R/tinker-react-0.20.0.tgz \
  $R/tinker-bun-0.20.0.tgz
bun add -d $R/tinker-analyze-0.20.0.tgz
```

### A call by name takes the pass away

A function passes `tinker/plain` when something
else calls it: Core, a library, React. Now the
check also reads the calls. A passing function
that your code calls by name is a finding:

```text
src/page.tsx:3 tinker/plain a helper, called
by name at src/page.tsx:7
```

Your code may call by name:

- an operation, through the scope;
- a closure: a function that reads a name of a
  function around it;
- an entry in `tinker-analyze.json`.

### What to change in an app

- **New findings.** Make each helper an
  operation, or write it inline.
- **`cn` is not built in.** List it:

  ```json
  "src/ui/classes.ts": {
    "cn": "shadcn's registry imports it."
  }
  ```

- **The listener pass is gone.** A named
  function handed to `addEventListener` is a
  finding. Write the listener inline.

## 0.19.0

Each rpc call has an execution id (ADR 0147).
React, Bun and Analyze have no code change.

### Install

From npm:

```bash
bun add @tinkered/core@0.19.0 \
  @tinkered/react@0.19.0 \
  @tinkered/bun@0.19.0
bun add -d @tinkered/analyze@0.19.0
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.19.0
bun add $R/tinker-core-0.19.0.tgz \
  $R/tinker-react-0.19.0.tgz \
  $R/tinker-bun-0.19.0.tgz
bun add -d $R/tinker-analyze-0.19.0.tgz
```

### The execution id (ADR 0147)

- The client makes one id per call. It goes as
  `meta.execution`.
- The server binds it as the `execution` tag.
- A fault has it: `error.execution`.
- The server's `rpc call failed` log line has
  the same id, with tracing off too.
- A call ends at its reply, as a TanStack Query
  mutation does.

To see your own write at once:

```ts
await run(api.move, { input });
await run(board.invalidate, {
  input: { tasks: { project } },
});
```

Read the id on the server:

```ts
const audit = operation({
  depends: { id: execution.optional },
  run: ({ id }) => id.present && id.value,
});
```

## 0.18.2

`@tinkered/analyze` reads gap markers. Core,
React and Bun have no code change.

### Install

From npm:

```bash
bun add @tinkered/core@0.18.2 \
  @tinkered/react@0.18.2 \
  @tinkered/bun@0.18.2
bun add -d @tinkered/analyze@0.18.2
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.18.2
bun add $R/tinker-core-0.18.2.tgz \
  $R/tinker-react-0.18.2.tgz \
  $R/tinker-bun-0.18.2.tgz
bun add -d $R/tinker-analyze-0.18.2.tgz
```

### Gap markers (ADR 0145)

A gap is a finding that waits on a Tinker
change. Name the gaps doc in
`tinker-analyze.json`:

```json
{ "gaps": "docs/tinker-core-feedback.md" }
```

Mark the line, and give it a row:

```ts
// tinker-gap: G3
const answer = await fetch("/api/auth");
```

- The finding is allowed while row `G3` is open.
- A row allows at most its `Lines` count.
- A stale marker, a closed or missing row, or a
  row over its count breaks `tinker/gap`.
- Each run prints `gaps: G1 3/3, G3 5/5`.

## 0.18.1

A faster fan-out in React. No API changed.

### Install

From npm:

```bash
bun add @tinkered/core@0.18.1 \
  @tinkered/react@0.18.1 \
  @tinkered/bun@0.18.1
bun add -d @tinkered/analyze@0.18.1
```

From GitHub:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.18.1
bun add $R/tinker-core-0.18.1.tgz \
  $R/tinker-react-0.18.1.tgz \
  $R/tinker-bun-0.18.1.tgz
bun add -d $R/tinker-analyze-0.18.1.tgz
```

### `useData` holds its scope (ADR 0144)

- A `useData` call reads the scope from context
  in its first render only.
- React then keeps no changing context item on
  that component. A sibling that does not render
  costs less.
- Site bench, one write to 50 components, in
  Chromium: 47.2 µs to 40.3 µs.

### One behaviour changes

```tsx
<ScopeProvider scope={scope}>
  <Page />
</ScopeProvider>
```

- When `scope` becomes another scope, `Page`
  mounts again.
- Before, `Page` stayed and read the new scope.
- Typed text, focus, and scroll below the
  provider start fresh.
- `create` mode and `SessionProvider` did this
  already.

### The same as before

- A render after the scope closed raises
  `Disposed`.
- `useData` with no provider raises `NoProvider`.
- Core, Bun and analyze have no code change.

## 0.18.0

The packages are now `@tinkered/*`, and each
release goes to npm too (ADR 0146).

### Upgrade

- Rename every import: `@tinker/core` is now
  `@tinkered/core`. The same for react, bun and
  analyze.
- In `package.json`, rename the keys. Then pick
  npm or the GitHub URLs below.

### Install from npm

Once npm has the packages:

```bash
bun add @tinkered/core @tinkered/react \
  @tinkered/bun
bun add -d @tinkered/analyze
```

### Install from GitHub

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.18.0
bun add $R/tinker-core-0.18.0.tgz \
  $R/tinker-react-0.18.0.tgz \
  $R/tinker-bun-0.18.0.tgz
bun add -d $R/tinker-analyze-0.18.0.tgz
```

## 0.17.10

A new package, `@tinker/analyze`: the rule checks
in one command.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.10
bun add $R/tinker-core-0.17.10.tgz \
  $R/tinker-react-0.17.10.tgz \
  $R/tinker-bun-0.17.10.tgz
bun add -d $R/tinker-analyze-0.17.10.tgz
```

The four URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-core-0.17.10.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-react-0.17.10.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-bun-0.17.10.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.10/tinker-analyze-0.17.10.tgz

### `@tinker/analyze` (ADR 0145)

- `tinker-analyze check` reads an app's files and
  prints each broken rule: file, line, rule id.
- After the findings, each broken rule names its
  next step and the skill to read.

```text
src/a.ts:1 tinker/plain a plain function

tinker/plain: make it an operation
  read: @tinker/core#core/operation
```

- Rules: `tinker/plain`, `tinker/one-wire`,
  `tinker/react-state`.
- The app's exceptions go in
  `tinker-analyze.json`, each with a reason.
- `@tinker/analyze/lint` is the Oxlint plugin:
  `tinker/cell-write`, `tinker/blank-lines`,
  `tinker/body-steps`.
- Core, React and Bun have no code change.

## 0.17.9

Core and React ship agent skills. A run hook
can ask which op it wraps.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.9
bun add $R/tinker-core-0.17.9.tgz \
  $R/tinker-react-0.17.9.tgz \
  $R/tinker-bun-0.17.9.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.9/tinker-core-0.17.9.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.9/tinker-react-0.17.9.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.9/tinker-bun-0.17.9.tgz

### Skills for agents (ADR 0143)

- `@tinker/core` holds six skills in
  `skills/core/`: the entry, operation, data,
  capsule, rpc and testing.
- `@tinker/react` holds one in `skills/react/`.
- The format is Agent Skills. An app reads them
  with TanStack Intent:

```bash
bun add -d @tanstack/intent
bunx intent install
bunx intent list
bunx intent load @tinker/core#core/operation
```

- Each code example in a skill is compiled
  against this release.
- Each rule has an id, such as `tinker/plain`.
  A mistake in a skill carries the id of its
  rule.

### A run hook asks which op it wraps (ADR 0142)

- `event.is(op)` is a type guard. A true answer
  gives `op`, `call`, `input` and `next()` that
  op's types.
- `event.input` is the input the body gets. A
  raw call is parsed at the read.

```ts
hooks: {
  run(event) {
    if (!event.is(press)) return event.next();
    const { room } = event.input;
    return event.next();
  },
},
```

### Upgrade

- Change the three URLs.
- No code changes.

## 0.17.8

A shorter request path. No API changed.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.8
bun add $R/tinker-core-0.17.8.tgz \
  $R/tinker-react-0.17.8.tgz \
  $R/tinker-bun-0.17.8.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.8/tinker-core-0.17.8.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.8/tinker-react-0.17.8.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.8/tinker-bun-0.17.8.tgz

### The WebSocket client

- The frame of a tick goes in the next task,
  with no timer. Before, it waited at least
  1 ms on Bun and Node, and 4 ms in a browser
  when timers nest.
- One call at a time, Bun to Bun:
  1,362 µs to 108 µs.
- A call or a watch takes its `abort` listener
  off the scope's signal when it ends.
  Before, each call left one there.

### The server side

- A run that is not the transport's own makes
  no logger: a run hook reads `op` first.
- The protocol reads `log` only when it logs
  a fault.

### Core and React

- Trace ids come from a table. A traced request
  on Node: 22,489 to 17,975 instructions.
- React holds the scope and the namespace in
  one context. One update: 147.1k to 142.3k
  instructions.

### Upgrade

- Change the three URLs.
- No code changes.

## 0.17.7

Two client sets reach one memory server again.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.7
bun add $R/tinker-core-0.17.7.tgz \
  $R/tinker-react-0.17.7.tgz \
  $R/tinker-bun-0.17.7.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.7/tinker-core-0.17.7.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.7/tinker-react-0.17.7.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.7/tinker-bun-0.17.7.tgz

### Memory

- A memory client reaches the memory server in
  its peer, whichever `createMemory()` made it,
  as two sockets reach one URL.
- 0.17.6 needed a server for each pair: a second
  client set (a signed one) on the default server
  gave `failed`, "memory: no server here".
- A peer with no memory server is `link` with
  `sent: false`.

### Upgrade

- Change the three URLs.
- A second `pair.server(...)` added only for
  0.17.6 can go.

## 0.17.6

Clear exits at the transport SPI (ADR 0141): a
backend ends with a value, and a throw is a bug.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.6
bun add $R/tinker-core-0.17.6.tgz \
  $R/tinker-react-0.17.6.tgz \
  $R/tinker-bun-0.17.6.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.6/tinker-core-0.17.6.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.6/tinker-react-0.17.6.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.6/tinker-bun-0.17.6.tgz

### rpc and remoteData

- A backend's `send` resolves with
  `{ ok: true, text }`, `missing`, or `link` with
  `sent`. Its `open` resolves with `{ ok: true }`
  or the same exits. Neither throws.
- A throw in a backend is a bug. Core logs the
  cause with the address and gives `failed` with
  `from: "local"`. It is never `link`, so a keyed
  part waits for `invalidate`.

### Memory

- Each `createMemory()` has its own server ops. A
  second pair in one scope now reaches its own
  server. It gave `CapsuleMissing`, shown as
  `link`.
- A memory server that closes ends its open
  watches as `link`, and its close settles. It
  hung until the client closed.
- A closed peer is `link` with `sent: false`.

### Upgrade

- Change the three URLs.
- A transport of your own: `send` and `open`
  return a value, not a throw (`transport.Exit`).
- A test that read a broken setup as `link` now
  reads `failed`, from local, with the cause in
  the log.

## 0.17.5

A fault says who spoke: the server, or this side
(ADR 0141).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.5
bun add $R/tinker-core-0.17.5.tgz \
  $R/tinker-react-0.17.5.tgz \
  $R/tinker-bun-0.17.5.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.5/tinker-core-0.17.5.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.5/tinker-react-0.17.5.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.5/tinker-bun-0.17.5.tgz

### rpc and remoteData

- Each fault has `from`: `"server"` or `"local"`.
- A local fault has `sent`. It is `false` when
  nothing left, so the server ran nothing.
- An address no one serves is the new server
  fault `missing`, as HTTP 404. It was `link`.
- A keyed part on a `missing` address waits for
  `invalidate`, as for `refused`. It no longer
  asks again with back-off.

### @tinker/bun

- A 404, on the socket or on a bytes POST, is
  `missing`.
- A socket drop says `sent` per call: a message
  that never left on the socket is
  `sent: false`.

### Upgrade

- Change the three URLs.
- Code that read an unknown address as `link`
  reads `missing`.
- A server on 0.17.5 sends `missing` for an
  unknown address. Move the client and the server
  together.

## 0.17.4

A keyed part has its own state, and a fault that
is the server's answer ends the asking (ADR 0139,
decisions 1, 4 and 5).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.4
bun add $R/tinker-core-0.17.4.tgz \
  $R/tinker-react-0.17.4.tgz \
  $R/tinker-bun-0.17.4.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.4/tinker-core-0.17.4.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.4/tinker-react-0.17.4.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.4/tinker-bun-0.17.4.tgz

### remoteData

- `board.status(read)` gives a part's state:
  `pending` until its first answer, then `ready`
  or `fault`. It is `undefined` when no reader
  holds the part.
- The page tells "not read yet" from "nothing
  there": a part with no member is `ready`.
- A part that rides a ready part is `ready` at
  once.
- A `refused` or `invalid` part waits for a
  trigger. There is no ask again until an
  `invalidate` names it. Only a broken link asks
  again by itself.
- `board.part(call)` gives a guard the part of a
  keyed join or ask, typed. Any other call gives
  `undefined`.

### Upgrade

- Change the three URLs.
- Read a part's fault from `board.status(read)`.
  `board.faults` is still per key: a later good
  answer of another part clears it.
- A page's "Try again" calls `invalidate` with the
  part. A refused part no longer asks again every
  few seconds.
- `part`, `status` and `states` are now reserved:
  a board cell must not use these names.
- A guard that parsed the part by hand can use
  `board.part(call)`.

## 0.17.3

A keyed signal carries its trace, as a push does.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.3
bun add $R/tinker-core-0.17.3.tgz \
  $R/tinker-react-0.17.3.tgz \
  $R/tinker-bun-0.17.3.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.3/tinker-core-0.17.3.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.3/tinker-react-0.17.3.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.3/tinker-bun-0.17.3.tgz

### remoteData

- A keyed pass runs `remoteData.send`, a producer
  span. Each signal of the pass carries it as
  `meta.traceparent`.
- The reader's ask runs under `remoteData.receive`,
  a process span that links the send (OTel
  messaging).
- A pass from `invalidate` sends under that call:
  the send is in the writer's trace.
- A pass from a set on the cell sends in the
  request's trace, with no parent span: a write
  hook does not see its writer's span. The
  single-cell push is the same.

### Upgrade

- Change the three URLs.

## 0.17.2

A keyed board's `load` runs in a session of its
own, closed when it returns. Before, it ran on the
root: a session resource it used stayed open.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.2
bun add $R/tinker-core-0.17.2.tgz \
  $R/tinker-react-0.17.2.tgz \
  $R/tinker-bun-0.17.2.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.2/tinker-core-0.17.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.2/tinker-react-0.17.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.2/tinker-bun-0.17.2.tgz

### remoteData

- A load gets the ask's signal. Its session closes
  when it returns, as a `fill`'s tagged call does.
- A transaction that begins on first use now ends
  with the load. Found by Hedl's Checks board.
- A tab that drops the ask stops the load.

### Upgrade

- Change the three URLs.

## 0.17.1

A keyed part that a part in use holds whole opens
no stream of its own: it rides that part's stream.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.1
bun add $R/tinker-core-0.17.1.tgz \
  $R/tinker-react-0.17.1.tgz \
  $R/tinker-bun-0.17.1.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.1/tinker-core-0.17.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.1/tinker-react-0.17.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.1/tinker-bun-0.17.1.tgz

### remoteData

- A list that reads `where({})` and rows that read
  `of({ id })` share one stream. A set sends one
  signal and one ask.
- When the covering part leaves, a rider rides
  another cover, or opens its own stream.

### Upgrade

- Change the three URLs.

## 0.17.0

Keyed data: `data` has a mode, and a keyed cell
holds members under keys (ADR 0135 to 0138).
`remoteData` serves a keyed cell part by part.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.0
bun add $R/tinker-core-0.17.0.tgz \
  $R/tinker-react-0.17.0.tgz \
  $R/tinker-bun-0.17.0.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.17.0/tinker-core-0.17.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.0/tinker-react-0.17.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.17.0/tinker-bun-0.17.0.tgz

### Core

- `data({ mode: "keyed", key, parse })` makes a
  keyed cell. `key` reads the key from a member.
- Its controller: `set(member)`, `update(key, fn)`,
  `delete(key)`, and the reads `of(key)` and
  `where(part)`.
- `cell.of(key)` and `cell.where(part)` name a read.
  `scope.resolve(read)` gives its reader.
- A write wakes the readers of its member and of its
  parts, and no other.
- New errors: `MissingMember`, `KeyChanged`,
  `InvalidKey`.

### remoteData

- A keyed cell on a board is served by part. The
  first reader of a part asks for it. The last
  reader leaves it.
- The guard (`onStart`) runs at each ask.
- `board.invalidate` marks parts dirty, on the
  server and on the client.
- `board({ serve: true, load })` reads parts from a
  store. The server then keeps no member.
- A keyed cell takes no `config`. `invalidate` is a
  reserved key.
- Guide: `docs/keyed-projector.md`.

### React

- `useData(cell.where(part))` and
  `useData(cell.of(key))` read one part or member.

### Upgrade

- Change the three URLs.
- Nothing else: every old call keeps its type.
- A board cell named `invalidate` must take
  another name.

## 0.16.2

A stop during start ends the start, so `serve`
never listens after a stop (ADR 0134).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.16.2
bun add $R/tinker-core-0.16.2.tgz \
  $R/tinker-react-0.16.2.tgz \
  $R/tinker-bun-0.16.2.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.16.2/tinker-core-0.16.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.2/tinker-react-0.16.2.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.2/tinker-bun-0.16.2.tgz

### Core

- After a stop, a start hook's `next()` rejects.
  A stop is a close, a stop signal, or a start
  timeout. So no hook does its after-work.
- Before, a `close()` during start ran the close
  hooks first. Then `serve` still listened, and
  nothing closed the port.
- A stop signal during start ends the start once
  the running hooks return. `ready` rejects with
  the signal's reason; `closed` is `cancelled`.
- A signal that aborted before start: no start
  hook runs.

### Upgrade

- Change the three URLs.
- Remove a gate capsule that checks the stop
  signal after `serve`'s `next()`.
- A test that waits for `ready` after a stop
  during start: `ready` now rejects with the
  stop's reason.

## 0.16.1

A stopped stream no longer leaks, and no longer
fails its root's close (ADR 0133). No API change.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.16.1
bun add $R/tinker-core-0.16.1.tgz \
  $R/tinker-react-0.16.1.tgz \
  $R/tinker-bun-0.16.1.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.16.1/tinker-core-0.16.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.1/tinker-react-0.16.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.1/tinker-bun-0.16.1.tgz

### Core

- A call given a `signal` that rejects with that
  signal's reason is cancelled for its caller.
  Before, the caller's root kept the reason as a
  panic: its `close()` said `failed`.
- This hit every rpc stream a reader left, and
  every session that opened a keyed `remoteData`
  project. Each kept about 4,000 B on the tab.
- rpc and keyed `remoteData` no longer call
  `AbortSignal.any` over a long-lived signal.
  Node 22 kept about 180 B per call.
- `bench/heap-stop.mjs` holds the budget:
  64 B kept per stop; now 5 to 7 B.

### Upgrade

- Change the three URLs. No code change.
- A `try/catch` around a subflow you stop by its
  own `signal` now leaves the session clean.

## 0.16.0

`serve` is a capsule; `run` is the host
(ADR 0132). `testCapsule` is gone (ADR 0131).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.16.0
bun add $R/tinker-core-0.16.0.tgz \
  $R/tinker-react-0.16.0.tgz \
  $R/tinker-bun-0.16.0.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.16.0/tinker-core-0.16.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.0/tinker-react-0.16.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.16.0/tinker-bun-0.16.0.tgz

### Breaking

- `@tinker/bun`: `serve(main, pages)` is gone.
  - Put `serve({ port, pages, websocket,
handlers })` first in `capsules`.
  - Call `run(main)` in the host file.
  - `main` answers its root: `createScope(...)`.
  - A handler's start returns `{ fetch,
websocket? }`; `ws.server` does.
- `@tinker/core/testing`: `testCapsule` is gone.
  Test tooling is a plain capsule in a
  `*.testing.ts` file.

## 0.15.0

rpc and remoteData are Core primitives
(ADR 0130). Units take tags (ADR 0129).
A new package: `@tinker/bun`.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.15.0
bun add $R/tinker-core-0.15.0.tgz \
  $R/tinker-react-0.15.0.tgz \
  $R/tinker-bun-0.15.0.tgz
```

The three URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.15.0/tinker-core-0.15.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.15.0/tinker-react-0.15.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.15.0/tinker-bun-0.15.0.tgz

### rpc in Core

- `rpc`, `channel`, `bytes`, `remoteData`
  and `transport` are in `@tinker/core`.
- `memory` is in `@tinker/core/testing`.
- An app without rpc bundles no rpc code.
- A watch its link drops fails as `link`,
  as a call does (it threw a plain error).
- Contracts take any Standard Schema.

### Moving an app

- `~/components/rpc`, `remote-data`:
  import from `@tinker/core`.
- `~/components/protocol`: read it from
  `transport`.
- `~/components/memory`: import from
  `@tinker/core/testing`.
- `~/components/ws`: the server from
  `@tinker/bun`, the client from
  `@tinker/bun/client`.
- `~/base/bun-host`: `serve` from
  `@tinker/bun`.
- `~/components/bun-sql`, `bun-sqlite`:
  `@tinker/bun/sql`, `@tinker/bun/sqlite`.
- A bytes field marks your own field:
  `bytes(z.custom<RpcBody>(), { max })`.
- A bad rpc output raises `SchemaRejected`,
  not a `ZodError`.

### Unit tags

- `operation`, `resource` and `data` take
  `tags: [...]`.
- The handle keeps them. The non-secret
  ones go on the unit's span.
- An inline op has `tags` undefined. So a
  handle no longer passes as an inline op:
  a wrong input now shows as a type error.

## 0.14.1

Faster handles. No API change.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.1
bun add $R/tinker-core-0.14.1.tgz \
  $R/tinker-react-0.14.1.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.1
npm install $R/tinker-core-0.14.1.tgz \
  $R/tinker-react-0.14.1.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.14.1/tinker-core-0.14.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.14.1/tinker-react-0.14.1.tgz

### Core

- Handles are classes, not `Object.create`
  over a handle just made. V8 can now share
  one shape between them.
- A session under a root with `session` hooks
  takes 56% fewer instructions than in 0.12.
- A session made on the starting handle:
  51% fewer than in 0.12.
- Root start: 32% fewer than in 0.12.
- A sync `run` does not change.
- Notes: `research/learnings/2026-11-09-handle-shapes.md`.

### Upgrade

- Change the two URLs. No code change.
- Do not take a verb off a handle
  (`const { run } = scope`). ADR 0108 forbids it,
  and it no longer works on the starting handle.

## 0.14.0

A root with capsules has a starting type
(ADR 0128). Breaking.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.0
bun add $R/tinker-core-0.14.0.tgz \
  $R/tinker-react-0.14.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.0
npm install $R/tinker-core-0.14.0.tgz \
  $R/tinker-react-0.14.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.14.0/tinker-core-0.14.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.14.0/tinker-react-0.14.0.tgz

### Starting handle

- `createScope({ capsules })` returns a
  `Scope.Starting`. Its `run`, `settle`,
  `session` and `controller(op).run` always
  return a promise.
- `await scope.ready` gives the started
  `Scope.Handle`. Its sync calls stay sync.
- `createSession()` on it gives a starting
  session; its `ready` gives the started
  session.
- `isStarting(scope)` tells the two apart.
- A root with no `capsules` does not change.
- `capsules` that may be unset (a variable)
  types as either. Narrow it with
  `isStarting`.

### React

- `ScopeProvider` takes a starting root. It
  waits for `ready`: a `<Suspense>` above shows
  its fallback; a failed start reaches the
  error boundary.
- In `create` form it renders nothing until
  start ends, and does not suspend.

### Upgrade

- Await each call on a capsule root, or take
  `const live = await scope.ready` first.
- Pass the started handle to code that wants
  a `Scope.Handle`, and to `renderToString`.
- Make `no-floating-promises` an error: it
  finds each call that is not awaited.

## 0.13.0

A call waits for start, and a capsule's author
ships test tooling as a test capsule
(ADR 0127).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.13.0
bun add $R/tinker-core-0.13.0.tgz \
  $R/tinker-react-0.13.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.13.0
npm install $R/tinker-core-0.13.0.tgz \
  $R/tinker-react-0.13.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.13.0/tinker-core-0.13.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.13.0/tinker-react-0.13.0.tgz

### A call waits for start

- While a root starts, `run`, `settle`,
  `session` and `controller(op).run` wait for
  every start, then run.
- So do sessions made during start.
- After a failed start or a close, a waiting
  call meets the closed scope: `run` raises
  `Disposed`; `settle` returns its result.
- `await using scope = createScope(...)`
  closes the scope at the end of the block.

### Test capsule

- `testCapsule(of, def)` from
  `@tinker/core/testing`: a capsule only tests
  install, labelled `<of>.testing`.
- Its ops reach `of` through `of`'s exports.
- A prod file does not import it, so the
  bundler leaves it out.

### Upgrade

- A run before `ready` no longer raises
  `NotResolved`; it waits. A test that checked
  that error now gets the value.
- A sync op's `run` returns a promise while
  the root starts. `await` it there.
- `await scope.ready` before a call still
  works; it is no longer needed.

## 0.12.0

A capsule exports a foreign value as is
(ADR 0125). An edge picks the layer a write
lands on (ADR 0126).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.12.0
bun add $R/tinker-core-0.12.0.tgz \
  $R/tinker-react-0.12.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.12.0
npm install $R/tinker-core-0.12.0.tgz \
  $R/tinker-react-0.12.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.12.0/tinker-core-0.12.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.12.0/tinker-react-0.12.0.tgz

### Foreign exports

- A value in `exports` that is not a unit,
  such as a React component, is exported as
  is: `talk.Panel`.
- The capsule is then a module to use
  anywhere.

### Placed edges

- `cell.atScope.controller`: a write lands at
  the root, outside any namespace.
- `cell.atNamespace.controller`: a write lands
  at the root, in the caller's namespace.
- `cell.controller` does not change: the
  caller's own layer.
- They work from a session, a tagged call and
  a call with a `signal`.
- A read view (a capsule's cell export) has
  neither.
- `tinker/cell-write` also flags both on
  another capsule's raw cell.

### Upgrade

- Nothing breaks. The 0.11.0 way to write the
  root, a `scope`-target resource that takes
  the controller, still works.

## 0.11.0

A capsule's cell export is read-only
(ADR 0123).

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.11.0
bun add $R/tinker-core-0.11.0.tgz \
  $R/tinker-react-0.11.0.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.11.0
npm install $R/tinker-core-0.11.0.tgz \
  $R/tinker-react-0.11.0.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.11.0/tinker-core-0.11.0.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.11.0/tinker-react-0.11.0.tgz

### Read views

- A cell in `exports` is now a read view on the
  handle: `talk.point`.
- It has no `controller` and no path to the
  cell.
- `depends: { p: talk.point }` hands a reader:
  `get()` and `watch()`.
- `scope.resolve(talk.point)` and a hook's
  `load(talk.point, meta)` answer the reader.
- `useData(talk.point)` reads it in React.
- To change the cell from outside, call an op
  the capsule exports.
- The raw cell, imported from its own file,
  keeps full power.

### Upgrade

- `talk.point.controller` is now a type error.
  Use the raw cell inside the capsule, or an
  op the capsule exports.
- `mail.outbox === outbox` is false for a cell
  export. Ops and resources keep the same
  object.
- New lint `tinker/cell-write` (warn): a
  `.controller` on another capsule's cell.

## 0.10.1

The first release under tag `v0.10.1`.
It has Core and React only.

### Install

On Bun:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.10.1
bun add $R/tinker-core-0.10.1.tgz \
  $R/tinker-react-0.10.1.tgz
```

On Node, with npm:

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.10.1
npm install $R/tinker-core-0.10.1.tgz \
  $R/tinker-react-0.10.1.tgz
```

The two URLs:

- https://github.com/lagz0ne/tinkered/releases/download/v0.10.1/tinker-core-0.10.1.tgz
- https://github.com/lagz0ne/tinkered/releases/download/v0.10.1/tinker-react-0.10.1.tgz

The React tarball names Core by its URL.

### Bun is the main runtime

- Core and React declare
  `"engines": { "bun": ">=1.4" }`, next
  to Node `>=22.18.0`.
- CI has a `bun` job on Bun 1.4. It runs the
  Core and React tests on Bun. Then it loads
  the built Core and React on Bun: a scope
  starts, reads a cell, and closes.
- Node 22 is still tested, in the `gates`
  job.

### Start is sunset

Start is gone from this repo (ADR 0122).

- Removed: `packages/start`,
  `apps/start-min`, `apps/start-scaffold`,
  and the `tinker` CLI.
- The removed code stays in tag
  `start-archive`.
- Old `start-v*` releases stay up. Their
  tarball URLs still download.
- Asset names are the same. Only the tag
  name changed: `start-vX.Y.Z` is now
  `vX.Y.Z`.
- To move up from 0.10.0: replace the two
  `start-v0.10.0` URLs with the two above.

### A hook opens a session

Core, ADR 0121 section 14.

Every hook event now has
`session(options, meta)`:

- It opens a child session of the hook's
  owner, as `createSession` does. The owner
  is the root in `start` and `close`, and the
  hook's session in the others.
- It takes the hook's `ns` and trace, unless
  `options` names its own. In a `run` hook,
  the session's spans sit under the run's
  span.
- The caller closes it. The owner's close
  closes it too. The hook's `signal` does
  not.
- Every `session` hook runs on it. A
  `session` hook that calls `session()` must
  guard itself, or it opens sessions without
  end.
- Once the root closes, it raises `Disposed`.
  In a `close` hook, that holds before
  `next()` too.
- `scope.capsules` gets one line per capsule:
  unit `<label>:session`, with `role`,
  `explain`, and `opened`. The type is
  `Capsule.Opened`. The first call writes the
  line, even when that call fails. `opened`
  counts the sessions that opened.

### A defaulted config key may be left out

Core, ADR 0121 section 15. No code changed;
tests now pin this rule.

- A config key whose tag has a default may
  be left out of the capsule call. The hook
  and every unit read the default.
- A key whose tag has no default must be
  named.

### React

No code change. React moves to 0.10.1 with
Core.
