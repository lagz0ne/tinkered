import type { Data, Many, Namespace, Scope } from "@tinker/core";
import { data, extension, isError as isCoreError, namespace, readMany } from "@tinker/core";
import { fail, isError, raise, type Errors } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** A cell is the shared unit; the source holds the truth; the transport is
 * userland's (ADR 0048, one way). This package holds the `family` member
 * factory, the message protocol with its `Transport` and the in-memory pair,
 * plus the source driver and the subscribe driver. Both drivers read the flat
 * wiring rows handed to their constructors, never scope tags or meta
 * (ADR 0051 §3: drivers read no meta). */
export declare namespace Sync {
  /** One published unit: a cell under its key, or a family under its label.
   * A family row publishes its members under `${label}/${id}`, the row's
   * label — not the family's own. */
  export type Row =
    | readonly [cell: Data.Cell<unknown>, key: string]
    | readonly [family: Family<unknown>, label: string];
  /** The table a driver extension receives: every unit it publishes, as a {@link Many} of rows. */
  export type Wiring = { readonly cells: Many<Row> };
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
  /** One declared cell, with a memoized namespace for each member id. */
  export type Family<T> = {
    (id: string): Namespace;
    readonly cell: Data.Cell<T>;
    readonly label: string;
    members(): readonly string[];
    onMember(listener: (id: string) => void): () => void;
  };
  /** One published unit on the scope. */
  export type Published = Data.Cell<unknown> | Family<unknown>;
  /** The source extension: one session per subscriber; the scope's cells are
   * the truth. `connect` resolves with the session's close `Result` — success
   * once the transport parts, cancelled when a forced root close fells it —
   * never rejects (ADR 0027). */
  export type Source = { connect(transport: Transport): Promise<Scope.Result> };
  /** The client extension's handle: detach the listeners and close the
   * transport. */
  export type Subscription = { close(): void };
}

/** One cell declared at construction, with one memoized namespace per id.
 * `members()` lists ids in creation order; `onMember` fires once per new id,
 * after its namespace exists. The publish key comes from the wiring row. */
