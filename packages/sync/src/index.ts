import type { Data, Scope, Tag } from "@tinker/core";
import { data, isError as isCoreError, tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** A cell is the shared unit; the source holds the truth; the transport is
 * userland's (ADR 0048, one way). This package holds the `synced` meta, the
 * `family` member factory, the `sync` binding tag, the message protocol with
 * its `Transport` and the in-memory pair, plus the source driver and the
 * subscribe driver. */
export declare namespace Sync {
  /** The static facts a cell carries to declare itself synced. */
  export type Meta = { readonly key: string };
  /** The wire protocol, one way: the viewer registers the keys it shows and
   * the source answers each key with a snapshot, then fans out later writes
   * on registered keys only. */
  export type Message =
    | { readonly type: "register"; readonly keys: readonly string[] }
    | {
        readonly type: "snapshot";
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
  /** The source extension: one session per subscriber; the scope's cells are
   * the truth. */
  export type Source = { connect(transport: Transport): Promise<void> };
  /** The client extension's handle: detach the listeners and close the
   * transport. */
  export type Subscription = { close(): void };
}

/** The meta tag a cell carries to declare itself synced:
 * `meta: [synced({ key: "counter" })]`. Read with `readSynced`. */
export const synced: Tag.Handle<Sync.Meta> = tag({ label: "sync.synced" });

/** The binding tag: `sync(cell | family)` on the scope; the drivers read
 * `scope.resolve(sync.all)`. A family registers by identity: only the
 * members the viewer holds go down. */
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

/** The source driver: one session per subscriber; the scope's cells are
 * the truth (ADR 0048, one way). The transport carries a key set: each
 * `register` runs one inline operation `sync register` that answers the
 * keys with their snapshots, and a changed cell fans out only to the live
 * transports registered for that key. An unpublished key, a message in the
 * wrong direction, or an unexpected throw inside the op is a protocol
 * violation: the transport closes with no reply. Reads go through the scope
 * handle the driver holds, since a session shadows its own writes. */
export function source(scope: Scope.Handle): Sync.Source {
  type Entry = { cell: Data.Cell<unknown>; version: number };
  const live = new Map<Sync.Transport, Set<string>>();
  function snapshot(key: string, entry: Entry): Sync.Message {
    return {
      type: "snapshot",
      key,
      version: entry.version,
      value: scope.controller(entry.cell).get(),
    };
  }
  function fanout(key: string, entry: Entry): void {
    const out = snapshot(key, entry);
    for (const [transport, keys] of live) {
      if (keys.has(key)) transport.send(out);
    }
  }
  const published = readPublished(scope, (key, cell) => {
    const entry: Entry = { cell, version: 0 };
    scope.controller(cell).watch(() => {
      entry.version += 1;
      fanout(key, entry);
    });
    return entry;
  });
  function connect(transport: Sync.Transport): Promise<void> {
    return scope.session((session) => {
      const keys = new Set<string>();
      live.set(transport, keys);
      const stopMessages = transport.onMessage((message) => {
        if (message.type !== "register") {
          transport.close();
          return;
        }
        const wanted = message.keys;
        try {
          session.run({
            label: "sync register",
            run: (_deps, ctx) => {
              const begin = ctx.clock.currentTimeMillis();
              for (const key of wanted) {
                const entry = published.entryFor(key);
                if (entry === undefined) {
                  transport.close();
                  return;
                }
                keys.add(key);
                transport.send(snapshot(key, entry));
              }
              ctx.log("sync register", {
                count: wanted.length,
                ms: ctx.clock.currentTimeMillis() - begin,
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

/** The client driver: registers the keys the viewer shows, then fills each
 * snapshot into its cell through the cell's parse (ADR 0048, one way).
 * Nothing goes up in v1: a userland write on a client cell stays local
 * until the next snapshot overwrites it. A snapshot for an unpublished key,
 * one the parse refuses, or any non-snapshot message is a protocol
 * violation: the client detaches and closes the transport.
 * `close()` detaches and closes (idempotent); a far-side close detaches
 * without closing twice. */
export function subscribe(scope: Scope.Handle, transport: Sync.Transport): Sync.Subscription {
  let shut = false;
  let stopMessages: () => void = () => undefined;
  let stopParted: () => void = () => undefined;
  const published = readPublished(scope, (_key, cell) => ({ cell }));
  function stop(): void {
    if (shut) return;
    shut = true;
    stopMessages();
    stopArrivals();
    published.stop();
    stopParted();
  }
  function violate(): void {
    stop();
    transport.close();
  }
  function fill(key: string, value: unknown): void {
    const entry = published.entryFor(key);
    if (entry === undefined) {
      violate();
      return;
    }
    try {
      scope.controller(entry.cell).set(value);
    } catch (error: unknown) {
      if (!isCoreError(error, "DataValidationFailed")) throw error;
      violate();
    }
  }
  function joined(key: string): void {
    if (shut) return;
    transport.send({ type: "register", keys: [key] });
  }
  stopMessages = transport.onMessage((message) => {
    if (shut) return;
    if (message.type !== "snapshot") {
      violate();
      return;
    }
    fill(message.key, message.value);
  });
  stopParted = transport.onClose(() => {
    stop();
  });
  const first: string[] = [];
  for (const key of published.entries.keys()) first.push(key);
  transport.send({ type: "register", keys: first });
  const stops: Array<() => void> = [];
  for (const unit of scope.resolve(sync.all)) {
    if (isFamily(unit)) {
      const label = unit.label;
      stops.push(
        unit.onMember((id) => {
          joined(`${label}/${id}`);
        }),
      );
    }
  }
  function stopArrivals(): void {
    for (const release of stops) release();
  }
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
