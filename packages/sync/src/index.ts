import type { Data, Scope, Tag } from "@tinker/core";
import { data, isError as isCoreError, tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** A cell is the shared unit; the server is the truth; the transport is
 * userland's (ADR 0048). This package holds the `synced` meta, the `family`
 * member factory, the `sync` binding tag, the message protocol with its
 * `Transport` and the in-memory pair, plus the server driver. */
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
    onMember(listener: (id: string) => void): () => void;
  };
  /** One published unit on the scope. */
  export type Published = Data.Cell<unknown> | Family<unknown>;
  /** The server driver: one session per connected transport; the scope's cells
   * are the truth. */
  export type Server = { connect(transport: Transport): Promise<void> };
  /** The client driver's handle: detach the watchers and close the transport. */
  export type Client = { close(): void };
}

/** The meta tag a cell carries to declare itself synced:
 * `meta: [synced({ key: "counter" })]`. Read with `readSynced`. */
export const synced: Tag.Handle<Sync.Meta> = tag({ label: "sync.synced" });

/** The binding tag: `sync(cell | family)` on the scope; the drivers read
 * `scope.resolve(sync.all)`. A family is published whole. */
export const sync: Tag.Handle<Sync.Published> = tag({ label: "sync.published" });

/** A cell with an id: members memoized per id in this process, each an
 * ordinary cell carrying `synced` meta under `<label>/<id>`; `members()`
 * lists the ids in creation order; `onMember` fires once per new member,
 * after it is created. */