export function family<T>(config: {
  label: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Sync.Family<T> {
  const cell = data({
    label: config.label,
    initial: config.initial,
    parse: config.parse,
    eq: config.eq,
  });
  const found = new Map<string, Namespace>();
  const arrivals = new Set<(id: string) => void>();
  function member(id: string): Namespace {
    const hit = found.get(id);
    if (hit !== undefined) return hit;
    const ns = namespace();
    found.set(id, ns);
    for (const arrival of arrivals) arrival(id);
    return ns;
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
  return Object.assign(member, { cell, label: config.label, members, onMember });
}

/** A row is a pair whose second half is its key or label: the smallest stable shape that
 * tells one row from a nested list of rows when `cells` is read. */
function isRow(value: Sync.Row | readonly Many<Sync.Row>[]): value is Sync.Row {
  const [, name] = value;
  return typeof name === "string";
}

/** A family is a function; a cell is an object: the smallest stable shape
 * that tells one published unit from the other. */
export function isFamily(unit: Sync.Published): unit is Sync.Family<unknown> {
  return typeof unit === "function";
}

/** The published set of one wiring by key: singletons now, family members
 * now and on arrival, and a lookup that creates a member for a `label/id`
 * key of a published family. `make` builds one entry per key; a different
 * cell or namespace under a known key raises `SyncConflict`. */
function readPublished<E extends { cell: Data.Cell<unknown>; ns?: Namespace }>(
  cells: readonly Sync.Row[],
  make: (key: string, cell: Data.Cell<unknown>, ns?: Namespace) => E,
): { entries: Map<string, E>; entryFor(key: string): E | undefined; stop(): void } {
  type Gate = { make: (id: string) => Namespace; cell: Data.Cell<unknown>; label: string };
  const entries = new Map<string, E>();
  const gates: Gate[] = [];
  function register(key: string, cell: Data.Cell<unknown>, ns?: Namespace): E {
    const known = entries.get(key);
    if (known !== undefined) {
      if (known.cell === cell && known.ns === ns) return known;
      raise("SyncConflict", { key });
    }
    const entry = make(key, cell, ns);
    entries.set(key, entry);
    return entry;
  }
  function memberFor(key: string): { cell: Data.Cell<unknown>; ns: Namespace } | undefined {
    const slash = key.indexOf("/");
    if (slash < 1 || slash + 1 >= key.length) return undefined;
    const head = key.slice(0, slash);
    const rest = key.slice(slash + 1);
    for (const gate of gates) {
      if (gate.label === head) return { cell: gate.cell, ns: gate.make(rest) };
    }
    return undefined;
  }
  function entryFor(key: string): E | undefined {
    const known = entries.get(key);
    if (known !== undefined) return known;
    const member = memberFor(key);
    if (member === undefined) return undefined;
    return register(key, member.cell, member.ns);
  }
  const arrivals: Array<() => void> = [];
  for (const [unit, name] of cells) {
    if (isFamily(unit)) {
      const label = name;
      gates.push({ make: unit, cell: unit.cell, label });
      for (const id of unit.members()) register(`${label}/${id}`, unit.cell, unit(id));
      arrivals.push(
        unit.onMember((id) => {
          register(`${label}/${id}`, unit.cell, unit(id));
        }),
      );
    } else {
      register(name, unit);
    }
  }
  function stop(): void {
    for (const release of arrivals) release();
  }
  return { entries, entryFor, stop };
}

function memberController(
  scope: Scope.Handle,
  cell: Data.Cell<unknown>,
  ns?: Namespace,
): Scope.DataController<unknown> {
  return scope.controller(cell, ns === undefined ? undefined : { ns });
}

/** The source driver, an extension: `start` builds the registry and
 * watchers from the wiring rows, `close` drops every live transport (their
 * sessions resolve), and `connect` listens from then on (ADR 0050). The
 * scope's cells are the truth (ADR 0048, one way). The transport carries a
 * key set: each `register` runs one inline operation `sync register` that
 * answers the keys with their snapshots, and a changed cell fans out only
 * to the live transports registered for that key. An unpublished key, a
 * message in the wrong direction, or an unexpected throw inside the op is
 * a protocol violation: the transport closes with no reply. Reads go
 * through the scope handle the driver holds, since a session shadows its
 * own writes. Each `connect` opens its own session with `createSession`
 * and returns that session's close `Result`, never a rejection: a parted
 * transport closes its session graceful (`success`) — a viewer leaving, a
 * violation, or a graceful shutdown parts the wire cleanly — while a
 * forced root close fells the session first (`forcedClosing`, set in the
 * close hook before the structural close aborts the subtree), so the
 * forced session close resolves `cancelled`. */
export function source(wiring: Sync.Wiring): Scope.Extension<Sync.Source> {
  const cells = readMany(wiring.cells, isRow);
  let closeSource: () => void = () => undefined;
  let forcedClosing = false;
  return extension<Sync.Source>({
    label: "sync.source",
    start: async (scope, _ctx, next) => {
      type Entry = { cell: Data.Cell<unknown>; ns?: Namespace; version: number };
      const live = new Map<Sync.Transport, Set<string>>();
      closeSource = () => {
        for (const transport of live.keys()) transport.close();
        live.clear();
      };
      function snapshot(key: string, entry: Entry): Sync.Message {
        return {
          type: "snapshot",
          key,
          version: entry.version,
          value: memberController(scope, entry.cell, entry.ns).get(),
        };
      }
      function fanout(key: string, entry: Entry): void {
        const out = snapshot(key, entry);
        for (const [transport, keys] of live) {
          if (keys.has(key)) transport.send(out);
        }
      }
      const published = readPublished(cells, (key, cell, ns) => {
        const entry: Entry = { cell, ns, version: 0 };
        memberController(scope, cell, ns).watch(() => {
          entry.version += 1;
          fanout(key, entry);
        });
        return entry;
      });
      function connect(transport: Sync.Transport): Promise<Scope.Result> {
        const session = scope.createSession();
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
                for (const key of wanted) {
                  const entry = published.entryFor(key);
                  if (entry === undefined) {
                    transport.close();
                    return;
                  }
                  keys.add(key);
                  transport.send(snapshot(key, entry));
                }
                ctx.log("sync keys", { count: wanted.length });
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
          if (forcedClosing) return session.close();
          return session.close({ graceful: true });
        });
      }
      await next();
      return { connect };
    },
    close: (options, next) => {
      forcedClosing = options.graceful !== true;
      closeSource();
      return next();
    },
  });
}

/** The client driver, an extension: `start` registers the keys the
 * viewer shows and waits until every key of that initial registration
 * holds its snapshot (`ready` is the initial data set, ADR 0050), then
 * `close` detaches and closes the transport. Later snapshots fill each
 * cell through the cell's parse (ADR 0048, one way). Nothing goes up in
 * v1: a userland write on a client cell stays local until the next
 * snapshot overwrites it. A snapshot for an unpublished key, one the
 * parse refuses, or any non-snapshot message is a protocol violation: the
 * client detaches and closes the transport. Before the initial set
 * arrives a close or a violation rejects `start` with `SyncNotReady` (the
 * keys still missing), so `ready` rejects and the scope closes failed.
 * `close()` detaches and closes (idempotent); a far-side close detaches
 * without closing twice. */
export function subscribe(
  transport: Sync.Transport,
  wiring: Sync.Wiring,
): Scope.Extension<Sync.Subscription> {
  const cells = readMany(wiring.cells, isRow);
  let closeClient: () => void = () => undefined;
  return extension<Sync.Subscription>({
    label: "sync.subscribe",
    start: (scope, ctx, next) => {
      let shut = false;
      let stopMessages: () => void = () => undefined;
      let stopParted: () => void = () => undefined;
      const published = readPublished(cells, (_key, cell, ns) => ({ cell, ns }));
      const stops: Array<() => void> = [];
      const first: string[] = [];
      for (const key of published.entries.keys()) first.push(key);
      const missing = new Set<string>(first);
      let waiters: { settle: () => void; fail: () => void } | undefined;
      function stop(): void {
        if (shut) return;
        shut = true;
        stopMessages();
        for (const release of stops) release();
        published.stop();
        stopParted();
      }
      function broken(): Errors.Of<"SyncNotReady"> {
        return fail("SyncNotReady", { label: "subscribe", missing: [...missing] });
      }
      function failStart(): void {
        if (waiters === undefined) return;
        const waiting = waiters;
        waiters = undefined;
        stop();
        transport.close();
        waiting.fail();
      }
      function violate(): void {
        if (waiters === undefined) {
          stop();
          transport.close();
          return;
        }
        failStart();
      }
      function fill(key: string, value: unknown): void {
        const entry = published.entryFor(key);
        if (entry === undefined) {
          violate();
          return;
        }
        try {
          memberController(scope, entry.cell, entry.ns).set(value);
        } catch (error: unknown) {
          if (!isCoreError(error, "DataValidationFailed")) throw error;
          violate();
          return;
        }
        if (missing.delete(key) && missing.size === 0 && waiters !== undefined) {
          const waiting = waiters;
          waiters = undefined;
          waiting.settle();
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
        if (waiters === undefined) {
          stop();
          return;
        }
        failStart();
      });
      closeClient = () => {
        stop();
        transport.close();
      };
      transport.send({ type: "register", keys: first });
      for (const [unit, name] of cells) {
        if (isFamily(unit)) {
          const label = name;
          stops.push(
            unit.onMember((id) => {
              joined(`${label}/${id}`);
            }),
          );
        }
      }
      function noteRejection(promise: Promise<unknown>): void {
        promise.then(undefined, () => undefined);
      }
      const waited = new Promise<void>((resolve, reject) => {
        if (missing.size === 0) {
          resolve();
          return;
        }
        waiters = {
          settle: resolve,
          fail: () => {
            try {
              reject(broken());
            } catch {
              return;
            }
          },
        };
      });
      noteRejection(waited);
      ctx.signal.addEventListener(
        "abort",
        () => {
          if (waiters !== undefined) failStart();
        },
        { once: true },
      );
      const settled = waited.then(async () => {
        await next();
        function close(): void {
          stop();
          transport.close();
        }
        return { close };
      });
      noteRejection(settled);
      return settled;
    },
    close: (_options, next) => {
      closeClient();
      return next();
    },
  });
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
