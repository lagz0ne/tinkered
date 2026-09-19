# @tinker/sync

A cell is the shared unit; the server is the truth; the transport is userland's (ADR 0048).

```text
shared:  const counter = data({ label: "counter", initial: 0, parse, meta: [synced({ key: "counter" })] })
         const todo = family({ label: "todo", initial: "", parse })          todo("7") → a cell
server:  createScope({ tags: [sync(counter), sync(todo)] }); syncServer(scope).connect(transport)
client:  createScope({ tags: [sync(counter), sync(todo)] }); syncClient(scope, transport)
wire:    snapshot ↓ · set ↑ · ack/reject ↓         (userland: memoryPair | SSE+POST | WebSocket)
```

Declare the shared cells once; bind them on both scopes with `sync`. The
server owns the truth, the client mirrors it, and the wire between them is
yours: `memoryPair` in tests, SSE + POST or a WebSocket in the browser.

## Shared

`synced({ key })` in a cell's `meta` is the publish mark; `readSynced(cell)`
reads it back, throwing `SyncUndeclared` on a plain cell. `family({ label,
initial, parse })` builds a cell per id: `todo("7")` is an ordinary cell
carrying the key `todo/7`. `sync(cell | family)` on the scope publishes the
unit — a family goes whole, members now and on arrival.

## Server

`syncServer(scope)` is the truth: one session per connected transport.
`connect(transport)` sends one `snapshot` per published key (a family sends
every member now, later members through `onMember`), then listens. The
promise settles when the transport closes.

Each `set` runs `sync set <key>` inline in that session: parse first, then
last-writer-wins by version — `base === version` applies (the version moves
in the broadcast watcher, so a userland write fans out the same way),
`ack`s, and fans the snapshot out; a stale base or a parse failure
`reject`s with the current truth. A `set` for `label/id` of a published
family creates it. Any other key, a non-`set` message, or an unexpected
throw inside the write closes the transport, no log, no reply.

## Client

`syncClient(scope, transport)` drives the other end: one registry built from
`scope.resolve(sync.all)` (a cell per key, plus `onMember` for members that
arrive later), one watcher per cell, one `nextId` counter per client, and
the last version the server sent per key (starting at 0).

Each `snapshot` goes into its cell through the cell's `parse` — an
unregistered key that is `label/id` of a published family calls
`family(id)` first, so the member exists before the value lands. `ack`
moves the version forward. A local write goes up at once `set { id, key,
base: version, value }`: the cell already holds it (optimistic), and a
value the parse refuses never leaves — core throws `DataValidationFailed`
to the writer. A `reject` reverts the cell to the server's value exactly
like a snapshot, under the same guard, so the revert is never re-sent.

Anything the client cannot place means the two sides disagree on the
module: an `ack` or `reject` for an unknown key, a `reject` the cell's
parse refuses, a snapshot that fails the parse or names no published key,
or a `set` arriving at the client. Each is a protocol violation, so the
client detaches and closes the transport. `client.close()` unwatches every
key and closes the transport (idempotent); a close from the far side
unwatches without closing twice.

## Wire it

The transport is four methods: `send`, `onMessage`, `onClose`, `close`.
Three ways to build one:

Hono SSE + POST (the full recipe lives in `examples/hono.ts`): one
`GET /sync?client=<id>` stream down, one `POST /sync?client=<id>` per
client write up, routed by client id.

```ts
const transport: Sync.Transport = {
  send: (message) => {
    if (open) void emit(`data: ${JSON.stringify(message)}\n\n`);
  },
  onMessage: (listener) => {
    arrivals.add(listener);
    return () => {
      arrivals.delete(listener);
    };
  },
  onClose: (listener) => {
    partings.add(listener);
    return () => {
      partings.delete(listener);
    };
  },
  close: () => {
    if (open === false) return;
    open = false;
    for (const part of partings) part();
  },
};
syncServer(scope).connect(transport);
```

WebSocket (one socket per tab, same four methods):

```ts
const transport: Sync.Transport = {
  send: (m) => ws.send(JSON.stringify(m)),
  onMessage: (listener) => {
    ws.onmessage = (event) => listener(JSON.parse(event.data));
    return () => (ws.onmessage = null);
  },
  onClose: (listener) => {
    ws.onclose = () => listener();
    return () => (ws.onclose = null);
  },
  close: () => ws.close(),
};
syncClient(scope, transport);
```

React needs nothing new: where `syncClient` runs, `useData(counter)` keeps
reading the same cell the snapshots land in; a `set` from a component is a
local write like any other, optimistic, revertible.

```ts
export declare namespace Sync {
  export type Meta = { readonly key: string };
  export type Message =
    | {
        readonly type: "snapshot";
        readonly key: string;
        readonly version: number;
        readonly value: unknown;
      }
    | {
        readonly type: "set";
        readonly id: number;
        readonly key: string;
        readonly base: number;
        readonly value: unknown;
      }
    | { readonly type: "ack"; readonly id: number; readonly key: string; readonly version: number }
    | {
        readonly type: "reject";
        readonly id: number;
        readonly key: string;
        readonly version: number;
        readonly value: unknown;
      };
  export type Transport = {
    send(message: Message): void;
    onMessage(listener: (message: Message) => void): () => void;
    onClose(listener: () => void): () => void;
    close(): void;
  };
  export type Family<T> = {
    (id: string): Data.Cell<T>;
    readonly label: string;
    members(): readonly string[];
    onMember(listener: (id: string) => void): () => void;
  };
  export type Published = Data.Cell<unknown> | Family<unknown>;
  /** The server driver: one session per connected transport; the scope's cells
   * are the truth. */
  export type Server = { connect(transport: Transport): Promise<void> };
  /** The client driver's handle: detach the watchers and close the transport. */
  export type Client = { close(): void };
}
export const synced: Tag.Handle<Sync.Meta>;
export const sync: Tag.Handle<Sync.Published>;
export function family<T>(config: {
  label: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Sync.Family<T>;
export function readSynced(cell: Data.Cell<unknown>): Sync.Meta;
export function isFamily(unit: Sync.Published): unit is Sync.Family<unknown>;
export function memoryPair(): readonly [Sync.Transport, Sync.Transport];
export function syncServer(scope: Scope.Handle): Sync.Server;
export function syncClient(scope: Scope.Handle, transport: Sync.Transport): Sync.Client;
export { isError };
export type { Errors }; // SyncUndeclared: { label: string }
```