export function family<T>(config: {
  label: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Sync.Family<T> {
  const found = new Map<string, Data.Cell<T>>();
  const arrivals = new Set<(id: string) => void>();
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
    for (const arrival of arrivals) arrival(id);
    return cell;
  }
  function members(): string[] {
    return [...found.keys()];
  }
  function onMember(listener: (id: string) => void): () => void {
    arrivals.add(listener);
    function unlisten(): void {
      arrivals.delete(listener);
    }
    return unlisten;
  }
  return Object.assign(member, { label: config.label, members, onMember });
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

/** The published set of one scope as a key registry: singletons now,
 * family members now and on arrival, and a lookup that creates a member for
 * a `label/id` key of a published family. `make` builds one entry per key;
 * a second cell under a known key raises `SyncConflict`. */
function readPublished<E extends { cell: Data.Cell<unknown> }>(
  scope: Scope.Handle,
  make: (key: string, cell: Data.Cell<unknown>) => E,
): { entries: Map<string, E>; entryFor(key: string): E | undefined; stop(): void } {
  type Gate = { make: (id: string) => Data.Cell<unknown>; label: string };
  const entries = new Map<string, E>();
  const gates: Gate[] = [];
  function register(key: string, cell: Data.Cell<unknown>): E {
    const known = entries.get(key);
    if (known !== undefined) {
      if (known.cell === cell) return known;
      raise("SyncConflict", { key });
    }
    const entry = make(key, cell);
    entries.set(key, entry);
    return entry;
  }
  function memberFor(key: string): Data.Cell<unknown> | undefined {
    const slash = key.indexOf("/");
    if (slash < 1 || slash + 1 >= key.length) return undefined;
    const head = key.slice(0, slash);
    const rest = key.slice(slash + 1);
    for (const gate of gates) {
      if (gate.label === head) return gate.make(rest);
    }
    return undefined;
  }
  function entryFor(key: string): E | undefined {
    const known = entries.get(key);
    if (known !== undefined) return known;
    const cell = memberFor(key);
    if (cell === undefined) return undefined;
    return register(key, cell);
  }
  const arrivals: Array<() => void> = [];
  for (const unit of scope.resolve(sync.all)) {
    if (isFamily(unit)) {
      const label = unit.label;
      const makeMember = (id: string): Data.Cell<unknown> => unit(id);
      gates.push({ make: makeMember, label });
      for (const id of unit.members()) register(`${label}/${id}`, makeMember(id));
      arrivals.push(
        unit.onMember((id) => {
          register(`${label}/${id}`, makeMember(id));
        }),
      );
    } else {
      register(readSynced(unit).key, unit);
    }
  }
  function stop(): void {
    for (const release of arrivals) release();
  }
  return { entries, entryFor, stop };
}

/** The server driver: one session per connected transport; the scope's
 * cells are the truth (ADR 0048). Snapshots go down to every connected
 * transport; a `set` runs one inline operation `sync set <key>` (parse,
 * then last-writer-wins by version): `base === version` applies (the version
 * moves in the broadcast watcher, so a userland write fans out the same
 * way), `ack`s, and fans out; a stale base or a parse failure `reject`s with
 * the current truth. An unknown key or a non-`set` message is a protocol
 * violation: the transport closes with no log and no reply. Reads and
 * writes go through the scope handle the driver holds, since a session
 * shadows its own writes and the broadcast watcher would never fire. */
export function syncServer(scope: Scope.Handle): Sync.Server {
  type Entry = { cell: Data.Cell<unknown>; version: number };
  const live = new Set<Sync.Transport>();
  function snapshot(key: string, entry: Entry): Sync.Message {
    return {
      type: "snapshot",
      key,
      version: entry.version,
      value: scope.controller(entry.cell).get(),
    };
  }
  function broadcast(key: string, entry: Entry): void {
    const out = snapshot(key, entry);
    for (const transport of live) transport.send(out);
  }
  const published = readPublished(scope, (key, cell) => {
    const entry: Entry = { cell, version: 0 };
    scope.controller(cell).watch(() => {
      entry.version += 1;
      broadcast(key, entry);
    });
    return entry;
  });
  const registry = published.entries;
  function connect(transport: Sync.Transport): Promise<void> {
    return scope.session((session) => {
      live.add(transport);
      for (const [key, entry] of registry) transport.send(snapshot(key, entry));
      const stopMessages = transport.onMessage((message) => {
        if (message.type !== "set") {
          transport.close();
          return;
        }
        const entry = published.entryFor(message.key);
        if (entry === undefined) {
          transport.close();
          return;
        }
        const cell = entry.cell;
        const request = message;
        try {
          session.run({
            label: `sync set ${request.key}`,
            run: (_deps, ctx) => {
              const truth = scope.controller(cell);
              const begin = ctx.clock.currentTimeMillis();
              if (request.base !== entry.version) {
                ctx.log("sync set", {
                  key: request.key,
                  code: "stale",
                  ms: ctx.clock.currentTimeMillis() - begin,
                });
                transport.send({
                  type: "reject",
                  id: request.id,
                  key: request.key,
                  version: entry.version,
                  value: truth.get(),
                });
                return;
              }
              try {
                truth.set(request.value);
              } catch (error: unknown) {
                if (!isCoreError(error, "DataValidationFailed")) throw error;
                ctx.log("sync set", {
                  key: request.key,
                  code: "invalid",
                  ms: ctx.clock.currentTimeMillis() - begin,
                });
                transport.send({
                  type: "reject",
                  id: request.id,
                  key: request.key,
                  version: entry.version,
                  value: truth.get(),
                });
                return;
              }
              ctx.log("sync set", {
                key: request.key,
                code: "applied",
                ms: ctx.clock.currentTimeMillis() - begin,
              });
              transport.send({
                type: "ack",
                id: request.id,
                key: request.key,
                version: entry.version,
              });
            },
          });
        } catch {
          transport.close();
        }
      });
      const parted = new Promise<void>((resolve) => {
        transport.onClose(() => {
          resolve();
        });
      });
      return parted.then(() => {
        stopMessages();
        live.delete(transport);
      });
    });
  }
  return { connect };
}

/** The client driver: snapshots go into the cells through their parse
 * (family members are created on arrival), local writes go up at once with
 * the last seen version (optimistic: the cell already holds the write), and
 * a `reject` reverts the cell to the server's value (ADR 0048). A snapshot
 * that fails the cell's parse — or one for a key that is neither registered
 * nor a published family's member — means the two sides disagree on the
 * module: a protocol violation, so the client detaches and closes the
 * transport. Reads and writes go through the scope handle the driver holds:
 * it runs no session, so no shadow copy stands between it and the cells. */
export function syncClient(scope: Scope.Handle, transport: Sync.Transport): Sync.Client {
  type Entry = { cell: Data.Cell<unknown>; release: () => void; version: number };
  let applying = false;
  let shut = false;
  let nextId = 0;
  let stopMessages: () => void = () => undefined;
  let stopParted: () => void = () => undefined;
  const published = readPublished(scope, (key, cell) => {
    const truth = scope.controller(cell);
    const entry: Entry = { cell, release: () => undefined, version: 0 };
    entry.release = truth.watch((next) => {
      if (applying) return;
      nextId += 1;
      transport.send({ type: "set", id: nextId, key, base: entry.version, value: next });
    });
    return entry;
  });
  const registry = published.entries;
  function fill(entry: Entry, value: unknown, version: number): void {
    const truth = scope.controller(entry.cell);
    applying = true;
    try {
      truth.set(value);
    } finally {
      applying = false;
    }
    entry.version = version;
  }
  function stop(): void {
    if (shut) return;
    shut = true;
    stopMessages();
    published.stop();
    stopParted();
    for (const entry of registry.values()) entry.release();
  }
  function violate(): void {
    stop();
    transport.close();
  }
  function snapshot(key: string, version: number, value: unknown): void {
    const entry = published.entryFor(key);
    if (entry === undefined) {
      violate();
      return;
    }
    try {
      fill(entry, value, version);
    } catch (error: unknown) {
      if (!isCoreError(error, "DataValidationFailed")) throw error;
      violate();
    }
  }
  function ack(key: string, version: number): void {
    const entry = registry.get(key);
    if (entry === undefined) {
      violate();
      return;
    }
    entry.version = version;
  }
  function rejected(key: string, version: number, value: unknown): void {
    const entry = registry.get(key);
    if (entry === undefined) {
      violate();
      return;
    }
    try {
      fill(entry, value, version);
    } catch (error: unknown) {
      if (!isCoreError(error, "DataValidationFailed")) throw error;
      violate();
    }
  }
  stopMessages = transport.onMessage((message) => {
    if (shut) return;
    if (message.type === "snapshot") {
      snapshot(message.key, message.version, message.value);
      return;
    }
    if (message.type === "ack") {
      ack(message.key, message.version);
      return;
    }
    if (message.type === "reject") {
      rejected(message.key, message.version, message.value);
      return;
    }
    violate();
  });
  stopParted = transport.onClose(() => {
    stop();
  });
  function close(): void {
    stop();
    transport.close();
  }
  return { close };
}
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
