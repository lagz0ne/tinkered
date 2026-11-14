import { raise } from "./errors";
import { capsule, data, operation, parse, resource, tag } from "./index";
import type { Capsule, Data, Observe, Operation, Scope, Tag } from "./index";
import { channel, rpc } from "./rpc";
import type { RpcFault } from "./rpc";
import * as z from "./rpc-shape";
import { hook, protocol } from "./rpc-transport";
import type { Answer, Call, Hooks, Stream, Watch } from "./rpc-transport";

// remoteData rides on rpc: each key is an rpc stream key at the same address. Its stream sends
// the value now, then each write. rpc owns the serving, the faults, the codec use and the hooks;
// remoteData owns the cells: who watches which key, what a write pushes, and the client's copy.

type Cells = Readonly<Record<string, Data.Cell<any>>>;

type Read = { readonly call: Call; readonly watch: Watch };

/** The job, picked by the config: serve the cells here, or fill them from a backend. */
type Job<D = Cells> =
  | { readonly serve: true; readonly fill?: Fill; readonly load?: Loads<D>; readonly read?: never }
  | { readonly read: Read; readonly serve?: never };

/** The lifecycle hooks go to the wire: rpc runs them, on each side, per key. */
type Config<D = Cells> = Job<D> & Hooks;

/**
 * A keyed key's load: an op that gives the members of a part from a store (ADR 0137, 0138). Its
 * input says which fields a part must have. With a load, the server keeps no member.
 */
type Loads<D> = {
  readonly [K in keyof D as D[K] extends Data.Keyed<any, any> ? K : never]?: Operation.Handle<
    D[K] extends Data.Cell<infer L> ? L | PromiseLike<L> : never,
    any
  >;
};

type Load = Readonly<Record<string, Operation.Handle<unknown, any> | undefined>>;

/**
 * A keyed definition's first value for one parameter, per key: an op the server runs in a call
 * tagged with the parameter, when a client asks for a parameter no write has given yet. With no
 * fill, the key's initial value goes out.
 */
type Fill = Readonly<Record<string, Operation.Handle<unknown, void>>>;

/** What a keyed key's stream takes and its signal names, and what its ask takes (ADR 0137):
 * one member (`of` a key) or one part (`where` a part). */
type Ask = {
  readonly read: "of" | "where";
  readonly part: Data.Key;
  readonly window?: Exclude<Data.Key, string>;
};

/** The calls remoteData makes on a keyed cell's root controller, past its public type. */
type Keyed = Scope.KeyedController<unknown, Data.Key> & {
  listen(
    listener: (read: "of" | "where", part: Data.Key, window?: Ask["window"]) => () => void,
  ): void;
  answer(
    read: "of" | "where",
    part: Data.Key,
    members: readonly unknown[],
    keep: (key: Data.Key) => boolean,
    window?: Ask["window"],
  ): void;
  adopt(value: readonly unknown[]): Data.Key | undefined;
  step(value: readonly unknown[]): Data.Key | undefined;
};

/**
 * A client's part in use, by key: its readers, and the stop of its stream. A part that another
 * part in use holds whole rides that part's stream: `rides` names it, and it has no stream.
 */
type Joined = {
  refs: number;
  readonly ask: Ask;
  readonly stop: AbortController;
  rides?: Joined;
  /** Set while the part waits on a fault that is an answer: a trigger calls it (ADR 0139 4). */
  wake?: () => void;
};

/** A client's ask in flight, and the asks that started after it and share members with it. */
type Asking = {
  readonly ask: Ask;
  readonly later: Asking[];
  /** Set when a server signal asked for it: the meta the signal came with. */
  readonly signalled?: { readonly meta?: Record<string, string> };
  done?: Promise<void>;
};

/** What a server reader has to ask after one pass: one member, or its whole part. */
type Pass = { readonly at: string; readonly dirty: Map<string, Ask> };

/** `invalidate`'s input: a part (or a key) for each keyed key named. */
type Dirty<D> = {
  readonly [
    K in keyof D as D[K] extends Data.Keyed<any, any> ? K : never
  ]?: D[K] extends Data.Keyed<any, infer Key> ? (Key extends string ? Key : Data.Part<Key>) : never;
};

/** One rpc contract, as the wire is built: each key here is a stream or a reply. */
type Contract = {
  readonly mode: "stream" | "reply";
  readonly input: Data.Schema<unknown>;
  readonly output: Data.Schema<unknown>;
};

/** A key or a part as text: fields sorted, then JSON, as Core names a member. */
const textOf = (part: Data.Key): string =>
  typeof part === "string"
    ? JSON.stringify(part)
    : JSON.stringify(
        Object.keys(part)
          .sort()
          .map((field) => [field, part[field]]),
      );

/** The slot of one part: the key, then `o` or `w` and the part's text. */
const partSlot = (key: string, ask: Ask): string =>
  `${key}\u0000${ask.read === "of" ? "o" : "w"}${textOf(ask.part)}${ask.window ? textOf(ask.window) : ""}`;

/** Whether a member's key is in an asked part. */
const holds = (ask: Ask, key: Data.Key): boolean =>
  ask.read === "of"
    ? textOf(ask.part) === textOf(key)
    : Object.keys(ask.part).every((f) => Object(key)[f] === Object(ask.part)[f]);

/** Whether a value is a key or a part: a string, or a flat object of strings and finite
 * numbers. */
const isKey = (part: unknown): part is Data.Key =>
  typeof part === "string" ||
  (typeof part === "object" &&
    part !== null &&
    !Array.isArray(part) &&
    Object.values(part).every(
      (v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)),
    ));

/** An ask from the wire: `of` or `where`, and a key or a part. */
const askShape = z.make<Ask>((value) => {
  const { read, part, window } = Object(value) as Partial<Record<keyof Ask, unknown>>;
  if (
    (read !== "of" && read !== "where") ||
    !isKey(part) ||
    (window != null && (typeof window !== "object" || !isKey(window)))
  ) {
    return z.fail("expected an ask");
  }
  return { value: { read, part, window } as Ask };
});

/**
 * The share of a reader's part that a dirty part names: the reader's part with the dirty
 * part's fields added. Undefined when the two share no member.
 */
const narrowed = (reader: Ask, dirty: Data.Key): Ask | undefined => {
  const was = reader.part;
  if (typeof dirty === "string" || typeof was === "string") {
    return textOf(was) === textOf(dirty) ? reader : undefined;
  }
  const part = { ...was, ...dirty };

  if (textOf(part) === textOf(was)) return reader;
  if (reader.read === "of" || Object.keys(was).some((f) => was[f] !== part[f])) {
    return undefined;
  }
  // A window asks again whole: only the store knows which members are in it (ADR 0139 2).
  return reader.window ? reader : { read: "where", part };
};

