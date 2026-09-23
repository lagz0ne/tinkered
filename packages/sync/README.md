# @tinker/sync

A cell is the shared unit; the source holds the truth; the transport is userland's (ADR 0048, one way).
Both drivers are core extensions (ADR 0050): the composition root installs them, `ready` waits for the
initial data set, and `resolve` delivers each value.

```ts
const counter = data({ label: "counter", initial: 0, parse });
const todo = family({ label: "todo", initial: "", parse });
const src = source({
  cells: [
    [counter, "counter"],
    [todo, "todo"],
  ],
});
const sub = subscribe(transport, { cells: [[todo, "todo"]] });
const origin = createScope({ extensions: [src] });
const guest = createScope({ extensions: [sub] });
const seven = todo("7"); // a namespace, not a cell
origin.controller(todo.cell, { ns: seven }).set("buy milk");
```

Declare the shared cells once; hand each end its rows. A row is the cell
(or family) beside its key: `[counter, "counter"]`, `[todo, "todo"]`. The
source owns the truth, the viewer mirrors what it registered, and the wire
between them is yours: `memoryPair` in tests, SSE + POST or a WebSocket in
the browser. Drivers read no meta (ADR 0051 §3).

## Shared

`family({ label, initial, parse, eq })` declares one cell, `todo.cell`.
`todo("7")` returns a namespace, memoized by id. Read or write a member with
`scope.resolve(todo.cell, { ns: todo("7") })` or
`scope.controller(todo.cell, { ns: todo("7") }).set(value)`.
The cell's `initial`, `parse`, and `eq` apply in every namespace.
Two members hold independent values, including over the wire.
`members()` lists ids in creation order; `onMember` fires once per new id.
A family row publishes its members under `${label}/${id}` of the row's
label — registration is by identity: only the members the viewer holds go
down, never the whole family. The label is a wire-key prefix, not a storage key.

## Source

`source({ cells })` is the source extension: install it with
`createScope({ extensions: [src] })`, then read it back with
`scope.resolve(src)` once `await scope.ready`. It holds the truth: one
session per subscriber. `connect(transport)` listens: nothing is pushed
unasked. Each `register { keys }` runs `sync register` inline in that
session (span, one `sync keys` line with the key count).
A registration logs its key count on `sync keys`; its observed `sync register` step
carries elapsed `ms` and outcome.
A registered key answers at once with its snapshot (current version and
value), and a changed cell fans out only to the live transports registered
for that key. A member the source does not hold yet gets a namespace there;
its cell reads its initial value. A key that is not published, a message in the wrong
direction, or an unexpected throw inside the op closes the transport, no
reply. The promise resolves with the session's close `Result` when the
transport parts (`success`), or `cancelled` when a forced root close fells
the session first — it never rejects (ADR 0027). The source start is sync,
so the origin is ready at once; the source close hook closes every live
transport first (their sessions resolve), then the scope closes.

## Subscribe

`subscribe(transport, { cells })` is the viewer extension: install it with
`createScope({ extensions: [sub] })`, then
`await scope.ready` — ready means the viewer holds its initial data set:
the start sends one `register { keys }` with every row's singleton key and
every family member it already holds, and waits until every key of that
registration holds its snapshot (a viewer wiring nothing is ready at
once). `scope.resolve(sub)` delivers `{ close }`. A member created later
(through `onMember`) registers at once; late members are not part of
readiness. Each `snapshot` goes into the cell through its `parse` —
an unregistered key that is `label/id` of a published family calls
`family(id)` first, then writes `family.cell` in that namespace. Nothing
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
transport (safe to repeat); a close from the far side detaches without closing
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
[browser connection](../../apps/issue-tracker/src/client/connection.ts) show the complete owned transport.

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
const sub = subscribe(transport, { cells: [[counter, "counter"]] });
const guest = createScope({ extensions: [sub] });
await guest.ready;
```

React needs nothing new: where `subscribe` runs, `useData(counter)` keeps
reading the same cell the snapshots land in; a local write on a viewer cell
stays local until the next snapshot overwrites it.

```ts
export declare namespace Sync {
  export type Row =
    | readonly [cell: Data.Cell<unknown>, key: string]
    | readonly [family: Family<unknown>, label: string];
  export type Wiring = { readonly cells: readonly Row[] };
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
    (id: string): Namespace;
    readonly cell: Data.Cell<T>;
    readonly label: string;
    members(): readonly string[];
    onMember(listener: (id: string) => void): () => void;
  };
  export type Published = Data.Cell<unknown> | Family<unknown>;
  /** The source extension: one session per subscriber; the scope's cells are
   * the truth. */
  export type Source = { connect(transport: Transport): Promise<Scope.Result> };
  /** The client extension's handle: detach the listeners and close the
   * transport. */
  export type Subscription = { close(): void };
}
export function family<T>(config: {
  label: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Sync.Family<T>;
export function isFamily(unit: Sync.Published): unit is Sync.Family<unknown>;
export function memoryPair(): readonly [Sync.Transport, Sync.Transport];
export function source(wiring: Sync.Wiring): Scope.Extension<Sync.Source>;
export function subscribe(
  transport: Sync.Transport,
  wiring: Sync.Wiring,
): Scope.Extension<Sync.Subscription>;
export { isError };
export type { Errors }; // SyncConflict, SyncNotReady
```
