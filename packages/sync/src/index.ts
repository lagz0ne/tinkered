import type { Data, Tag } from "@tinker/core";
import { data, tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** A cell is the shared unit; the server is the truth; the transport is
 * userland's (ADR 0048). This package is the shared half: the `synced` meta,
 * the `family` member factory, the `sync` binding tag, the message protocol
 * with its `Transport`, and the in-memory pair. No drivers yet. */
export declare namespace Sync {
  /** The static facts a cell carries to declare itself synced. */
  export type Meta = { readonly key: string };
  /** The wire protocol: the server is the truth; a write carries the version
   * it saw, and the server answers each write with an `ack` or a `reject`
   * carrying the current truth. */
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
  /** Userland's wire (SSE+POST, WebSocket, postMessage): send, listen, learn
   * of the close, close. */
  export type Transport = {
    send(message: Message): void;
    onMessage(listener: (message: Message) => void): () => void;
    onClose(listener: () => void): () => void;
    close(): void;
  };
  /** A cell with an id: a memoized member factory plus the ids created so far
   * in this process. */
  export type Family<T> = {
    (id: string): Data.Cell<T>;
    readonly label: string;
    members(): readonly string[];
  };
  /** One published unit on the scope. */
  export type Published = Data.Cell<unknown> | Family<unknown>;
}

/** The meta tag a cell carries to declare itself synced:
 * `meta: [synced({ key: "counter" })]`. Read with `readSynced`. */
export const synced: Tag.Handle<Sync.Meta> = tag({ label: "sync.synced" });

/** The binding tag: `sync(cell | family)` on the scope; the drivers read
 * `scope.resolve(sync.all)`. A family is published whole. */
export const sync: Tag.Handle<Sync.Published> = tag({ label: "sync.published" });

/** A cell with an id: members memoized per id in this process, each an
 * ordinary cell carrying `synced` meta under `<label>/<id>`; `members()`
 * lists the ids in creation order. */
export function family<T>(config: {
  label: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Sync.Family<T> {
  const found = new Map<string, Data.Cell<T>>();
  function member(id: string): Data.Cell<T> {
    const hit = found.get(id);
    if (hit !== undefined) return hit;
    const cell = data({
      label: `${config.label}/${id}`,
      initial: config.initial,
      parse: config.parse,
      eq: config.eq,
      meta: [synced({ key: `${config.label}/${id}` })],
    });
    found.set(id, cell);
    return cell;
  }
  function members(): string[] {
    return [...found.keys()];
  }
  return Object.assign(member, { label: config.label, members });
}

/** Read the synced facts off one cell: a member's key. A cell without
 * `synced` meta cannot be published, so this throws `SyncUndeclared` with the
 * cell's label. */
export function readSynced(cell: Data.Cell<unknown>): Sync.Meta {
  const found = synced.read(cell);
  if (!found.present) raise("SyncUndeclared", { label: cell.label });
  return found.value;
}

/** A family is a function; a cell is an object: the smallest stable shape
 * that tells one published unit from the other. */
export function isFamily(unit: Sync.Published): unit is Sync.Family<unknown> {
  return typeof unit === "function";
}

/** Queue one message for every listener on the other side, in send order. */
function deliver(target: Set<(message: Sync.Message) => void>, message: Sync.Message): void {
  queueMicrotask(() => {
    for (const listener of target) listener(message);
  });
}

/** Listen until the returned function is called. */
function listen<T>(target: Set<T>, listener: T): () => void {
  target.add(listener);
  function unlisten(): void {
    target.delete(listener);
  }
  return unlisten;
}

/** Two linked transports: a send on one reaches every listener on the other
 * in order on a microtask, never synchronously; a close on either fires the
 * close listeners on both once, drops later sends silently, and makes a later
 * close a no-op. */
export function memoryPair(): readonly [Sync.Transport, Sync.Transport] {
  const leftMessages = new Set<(message: Sync.Message) => void>();
  const rightMessages = new Set<(message: Sync.Message) => void>();
  const leftCloses = new Set<() => void>();
  const rightCloses = new Set<() => void>();
  let closed = false;
  function sendLeft(message: Sync.Message): void {
    if (closed) return;
    deliver(rightMessages, message);
  }
  function sendRight(message: Sync.Message): void {
    if (closed) return;
    deliver(leftMessages, message);
  }
  function close(): void {
    if (closed) return;
    closed = true;
    for (const listener of leftCloses) listener();
    for (const listener of rightCloses) listener();
  }
  const left: Sync.Transport = {
    send: sendLeft,
    onMessage: (listener) => listen(leftMessages, listener),
    onClose: (listener) => listen(leftCloses, listener),
    close,
  };
  const right: Sync.Transport = {
    send: sendRight,
    onMessage: (listener) => listen(rightMessages, listener),
    onClose: (listener) => listen(rightCloses, listener),
    close,
  };
  return [left, right];
}