/** Whether two asks can share members in the cell. A window shares only with itself: only the
 * store knows which members are in it (ADR 0139 2). */
const shares = (a: Ask, b: Ask): boolean =>
  a.window || b.window ? partSlot("", a) === partSlot("", b) : !!narrowed(a, b.part);

/** The key function of a keyed cell: it reads a member's key. */
const memberKey = (cell: Data.Cell<unknown>) =>
  (Object(cell).keyed as { key: (member: unknown) => Data.Key }).key;

/** The slots of the readers that hold one member: the member's own, and each part of its key
 * (2^d parts for d fields). */
const slotsOf = (key: string, member: Data.Key): string[] => {
  const slots = [partSlot(key, { read: "of", part: member })];
  if (typeof member === "string") return slots;

  const flat = member;
  const fields = Object.keys(flat);
  for (let mask = 0; mask < 1 << fields.length; mask++) {
    const part = Object.fromEntries(
      fields.filter((_, i) => mask & (1 << i)).map((f) => [f, flat[f]]),
    );
    slots.push(partSlot(key, { read: "where", part }));
  }
  return slots;
};

/** A fault of a definition: rpc's own, branded by the definition's wire. */
export type RemoteFault = RpcFault;

const meta = { role: "state", explain: "Remote data of this root" } as const;
const sending = { role: "handler", explain: "Sends one write to its watchers" } as const;
const reading = { role: "handler", explain: "Reads one key's stream" } as const;
const name = "remoteData"; // labels only: the wire address is the key

const reserved = "answer stream drop invalidate fault faults part status states".split(" ");

/**
 * The config of a definition, checked: no config key is a cell or reserved, no cell is
 * reserved, and a keyed cell takes no config. Returns the config, or `null` for none.
 */
const checked = (cells: Cells, config: object, keyed: ReadonlySet<string>): object | null => {
  const configKeys = Object.keys(config);
  const clash = configKeys.filter((key) => key in cells || reserved.includes(key));
  if (clash.length) {
    throw new Error(`remoteData: config ${clash.join(", ")} is a cell or reserved key`);
  }

  const taken = Object.keys(cells).filter((key) => reserved.includes(key));
  if (taken.length) throw new Error(`remoteData: ${taken.join(", ")} is a reserved key`);
  if (!configKeys.length) return null;
  if (keyed.size) throw new Error(`remoteData: a keyed cell takes no config`);
  return config;
};

/** A cell of the same shape with a new identity. A keyed cell keeps its key, parse and eq. */
const remake = (shape: Data.Cell<unknown>): Data.Cell<unknown> => {
  if (shape.mode === "single") {
    return data({ initial: shape.initial, parse: shape.parse, eq: (a, b) => shape.eq(a, b) });
  }
  const spec = Object(shape).keyed as {
    key: (member: unknown) => Data.Key;
    parse: Data.Parse<unknown> | undefined;
    eq: (a: unknown, b: unknown) => boolean;
  };
  return data({ mode: "keyed", key: spec.key, parse: spec.parse, eq: spec.eq });
};

/** The part of any keyed cell of a definition: a field that every key has reads with no cast. */
type PartIn<D> = {
  [C in keyof D]: D[C] extends Data.Keyed<any, infer K> ? Data.Part<K> : never;
}[keyof D];

/** A part's state on a client (ADR 0139 1): not read yet, read, or a fault that stands. */
export type PartState =
  | { readonly status: "pending" }
  | { readonly status: "ready" }
  | { readonly status: "fault"; readonly fault: RemoteFault };

/** A part's state as the client keeps it: under the part's slot. */
type Stated = PartState & { readonly at: string };

/** A signal as a reader takes it: the ask, and the meta it came with. */
type Taken = { readonly ask: Ask; readonly meta?: Record<string, string> };

/** One watcher: rpc's `channel.send` of one stream. */
type Push = (value: unknown, meta?: Record<string, string>) => void;

/** A keyed definition's parameter: its config values, by config key (F12). */
type Param = Readonly<Record<string, unknown>>;

/** What a serving root keeps: each cell's root controller, and who watches each slot. */
type Served = {
  roots: Map<string, Scope.DataController<unknown>>;
  copies: Map<string, Scope.DataController<unknown>>;
  /** By slot: the key, or the key and its parameter. */
  watchers: Map<string, Map<Push, () => void>>;
  /** A keyed key's slots in use: the part each one reads. */
  parts: Map<string, Ask>;
  /** A keyed key's readers with a part to ask in this pass (ADR 0138 11). */
  pass: Map<Push, Pass>;
  /** The pass's send span, as each of its signals carries it (`meta.traceparent`). */
  sent?: Record<string, string>;
  /** A keyed definition: each watched slot's last value, held while a client watches it. */
  held: Map<string, unknown>;
  /** The key's fill for one parameter, run on the root; undefined when the key has none. */
  fill: (key: string, param: Param) => Promise<unknown> | undefined;
  /** Each keyed key's load, from the config. */
  loads: Load;
  /** A keyed key's load of one part, run on the root; undefined when the key has none. */
  load: (key: string, part: Data.Key, signal: AbortSignal) => Promise<unknown> | undefined;
};

/** A reading root's values for one parameter, shared by every session that names it. */
type Entry = {
  refs: number;
  values: Map<string, unknown>;
  faults: Faults;
  listeners: Set<() => void>;
  stop: AbortController;
};

type Faults = Readonly<Record<string, RemoteFault>>;

/** A throw as a fault: a fault as it is; anything else is a bug, logged, `failed` here (ADR 0141). */
const faultOf = (def: Def, key: string, error: unknown, log: Observe.Logger) => {
  if (def.wire.fault.is(error)) return error;

  log.error("remoteData bug", { address: key, cause: String(error) });
  return def.wire.fault.make(key, "failed", { side: "client" });
};

type Wire = {
  readonly receive: unknown;
  readonly fault: {
    is(error: unknown): error is RpcFault;
    make(address: string, kind: RpcFault["fault"], payload: unknown, traceId?: string): RpcFault;
  };
} & Readonly<Record<string, unknown>>;

/** One definition, as the steps read it. */
type Def = {
  readonly cells: Cells;
  readonly made: Cells;
  readonly keys: readonly string[];
  readonly wire: Wire;
  readonly state: Data.Cell<Served | null>;
  readonly faults: Data.Cell<Faults>;
  /** On a reading root: each keyed part in use, and its state (ADR 0139 1). */
  readonly states: Data.Keyed<Stated, { at: string }>;
  /** A keyed definition's config (F12): the app's own tags; null when not keyed. */
  readonly by: Readonly<Record<string, Tag.Handle<unknown>>> | null;
  /** The parameter in the caller's own layer: every config tag's value there, or null. */
  readonly paramOf: import("./index").Resource.Handle<Param | null>;
  readonly missingOf: import("./index").Resource.Handle<string | null>;
  /** The keys whose cell is keyed (ADR 0135): a stream per part, and an ask. */
  readonly keyed: ReadonlySet<string>;
  /** By keyed key: a reader's ask for a signal, under a process span that links its send. */
  readonly takes: Readonly<Record<string, Operation.Handle<unknown, Taken>>>;
};

