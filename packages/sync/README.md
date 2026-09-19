# @tinker/sync

A cell is the shared unit; the source holds the truth; the transport is userland's (ADR 0048, one way).
Both drivers are core extensions (ADR 0050): the composition root installs them, `ready` waits for the
initial data set, and `resolve` delivers each value.

```text
shared:  const counter = data({ label: "counter", initial: 0, parse, meta: [synced({ key: "counter" })] })
         const todo = family({ label: "todo", initial: "", parse })          todo("7") → a cell
source:  const src = source(); createScope({ tags: [sync(counter), sync(todo)], extensions: [src] })
viewer:  const sub = subscribe(transport); createScope({ tags: [sync(counter)], extensions: [sub] })
wire:    register ↑ · snapshot ↓         (userland: memoryPair | SSE+POST | WebSocket)
```

Declare the shared cells once; bind them on both scopes with `sync`. The
source owns the truth, the viewer mirrors what it registered, and the wire
between them is yours: `memoryPair` in tests, SSE + POST or a WebSocket in
the browser.

## Shared

`synced({ key })` in a cell's `meta` is the publish mark; `readSynced(cell)`
reads it back, throwing `SyncUndeclared` on a plain cell. `family({ label,
initial, parse })` builds a cell per id: `todo("7")` is an ordinary cell
carrying the key `todo/7`. `sync(cell | family)` on the scope publishes the
unit — registration is by identity: only the members the viewer holds go
down, never the whole family.

## Source

`source()` is the source extension: install it with
`createScope({ tags: [...], extensions: [src] })`, then read it back with
`scope.resolve(src)` once `await scope.ready`. It holds the truth: one
session per subscriber. `connect(transport)` listens: nothing is pushed
unasked. Each `register { keys }` runs `sync register` inline in that
session (span, one `sync register` log line with the key count): a
registered key answers at once with its snapshot (current version and
value), and a changed cell fans out only to the live transports registered
for that key. A member the source does not hold yet is created there with
its initial value. A key that is not published, a message in the wrong
direction, or an unexpected throw inside the op closes the transport, no
reply. The promise settles when the transport closes. The source start is
sync, so the origin is ready at once; the source close hook closes every
live transport first (their sessions resolve), then the scope closes.

## Subscribe

`subscribe(transport)` is the viewer extension: install it with
`createScope({ tags: [...], extensions: [sub] })`, then
`await scope.ready` — ready means the viewer holds its initial data set:
the start sends one `register { keys }` with every bound singleton key and
every family member it already holds, and waits until every key of that
registration holds its snapshot (a viewer binding nothing is ready at
once). `scope.resolve(sub)` delivers `{ close }`. A member created later
(through `onMember`) registers at once; late members are not part of
readiness. Each `snapshot` goes into its cell through the cell's `parse` —
an unregistered key that is `label/id` of a published family calls
`family(id)` first, so the member exists before the value lands. Nothing
goes up in v1: a userland write on a viewer cell stays local until the
next snapshot overwrites it.

Anything the viewer cannot place means the two sides disagree on the
module: a snapshot that fails the parse or names no published key, or any
non-snapshot message. Each is a protocol violation, so the viewer detaches
and closes the transport. When the initial set breaks — the transport
closes or a violation lands before every key arrived, or a forced scope
close aborts the wait — the start rejects with `SyncNotReady`
`{ label: "subscribe", missing }` naming the keys still missing: `ready`
rejects and the scope closes failed. `close()` detaches and closes the
transport (idempotent); a close from the far side detaches without closing
twice.

## Wire it

The transport is four methods: `send`, `onMessage`, `onClose`, `close`.
A transport may call its `onClose` listeners synchronously inside `close()`. Driver listeners
must not throw to report a startup failure: build the error value and reject the pending
startup promise through its saved reject function. Attach a rejection handler when that
promise is created, even if startup will await it later. Keep close paths safe to call again.

Three ways to build one:

Hono SSE + POST uses one `GET /sync?client=<id>` stream down and one
`POST /sync?client=<id>` carrying registration up. The
[issue tracker server](../../apps/issue-tracker/src/server/app.ts) and
[browser connection](../../apps/issue-tracker/src/client/sync.ts) show the complete owned transport.

The server sends a ready comment before the browser posts registration. Each side queues its
async sends in order and closes the transport when a send fails. Closing notifies the driver
once and cancels pending browser requests. Install stream error handling before awaiting
`scope.ready`, so losing the first snapshot rejects startup instead of leaving the screen loading.
The stream callback returns the `source.connect(transport)` promise; it settles when the wire
closes. Forced root shutdown closes the source connections and their stream sessions.

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
const sub = subscribe(transport);
const guest = createScope({ tags: [sync(counter)], extensions: [sub] });
await guest.ready;
```

React needs nothing new: where `subscribe` runs, `useData(counter)` keeps
reading the same cell the snapshots land in; a local write on a viewer cell
stays local until the next snapshot overwrites it.

```ts
export declare namespace Sync {
  export type Meta = { readonly key: string };
  export type Message =
    | { readonly type: "register"; readonly keys: readonly string[] }
    | {
        readonly type: "snapshot";
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
  /** The source extension: one session per subscriber; the scope's cells are
   * the truth. */
  export type Source = { connect(transport: Transport): Promise<void> };
  /** The client extension's handle: detach the listeners and close the
   * transport. */
  export type Subscription = { close(): void };
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
export function source(): Scope.Extension<Sync.Source>;
export function subscribe(transport: Sync.Transport): Scope.Extension<Sync.Subscription>;
export { isError };
export type { Errors }; // SyncUndeclared, SyncConflict, SyncNotReady
```
