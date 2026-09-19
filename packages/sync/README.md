# @tinker/sync

A cell is the shared unit; the server is the truth; the transport is userland's (ADR 0048).

```text
shared:  const counter = data({ label: "counter", initial: 0, parse, meta: [synced({ key: "counter" })] })
         const todo = family({ label: "todo", initial: "", parse })          todo("7") → a cell
server:  createScope({ tags: [sync(counter), sync(todo)] }); syncServer(scope).connect(transport)
client:  createScope({ tags: [sync(counter), sync(todo)] }); syncClient(scope, transport)
wire:    snapshot ↓ · set ↑ · ack/reject ↓         (userland: memoryPair | SSE+POST | WebSocket)
```

t01 ships the shared half only; the drivers (`syncServer`, `syncClient`) land in t02/t03.

## Client (t03)

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

A snapshot that fails the cell's parse — or one for a key that is neither
registered nor a published family's member — means the two sides disagree
on the module: a protocol violation, so the client detaches and closes the
transport. `client.close()` unwatches every key and closes the transport
(idempotent); a close from the far side unwatches without closing twice.

React needs nothing new: where `syncClient` runs, `useData(counter)` keeps
reading the same cell the snapshots land in; a `set` from a component is a
local write like any other, optimistic, revertible.

## Server (t02)

`syncServer(scope)` is the truth: one session per connected transport.
`connect(transport)` sends one `snapshot` per published key (a family goes
whole: every member now, later members through `onMember`), then listens.
Each `set` runs `sync set <key>` inline in that session: parse first, then
last-writer-wins by version — `base === version` applies (the version moves
in the broadcast watcher, so a userland write fans out the same way), `ack`s,
and fans the snapshot out; a stale base or a parse failure `reject`s with the
current truth. A `set` for `label/id` of a published family creates it. Any
other key, a non-`set` message, or an unexpected throw inside the write
closes the transport, no log, no reply.

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