type Shape = {
  readonly serve: Tag.Presence<true>;
  readonly fill: Tag.Presence<Fill>;
  readonly load: Tag.Presence<Load>;
  readonly read: Tag.Presence<Read>;
};

type StartEvent = Omit<Capsule.Events["start"], "config"> & { readonly config: Shape };
type RunEvent = Omit<Capsule.Events["run"], "config"> & { readonly config: Shape };

/** A reader's store: the root's own cells (no entry), or one parameter's entry. */
type Store = { readonly entry: Entry | null; readonly load: StartEvent["load"] };

/** The steps every remoteData capsule runs. */
const steps = resource({
  label: "remoteData.steps",
  target: "scope",
  factory: () => {
    /** One parameter as text: its entries in key order, so equal values name one slot. */
    const named = (param: Param) =>
      JSON.stringify(
        Object.keys(param)
          .sort()
          .map((key) => [key, param[key]]),
      );

    const slot = (key: string, param: Param | null) =>
      param === null ? key : `${key}\u0000${named(param)}`;

    /** A value that arrives: checked by the cell's own parse, when it has one. */
    const fits = (
      def: Def,
      key: string,
      value: unknown,
    ): { ok: true; value: unknown } | { ok: false; why: string } => {
      const check = def.cells[key]!.parse;
      if (!check) return { ok: true, value };
      try {
        return { ok: true, value: parse(check, value) };
      } catch (error) {
        return { ok: false, why: String(Object(error).kind ?? error) };
      }
    };

    /** Serve: the app writes the cells; this root holds them. */
    const serveStart = (def: Def, { load, next, config, run }: StartEvent) => {
      const roots = new Map(def.keys.map((key) => [key, load(def.cells[key]!, meta)] as const));
      const copies = new Map(def.keys.map((key) => [key, load(def.made[key]!, meta)] as const));
      for (const key of def.keys) {
        const now = roots.get(key)!.get();
        if (def.keyed.has(key)) {
          (copies.get(key) as unknown as Keyed).adopt(now as readonly unknown[]);
        } else copies.get(key)!.set(now);
      }

      const fill = (key: string, param: Param) => {
        const op = config.fill.present ? config.fill.value[key] : undefined;
        if (!op) return undefined;
        // The fill runs as one call tagged with the parameter: it reads `by` as any request would.
        const tags = Object.entries(def.by!).map(([k, t]) => t(param[k]));
        return Promise.resolve(run(op as never, { tags } as never, sending as never));
      };
      const loads = config.load.present ? config.load.value : {};
      // The load parses the part as its own raw input: it reads only the fields it takes. The
      // ask's signal gives it a session of its own, closed when it returns, as a fill's tags do.
      const loadPart = (key: string, part: Data.Key, signal: AbortSignal) => {
        const op = loads[key];
        return (
          op && Promise.resolve(run(op, { rawInput: part, signal } as never, sending as never))
        );
      };
      load(def.state, meta).set({
        roots,
        copies,
        watchers: new Map(),
        held: new Map(),
        fill,
        parts: new Map(),
        pass: new Map(),
        loads,
        load: loadPart,
      });
      return next();
    };

    /** The value of one slot now: held, else the fill for the parameter, else the initial. */
    const valueOf = async (def: Def, own: Served, key: string, param: Param | null) => {
      if (param === null) return own.roots.get(key)!.get();
      const at = slot(key, param);
      if (own.held.has(at)) return own.held.get(at);
      return (await own.fill(key, param)) ?? def.cells[key]!.initial;
    };

    /** A watch, as rpc runs it: the value now, then each write, until the caller leaves. */
    const watch = async (
      def: Def,
      own: Served,
      key: string,
      param: Param | null,
      out: { send: Push; closed: AbortSignal },
    ) => {
      const at = slot(key, param);
      const set = own.watchers.get(at) ?? new Map<Push, () => void>();
      own.watchers.set(at, set);

      // Join first, then read: a write that lands while the fill runs is pushed, not lost.
      const ended = new Promise<void>((done) => {
        const end = () => {
          if (!set.delete(out.send)) return done();
          if (set.size === 0) {
            own.watchers.delete(at);
            if (param !== null) own.held.delete(at); // no one watches: nothing to keep
          }
          done();
        };
        set.set(out.send, end);
        if (out.closed.aborted) end();
        else out.closed.addEventListener("abort", end, { once: true });
      });

      const now = await valueOf(def, own, key, param);
      if (param !== null && set.size > 0 && !own.held.has(at)) own.held.set(at, now);
      out.send(param === null ? now : (own.held.get(at) ?? now)); // the value now
      return ended;
    };

    /**
     * A keyed key's stream, as rpc runs it: the reader joins its part, then the first signal asks
     * for the part now. Join first, then signal: a write after the join signals again.
     */
    const watchPart = (
      own: Served,
      key: string,
      ask: Ask,
      out: { send: Push; closed: AbortSignal },
    ) => {
      const at = partSlot(key, ask);
      const set = own.watchers.get(at) ?? new Map<Push, () => void>();
      own.watchers.set(at, set);

      const ended = new Promise<void>((done) => {
        const end = () => {
          if (set.delete(out.send) && set.size === 0) {
            own.watchers.delete(at);
            own.parts.delete(at);
          }
          done();
        };
        own.parts.set(at, ask);
        set.set(out.send, end);
        if (out.closed.aborted) end();
        else out.closed.addEventListener("abort", end, { once: true });
      });
      out.send(ask);
      return ended;
    };

    /** A keyed key's ask, as rpc runs it: the members of the part from its load, or in the
     * root's cell now. A load may give more than the part: only the part's members go out. */
    const answerPart = (def: Def, own: Served, key: string, ask: Ask, signal: AbortSignal) => {
      const loaded = own.load(
        key,
        ask.window ? { ...Object(ask.part), ...ask.window } : ask.part,
        signal,
      );
      if (loaded) {
        const keyOf = memberKey(def.cells[key]!);
        return loaded.then((members) =>
          (members as readonly unknown[]).filter((m) => holds(ask, keyOf(m))),
        );
      }

      // Core does not sort: a window needs the store's load (ADR 0139 2).
      if (ask.window) raise("MissingConfig", { label: name, key: "load" });
      const root = own.roots.get(key) as unknown as Keyed;
      if (ask.read === "where") return root.where(ask.part as never).get();

      const member = root.of(ask.part).get();
      return member === undefined ? [] : [member];
    };

    /** Sends each reader of this pass one signal: the one member it must ask for, or, when more
     * than one share of its part is dirty, its whole part (ADR 0138 11). */
    const flush = (own: Served) => {
      const pass = [...own.pass];
      const sent = own.sent;
      own.pass.clear();
      own.sent = undefined;
      for (const [push, { at, dirty }] of pass) {
        if (!own.watchers.get(at)?.has(push)) continue; // it left during the pass

        push(dirty.size === 1 ? [...dirty.values()][0] : own.parts.get(at), sent);
      }
    };

    /** Marks a share of one reader's part dirty in this pass; the pass ends at the next
     * microtask, so the writes of one call make one pass. */
    const mark = (own: Served, at: string, push: Push, dirty: Ask) => {
      if (own.pass.size === 0) queueMicrotask(() => flush(own));
      const pass = own.pass.get(push) ?? { at, dirty: new Map<string, Ask>() };
      own.pass.set(push, pass);
      pass.dirty.set(partSlot("", dirty), dirty);
    };

    /**
     * A set on a served keyed cell marks its member dirty for each reader that holds it: a
     * lookup of 2^d slots. A change that is not one set (a preset, a whole list) marks every
     * part of the key dirty.
     */
    const changed = (own: Served, key: string, member: Data.Key | undefined) => {
      const slots =
        member === undefined
          ? [...own.parts.keys()].filter((at) => at.startsWith(`${key}\u0000`))
          : slotsOf(key, member);
      for (const at of slots) {
        const whole = own.parts.get(at);
        for (const push of own.watchers.get(at)?.keys() ?? []) {
          mark(own, at, push, member === undefined ? whole! : { read: "of", part: member });
        }
      }
    };

    /** `invalidate` on a serving root: each reader whose part shares a member with the dirty
     * part gets a signal for that share. */
    const dirtyOn = (own: Served, key: string, dirty: Data.Key) => {
      for (const [at, part] of own.parts) {
        const share = at.startsWith(`${key}\u0000`) ? narrowed(part, dirty) : undefined;
        if (share === undefined) continue;

        for (const push of own.watchers.get(at)!.keys()) mark(own, at, push, share);
      }
    };

    /** A reading root's `invalidate`, by definition and key: it asks again for the dirty share
     * of each part in use. */
    const askers = new Map<Def, Map<string, (dirty: Data.Key) => Promise<void>>>();

    /** A store's faults now: its entry's, or the root's cell. */
    const faultsIn = (def: Def, store: Store): Faults =>
      store.entry ? store.entry.faults : store.load(def.faults, meta).get();

    /** A reading root's steps for one parameter (or none): they share its start's run and log. */
    const reader = (
      def: Def,
      event: StartEvent,
      store: Store,
      param: Param | null,
      signal: AbortSignal,
    ) => {
      const { run, clock, log } = event;

      /** A key's last fault, or none: a new object per change, never mutated. */
      const mark = (key: string, error: RemoteFault | null) => {
        if (signal.aborted) return; // the scope is closing: nothing to show
        const now = faultsIn(def, store);
        if (!error && !Object.hasOwn(now, key)) return;
        const next: Record<string, RemoteFault> = { ...now };
        if (error) next[key] = error;
        else delete next[key];

        if (store.entry) {
          store.entry.faults = next;
          store.entry.listeners.forEach((listener) => listener());
        } else store.load(def.faults, meta).set(next);
      };

      /** A value that does not fit the cell's parse is `invalid` (side "client"), not a skip. */
      const set = (key: string, value: unknown, traceId?: string) => {
        const checked = fits(def, key, value);
        if (!checked.ok) {
          log.error("remoteData value refused", { address: key, why: checked.why });
          return mark(key, def.wire.fault.make(key, "invalid", { side: "client" }, traceId));
        }
        if (store.entry) {
          store.entry.values.set(key, checked.value);
          store.entry.listeners.forEach((listener) => listener());
        } else store.load(def.made[key]!, meta).set(checked.value);
        mark(key, null);
      };

      /** One round of a key's stream, until it ends: the fault it ended with, or null. */
      const round = async (key: string, first: () => void): Promise<RemoteFault | null> => {
        const done = new AbortController();
        try {
          const values = (await run(
            def.wire[key] as never,
            { input: param } as never,
            reading as never,
          )) as AsyncIterable<unknown> & {
            readonly meta?: Record<string, string>;
            stop(reason?: unknown): void;
          };

          // Not the run's own signal: a call with one ends its layer, and the stream with it,
          // when the call returns. The loop's signal stops the stream instead; the listener
          // goes with the round, so rounds do not pile listeners on the signal.
          signal.addEventListener("abort", () => values.stop(signal.reason), {
            once: true,
            signal: done.signal,
          });
          if (signal.aborted) values.stop(signal.reason);

          for await (const value of values) {
            // One process span per push (OTel messaging), linked to the writer's send span.
            const traceId = (await run(
              def.wire.receive as never,
              { input: { key, meta: values.meta } } as never,
              reading as never,
            )) as string | undefined;
            set(key, value, traceId);
            first();
          }
          return null;
        } catch (error) {
          return faultOf(def, key, error, log);
        } finally {
          done.abort();
        }
      };

      /**
       * Keeps a key fresh: its rpc stream, again after it ends or faults, with back-off while
       * faulted (as EventSource retry). A stream's first push is the value now, so a reopen is
       * the catch-up read. `first` settles on the first value or fault.
       */
      const loop = async (key: string, first: () => void) => {
        for (let wait = 50; !signal.aborted;) {
          const ended = await round(key, first);
          if (!signal.aborted && ended) mark(key, ended);
          first();
          if (signal.aborted) break;

          wait = Object.hasOwn(faultsIn(def, store), key) ? Math.min(wait * 2, 5000) : 50;
          await clock.sleep(wait, signal).catch(() => undefined);
        }
      };

      return { mark, set, round, loop };
    };

    /** A keyed reading root: its start context, and one entry per parameter some session names. */
    const readers = new Map<
      Def,
      { event: StartEvent; entries: Map<string, Entry>; root: string | null }
    >();

    /** Starts every key's loop; resolves once each has its first value or fault. */
    const keep = (def: Def, keys: ReturnType<typeof reader>) =>
      Promise.all(
        def.keys
          .filter((key) => !def.keyed.has(key))
          .map(
            (key) =>
              new Promise<void>((done) => {
                void keys.loop(key, done);
              }),
          ),
      );

    /**
     * A session that names a parameter gets that parameter's values in its own layer, as Phoenix
     * joins a topic: the first session starts one stream per key; later ones share them; the
     * last to close stops them (a reference count, ADR 0059 7). The root's close stops them too,
     * by one listener that leaves the root's signal with the entry: `AbortSignal.any` would keep a
     * record per entry on that signal in Node (ADR 0133).
     */
    const join = (def: Def, param: Param, into: Scope.Handle | null, life?: AbortSignal) => {
      const own = readers.get(def)!;
      const id = named(param);
      let entry = own.entries.get(id);

      if (!entry) {
        const made: Entry = {
          refs: 0,
          values: new Map(),
          faults: {},
          listeners: new Set(),
          stop: new AbortController(),
        };
        entry = made;
        own.entries.set(id, made);

        const store: Store = { entry: made, load: own.event.load };
        own.event.signal.addEventListener("abort", () => made.stop.abort(own.event.signal.reason), {
          once: true,
          signal: made.stop.signal,
        });
        void keep(def, reader(def, own.event, store, param, made.stop.signal));
      }
      const held = entry;
      // Into the session's own layer, or the root's cells when the root names the parameter.
      const apply = () => {
        if (life?.aborted) return; // the session closed: nothing writes there

        for (const [key, value] of held.values) {
          const cell = def.made[key]!;
          (into ? into.controller(cell) : own.event.load(cell, meta)).set(value);
        }
        (into ? into.controller(def.faults) : own.event.load(def.faults, meta)).set(held.faults);
      };
      held.refs++;
      held.listeners.add(apply);
      apply();
      return () => {
        held.listeners.delete(apply);
        if (--held.refs > 0) return;
        held.stop.abort();
        own.entries.delete(id);
      };
    };

    /**
     * A client's keyed key: the first reader of a part joins it, as a stream whose signals each
     * ask for what they name; the last reader leaves it, and the part's members go, except those
     * another part in use still holds (ADR 0137, 0138).
     */
    const readKeyed = (
      def: Def,
      event: StartEvent,
      key: string,
      mark: (k: string, e: RemoteFault | null) => void,
    ) => {
      const { run, clock, signal, log } = event;
      const cell = event.load(def.made[key]!, meta) as unknown as Keyed;
      const joined = new Map<string, Joined>();
      const states = event.load(def.states, meta) as unknown as Scope.KeyedController<
        Stated,
        { at: string }
      >;
      /** Sets the state of a part, and of each part in use that it holds whole. */
      const stand = (asked: Ask, now: PartState) => {
        if (signal.aborted) return;
        for (const j of joined.values()) {
          if (shares(asked, j.ask) && (asked.window || holds(asked, j.ask.part))) {
            states.set({ ...now, at: partSlot(key, j.ask) });
          }
        }
      };
      const stays = (member: Data.Key) => [...joined.values()].some((j) => holds(j.ask, member));

      const pending = new Set<Asking>();
      const inUse = (asked: Ask) =>
        !signal.aborted && [...joined.values()].some((j) => narrowed(j.ask, asked.part));

      const keyOf = memberKey(def.made[key]!);

      /** One ask (ADR 0137 3). A later ask that shares members with it is fresher for them: this
       * answer leaves them to that one, and this ask resolves after it. Never rejects: a fault
       * goes to `board.faults`. */
      const ask = (asked: Ask, signalled?: { meta?: Record<string, string> }): Promise<void> => {
        const entry: Asking = { ask: asked, later: [], signalled };
        for (const p of pending) if (shares(p.ask, asked)) p.later.push(entry);
        pending.add(entry);
        entry.done = settle(entry);
        return entry.done;
      };

      const settle = async (entry: Asking): Promise<void> => {
        const { read, part } = entry.ask;
        const newer = (k: Data.Key) => entry.later.some((l) => holds(l.ask, k));
        // A signal's ask runs under the reader's process span, which links the pass's send span.
        const taken = entry.signalled && { ask: entry.ask, meta: entry.signalled.meta };
        const got = await Promise.resolve()
          .then(() =>
            taken
              ? run(def.takes[key]!, { input: taken }, reading as never)
              : run(
                  def.wire[`${key}.ask`] as never,
                  { input: entry.ask } as never,
                  reading as never,
                ),
          )
          .then(
            (members) => () => {
              const fresh = (members as readonly unknown[]).filter((m) => !newer(keyOf(m)));
              cell.answer(read, part, fresh, newer, entry.ask.window);
            },
            (error: unknown) => () => {
              throw error;
            },
          );
        pending.delete(entry);
        if (!newer(part) && inUse(entry.ask)) apply(entry.ask, got);

        await Promise.all(entry.later.map((l) => l.done));
      };

      /** Puts one answer in the cell, or its fault in `board.faults`. */
      const apply = (asked: Ask, got: () => void) => {
        try {
          got();
          mark(key, null);
          stand(asked, { status: "ready" });
        } catch (error) {
          const at = partSlot(key, asked);
          const fault = def.wire.fault.is(error)
            ? error
            : def.wire.fault.make(at, "invalid", { side: "client" }, undefined);
          mark(key, fault);
          stand(asked, { status: "fault", fault });
        }
      };

      /** `invalidate` here: ask again for the dirty share of each part in use, once each. */
      const reask = async (dirty: Data.Key) => {
        const asks = new Map<string, Ask>();
        for (const j of joined.values()) {
          const share = j.rides ? undefined : narrowed(j.ask, dirty);
          // A part that waits on a fault opens again: the new stream's first signal asks.
          if (share && j.wake) j.wake();
          else if (share) asks.set(partSlot(key, share), share);
        }
        await Promise.all([...asks.values()].map((a) => ask(a)));
      };
      const mine = askers.get(def) ?? new Map<string, (dirty: Data.Key) => Promise<void>>();
      askers.set(def, mine.set(key, reask));

      /** Waits until a trigger wakes the part, or the part leaves. */
      const parked = async (part: Joined) => {
        await new Promise<void>((woken) => {
          part.wake = woken;
          part.stop.signal.addEventListener("abort", () => woken(), { once: true });
        });
        part.wake = undefined;
      };

      const follow = async (part: Joined) => {
        for (let wait = 50; !part.stop.signal.aborted;) {
          try {
            const signals = (await run(
              def.wire[key] as never,
              { input: part.ask } as never,
              reading as never,
            )) as AsyncIterable<Ask> & {
              readonly meta?: Record<string, string>;
              stop(reason?: unknown): void;
            };
            part.stop.signal.addEventListener("abort", () => signals.stop(), { once: true });
            for await (const dirty of signals) void ask(dirty, { meta: signals.meta });
            wait = 50;
          } catch (error) {
            if (part.stop.signal.aborted) return;
            const fault = faultOf(def, key, error, log);
            mark(key, fault);
            stand(part.ask, { status: "fault", fault });

            // Only a broken link heals by itself. Any other fault is the server's answer, and the
            // same ask gives it again: the part waits for a trigger (ADR 0139 4).
            if (fault.fault !== "link") {
              await parked(part);
              wait = 50;
              continue;
            }
            wait = Math.min(wait * 2, 5000);
          }
          await clock.sleep(wait, part.stop.signal).catch(() => undefined);
        }
      };

      /** A part in use that holds every member of this part, if any. */
      const coverOf = (asked: Ask) =>
        [...joined.values()].find(
          (j) => j.ask !== asked && !j.ask.window && !asked.window && holds(j.ask, asked.part),
        );

      /** A part's own stream, until the part leaves or the root closes. */
      const own = (part: Joined) => {
        signal.addEventListener("abort", () => part.stop.abort(), {
          once: true,
          signal: part.stop.signal,
        });
        void follow(part);
      };

      cell.listen((read, part, window) => {
        const asked: Ask = window ? { read, part, window } : { read, part };
        const at = partSlot(key, asked);
        const made = joined.get(at) ?? { refs: 0, ask: asked, stop: new AbortController() };
        if (made.refs++ === 0) {
          made.rides = coverOf(asked);
          joined.set(at, made);
          const cover = made.rides && states.of({ at: partSlot(key, made.rides.ask) }).get();
          if (!signal.aborted) states.set({ ...(cover ?? { status: "pending" }), at });
          if (!made.rides) own(made);
        }
        return () => {
          if (--made.refs > 0) return;
          made.stop.abort();
          joined.delete(at);
          if (!signal.aborted) states.delete({ at });

          // A part that rode this one rides another, or gets its own stream, which asks afresh.
          for (const r of joined.values()) {
            if (r.rides !== made) continue;

            r.rides = coverOf(r.ask);
            if (!r.rides) own(r);
          }
          if (!signal.aborted) cell.answer(read, part, [], stays, window);
        };
      });
    };

    /** Read: fill every cell from the backend, then keep it fresh. */
    const readStart = async (def: Def, event: StartEvent) => {
      const { config, raise, next, load, signal } = event;
      if (!config.read.present) return raise("MissingConfig", { label: name, key: "read" });

      // A keyed definition reads nothing at the root: each session that names a parameter does.
      if (def.by) {
        readers.set(def, { event, entries: new Map(), root: null });
        const param = await load(def.paramOf, meta);
        if (param !== null) {
          readers.get(def)!.root = named(param);
          join(def, param, null);
        }
        return next();
      }

      // A fault on the first value does not fail start: the cell keeps its initial value, and
      // `board.faults` shows the fault.
      const keys = reader(def, event, { entry: null, load }, null, signal);
      for (const key of def.keyed) readKeyed(def, event, key, keys.mark);
      await keep(def, keys);
      return next();
    };

    return {
      named,
      keep,
      reader,
      valueOf,
      faultsIn,
      slot,
      fits,
      serveStart,
      watch,
      watchPart,
      answerPart,
      changed,
      /** `invalidate`: signal the readers on a serving root; ask again on a reading root. */
      invalidate: async (def: Def, own: Served | null, key: string, dirty: Data.Key) => {
        if (own) return dirtyOn(own, key, dirty);
        await askers.get(def)?.get(key)?.(dirty);
      },
      readStart,
      join,
      /**
       * A server op that writes a keyed cell runs only with every config tag bound: with none,
       * its write would go to no one, so it fails before it runs (`MissingTag`, as Core says it).
       */
      guardKeyed: (def: Def, event: RunEvent) => {
        const cells: readonly unknown[] = Object.values(def.cells);
        const writes = Object.values(Object(Object(event.op).depends)).some(
          (d) => Object(d).kind === "controller" && cells.includes(Object(d).target),
        );
        if (!writes) return event.next();

        return event
          .load(def.missingOf, meta)
          .then((missing) =>
            missing === null ? event.next() : event.raise("MissingTag", { label: missing }),
          );
      },
      isReading: (def: Def) => readers.has(def),
      rootParam: (def: Def) => readers.get(def)?.root ?? null,
    };
  },
});

