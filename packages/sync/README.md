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
  };
  export type Published = Data.Cell<unknown> | Family<unknown>;
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
export { isError };
export type { Errors }; // SyncUndeclared: { label: string }
```