type Steps = Awaited<ReturnType<(typeof steps)["factory"]>>;

/**
 * A definition takes plain `data` cells, by key, as a short way to give each shape (initial,
 * parse, eq). It makes its OWN cell per key and exports those as read views (ADR 0123):
 * `useData(board.todos)`. Each key is an rpc stream key at the same address; `board(...)`
 * installs that rpc capsule and this one:
 * - `serve: true`: the app's writer ops set the passed cells; each write is pushed to the key's
 *   watchers.
 * - `read`: each key's stream fills its cell. Ready once every key has its first value or fault.
 * Faults are rpc's, branded by the definition: `board.fault.is(e)`. They are data:
 * `board.faults` holds each key's last fault until a good value arrives. A fault never fails
 * start.
 */
export function remoteData<
  const D extends Cells,
  const P extends Readonly<Record<string, Tag.Handle<any>>> = {},
>(cells: D, { config = {} as P }: { readonly config?: P } = {}) {
  const keys = Object.keys(cells) as (keyof D & string)[];
  const keyed = new Set(keys.filter((key) => cells[key]!.mode === "keyed"));
  const by = checked(cells, config, keyed) as Def["by"];
  const configKeys = Object.keys(config);

  const keyOf = new Map<unknown, string>(keys.map((key) => [cells[key], key]));
  /** This definition's own cells: same shape, new identity. */
  const made = Object.fromEntries(keys.map((key) => [key, remake(cells[key]!)])) as unknown as D;

  /** The parameter on the wire: each config tag admits its own value (the tag's `parse`). */
  const param =
    by === null
      ? z.null()
      : z.make<Param>((value) => {
          if (typeof value !== "object" || value === null) return z.fail("expected the parameter");
          try {
            const out = Object.fromEntries(
              Object.entries(by).map(([key, t]) => [key, t(Object(value)[key]).value]),
            );
            return { value: out as Param };
          } catch {
            return z.fail("the parameter does not fit its tags");
          }
        });

  // The wire: one rpc stream key per cell. Values cross as they are; the cell's parse checks them
  // on the client, where a misfit is a fault the key shows (`invalid`), not a broken stream.
  const wire = rpc(
    Object.fromEntries(
      keys.flatMap((key): [string, Contract][] =>
        keyed.has(key)
          ? [
              [key, { mode: "stream" as const, input: askShape, output: z.unknown() }],
              [`${key}.ask`, { mode: "reply" as const, input: askShape, output: z.unknown() }],
            ]
          : [[key, { mode: "stream" as const, input: param, output: z.unknown() }]],
      ),
    ),
    { label: name },
  ) as unknown as Wire &
    ((values: unknown) => Capsule.Installable) & {
      readonly answer: Answer;
      readonly stream: Stream;
    };

  const serveKey = tag<true>({ label: `${name}.serve` });
  const fillKey = tag<Fill>({ label: `${name}.fill` });
  const loadKey = tag<Load>({ label: `${name}.load` });
  const readKey = tag<Read>({ label: `${name}.read` });

  const configDepends = Object.fromEntries(
    Object.entries(config).map(([key, t]) => [key, (t as Tag.Handle<unknown>).optional]),
  );

  /** The parameter in the caller's own layer: one build per layer, so a session reads its own tag. */
  const paramOf = resource({
    label: `${name}.param`,
    target: "session",
    depends: configDepends,
    factory: (deps: Readonly<Record<string, Tag.Presence<unknown>>>): Param | null => {
      if (!by) return null;

      const out: Record<string, unknown> = {};
      for (const key of configKeys) {
        if (!deps[key]?.present) return null; // a parameter names every config key
        out[key] = deps[key]!.value;
      }

      return out;
    },
  });

  const missingOf = resource({
    label: `${name}.missing`,
    target: "session",
    depends: configDepends,
    factory: (deps: Readonly<Record<string, Tag.Presence<unknown>>>): string | null => {
      const absent = configKeys.find((key) => !deps[key]?.present);
      return absent === undefined ? null : (config[absent] as Tag.Handle<unknown>).label;
    },
  });

  const state = data<Served | null>({ label: `${name}.state`, initial: null });
  /**
   * On a reading root: each key's last fault, until a good value arrives. A read view,
   * `useData(board.faults).todos`: faults are data, as TanStack Query gives `{ data, error }`.
   */
  const faults = data<Readonly<Partial<Record<keyof D & string, RemoteFault>>>>({
    label: `${name}.faults`,
    initial: {} as Readonly<Partial<Record<keyof D & string, RemoteFault>>>,
  });
  const states = data({
    label: `${name}.states`,
    mode: "keyed",
    key: (s: Stated) => ({ at: s.at }),
  });

  // A reader's ask for a signal follows OTel messaging, as `remoteData.receive` does for a push:
  // a process span that links the pass's send span, with the ask under it.
  const takes = Object.fromEntries(
    [...keyed].map((key) => [
      key,
      operation({
        label: `${name}.receive`,
        depends: { answer: (wire[`${key}.ask`] as Operation.Handle<unknown, Ask>).controller },
        run: ({ answer }, { input, obs }: Operation.Ctx<Taken>) => {
          if (obs.span) {
            Object.assign(obs.span.attributes, {
              "messaging.operation.type": "process",
              "messaging.destination.name": key,
            });
          }
          const link = input.meta?.traceparent;
          if (link) obs.event("link", { traceparent: link });
          return answer.run({ input: input.ask });
        },
      }) as Operation.Handle<unknown, Taken>,
    ]),
  );

  const def: Def = {
    cells,
    made,
    keys,
    wire,
    state,
    faults: faults as Data.Cell<Faults>,
    states,
    by,
    paramOf,
    missingOf,
    keyed,
    takes,
  };

  /** Each key's stream, as rpc runs it on the server: the value now, then each write. */
  const implement = Object.fromEntries(
    keys.flatMap((key): [string, unknown][] =>
      keyed.has(key)
        ? [
            [
              key,
              operation({
                label: `${name}.watch`,
                input: askShape,
                depends: { out: channel, own: state, s: steps },
                run: ({ out, own, s }, { input }) => s.watchPart(own!, key, input, out),
              }),
            ],
            [
              `${key}.ask`,
              operation({
                label: `${name}.ask`,
                input: askShape,
                depends: { own: state, s: steps },
                run: ({ own, s }, { input, signal }) => s.answerPart(def, own!, key, input, signal),
              }),
            ],
          ]
        : [
            [
              key,
              operation({
                label: `${name}.watch`,
                input: param,
                depends: { out: channel, own: state, s: steps },
                run: ({ out, own, s }, { input }) =>
                  s.watch(def, own!, key, (input ?? null) as Param | null, out),
              }),
            ],
          ],
    ),
  );

  /** Ends every watch this root serves (a test's way to drop the links). */
  const drop = operation({
    label: `${name}.drop`,
    depends: { own: state },
    run: ({ own }) => {
      for (const set of own?.watchers.values() ?? []) {
        for (const end of Array.from(set.values())) end();
      }
    },
  });
  /** A keyed pass's producer span, from the first write or `invalidate` of the pass: each signal
   * of the pass carries it. The pass sends at the next microtask (ADR 0138 11). */
  const stamp = operation({
    label: `${name}.send`,
    input: z.object({ key: z.string() }),
    depends: { served: state, protocol },
    run: ({ served, protocol }, { input, obs }) => {
      if (!served?.pass.size || served.sent) return;
      if (obs.span) {
        Object.assign(obs.span.attributes, {
          "messaging.operation.type": "send",
          "messaging.destination.name": input.key,
        });
      }
      served.sent = protocol.traceparent(obs.span);
    },
  });
  /**
   * Marks parts dirty, by keyed key: `{ tasks: { project } }`. On a serving root, each reader
   * of a part that shares a member gets a signal with no data. On a reading root, each part in
   * use asks again; the call resolves once the answers are in the cell (ADR 0137 2).
   */
  const invalidate = operation({
    label: `${name}.invalidate`,
    input: z.make<Dirty<D>>((value) => {
      const entries = Object.entries(Object(value) as object);
      const fit = entries.every(([key, part]) => keyed.has(key) && isKey(part));
      return fit ? { value: value as Dirty<D> } : z.fail("expected keyed keys and their parts");
    }),
    depends: { own: state, s: steps, send: stamp.controller },
    run: async ({ own, s, send }, { input }) => {
      const asked = Object.entries(input).map(([key, part]) =>
        s.invalidate(def, own, key, part as Data.Key),
      );
      for (const key of Object.keys(input)) send.run({ input: { key } });
      await Promise.all(asked);
    },
  });
  /**
   * The first `onStart` hook of a server with a load: a part that the load's input does not take
   * is refused before any guard (ADR 0138 13).
   */
  const fitsPart = operation({
    label: `${name}.fits`,
    input: hook.start,
    depends: { own: state },
    run: ({ own }, { input }) => {
      const need = own!.loads[input.key.replace(/\.ask$/, "")]?.input;
      const { part, window } = Object(input.input) as Partial<Ask>;
      try {
        if (need) parse(need, window ? { ...Object(part), ...window } : part);
        return undefined;
      } catch {
        return input.refuse({ part });
      }
    },
  });
  const rooting = new Set<unknown>();
  /** One write to the served root controllers. A keyed one adopts the list (ADR 0138), then
   * marks its member dirty for the readers that hold it. */
  const root = (served: Served, key: string, value: unknown, s: Steps) => {
    if (!keyed.has(key)) {
      served.roots.get(key)!.set(value);
      served.copies.get(key)!.set(value);
      return;
    }

    const list = value as readonly unknown[];
    const control = served.roots.get(key) as unknown as Keyed;
    // With a load the store is the truth: a set marks its member dirty, and nothing is kept.
    if (served.loads[key]) return s.changed(served, key, control.step(list));

    s.changed(served, key, control.adopt(list));
    (served.copies.get(key) as unknown as Keyed).adopt(list);
  };

  // Pushes follow OTel messaging: the server runs `remoteData.send` (a producer span) per write;
  // each push carries it as `meta.traceparent`; rpc's `remoteData.receive` on the client links it.
  const publish = operation({
    label: `${name}.send`,
    input: z.object({
      key: z.string(),
      value: z.unknown(),
      watchers: z.array(z.custom<Push>((v) => typeof v === "function")),
    }),
    depends: { protocol },
    run: ({ protocol }, { input, obs, log }) => {
      if (obs.span) {
        Object.assign(obs.span.attributes, {
          "messaging.operation.type": "send",
          "messaging.destination.name": input.key,
          "messaging.batch.message_count": input.watchers.length,
        });
      }
      const sent = protocol.traceparent(obs.span);
      // One watcher that cannot take the push (its link just went) does not stop the others.
      for (const push of input.watchers) {
        try {
          push(input.value, sent);
        } catch (error) {
          log.error("remoteData push failed", { address: input.key, cause: String(error) });
        }
      }
    },
  });

  const own = data<Steps | null>({ label: `${name}.steps`, initial: null });

  const base = capsule({
    label: name,
    config: {
      serve: serveKey.optional,
      fill: fillKey.optional,
      load: loadKey.optional,
      read: readKey.optional,
    },
    exports: { ...made, faults, states, drop, invalidate } as unknown as {
      drop: typeof drop;
      invalidate: typeof invalidate;
    },
    hooks: {
      async start(event) {
        const { config, load, raise } = event;
        if (config.serve.present === config.read.present) {
          raise("MissingConfig", { label: name, key: "serve | read" });
        }
        const s = await load(steps, meta);
        load(own, meta).set(s);
        const start = event as unknown as StartEvent;

        return config.serve.present ? s.serveStart(def, start) : s.readStart(def, start);
      },

      run(event) {
        if (!by || !event.load(state, meta).get()) return event.next();
        return event
          .load(own, meta)
          .get()!
          .guardKeyed(def, event as unknown as RunEvent);
      },

      /** A keyed reading root: a session that names a parameter reads that parameter's values. */
      async session({ handle, next, load }) {
        if (!by) return next();
        const s = load(own, meta).get();
        if (!s || !s.isReading(def)) return next();

        const asked = handle.resolve(paramOf);
        // No parameter, or the root's own: the session reads the root's cells through.
        if (asked === null || s.rootParam(def) === s.named(asked)) return next();

        const life = new AbortController();
        const leave = s.join(def, asked, handle, life.signal);
        try {
          return await next();
        } finally {
          life.abort();
          leave();
        }
      },

      write({ cell, value, next, load, run, log }) {
        const key = keyOf.get(cell);
        if (key === undefined) return next();
        const served = load(state, meta).get();
        if (!served) return next(); // a reading root: nothing to push
        if (by) {
          // Keyed: the write stays where the writer made it; the writer's `by` tag names the
          // parameter, and only that parameter's watchers get it.
          next();
          void load(paramOf, meta)
            .then((param) => {
              if (param === null) {
                log.error("remoteData keyed write with no parameter", { address: key });
                return;
              }

              const at = `${key}\u0000${load(own, meta).get()!.named(param)}`;
              const watchers = [...(served.watchers.get(at)?.keys() ?? [])];
              if (!watchers.length) return; // no one watches: the next watch fills afresh

              served.held.set(at, value);
              return run(publish, { input: { key, value, watchers } }, sending);
            })
            .catch((error) =>
              log.error("remoteData send failed", { address: key, cause: String(error) }),
            );
          return;
        }
        // A request runs in a session, and a session keeps its writes (ADR 0090): the root holds
        // the data. A served keyed cell lives at the root only (ADR 0138): no session keeps a
        // copy. The outer call sends, from the writer's own owner, so the send span is in the
        // writer's trace.
        if (rooting.has(cell)) return next();
        rooting.add(cell);
        try {
          root(served, key, value, load(own, meta).get()!);
        } finally {
          rooting.delete(cell);
        }
        if (keyed.has(key)) return void run(stamp, { input: { key } }, sending);

        const watchers = [...(served.watchers.get(key)?.keys() ?? [])];

        void run(publish, { input: { key, value, watchers } }, sending).catch((error) =>
          log.error("remoteData send failed", { address: key, cause: String(error) }),
        );
      },
    },
  });

  /** One call installs two capsules: the wire (rpc), then the cells (this one). */
  const install = ({ retry, onStart, onSuccess, onError, onFinish, ...job }: Config<D>) => {
    const starts = "load" in job && job.load ? [fitsPart, ...(onStart ?? [])] : onStart;
    const hooks = Object.fromEntries(
      Object.entries({ retry, onStart: starts, onSuccess, onError, onFinish }).filter(([, v]) => v),
    );
    return [
      wire("serve" in job && job.serve ? { implement, ...hooks } : { remote: job.read, ...hooks }),
      base(job as never),
    ];
  };
  Object.defineProperties(install, Object.getOwnPropertyDescriptors(base));

  type Base = typeof base;
  const fault = { is: (error: unknown): error is RemoteFault => wire.fault.is(error) };
  return Object.assign(install, {
    fault,
    /** A keyed call's part, as a guard reads it: the wire parsed it (a flat key), and the
     * cell's key types it. Undefined for a call that is not a keyed join or ask. */
    part: (call: { readonly key: string; readonly input: unknown }) =>
      keyed.has(call.key.replace(/\.ask$/, "") as keyof D & string)
        ? (Object(call.input) as Ask).part
        : undefined,
    /** The state of a keyed read's part (ADR 0139 1): `useData(board.status(read))`. Undefined
     * while no reader has the part in use. */
    status: (read: Data.Read<unknown>) => {
      const key = Object.keys(made).find((k) => made[k] === read.cell)!;
      return states.of({ at: partSlot(key, read) });
    },
    addresses: keys.flatMap((key) => (keyed.has(key) ? [key, `${key}.ask`] : [key])),
    // A cell with no label says nothing: the transport then names the board, "remoteData".
    names: (address: string) => cells[address.replace(/\.ask$/, "")]?.label.replace(/^anon$/, ""),
    answer: wire.answer,
    stream: wire.stream,
    ...config,
  }) as unknown as Omit<Base, never> &
    Capsule.Shown<D & { faults: typeof faults }> &
    P & {
      readonly answer: Answer;
      readonly stream: Stream;
      readonly drop: typeof drop;
      readonly invalidate: typeof invalidate;
      readonly fault: { is(error: unknown): error is RemoteFault };
      part(call: { readonly key: string; readonly input: unknown }): PartIn<D> | undefined;
      status(read: Data.Read<unknown>): Data.Read<PartState | undefined>;
      readonly addresses: readonly string[];
    } & {
      (values: Config<D>): Capsule.Installable;
    };
}
