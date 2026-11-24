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
  | { readonly serve: true; readonly load?: Loads<D>; readonly read?: never }
  | { readonly read: Read; readonly refetchInterval?: Intervals<D>; readonly serve?: never };

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

/** By keyed key: how often, in ms, a part in use asks again (ADR 0139 3). With none, it never
 * does by time: TanStack's `refetchInterval` is off by default too. */
type Intervals<D> = {
  readonly [K in keyof D as D[K] extends Data.Keyed<any, any> ? K : never]?: number;
};

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
  /** Set while the part waits on a fault that is an answer: a trigger calls it (ADR 0139 4). An
   * `invalidate` passes its own resolve: the reopened stream's first ask or fault settles it. */
  wake?: (heard?: Heard) => void;
};

/** The resolve of an `invalidate` that woke a part: it takes the first ask of the part's new
 * stream, or nothing on a fault, or nothing when the part leaves. A later call does nothing
 * (ADR 0147 d4). */
type Heard = (asked?: Promise<void>) => void;

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

/** `invalidate`'s input: a part (or a key) for each keyed key named; `{}` for a plain key. */
type Dirty<D> = {
  readonly [K in keyof D]?: D[K] extends Data.Keyed<any, infer Key>
    ? Key extends string
      ? Key
      : Data.Part<Key>
    : Record<string, never>;
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
/** For labels only: the wire address is the key. */
const name = "remoteData";

const reserved =
  "answer stream drop invalidate fault faults part status states receive addresses uploads contracts".split(
    " ",
  );

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

const holding = Symbol("holding");

/** A status read's key (ADR 0164): its part's slot, which alone is the key's text. Under a
 * symbol, which the text leaves out, the keyed key and the read that a watch of it holds. */
type StatusKey = {
  readonly at: string;
  readonly [holding]: { readonly key: string; readonly read: Data.Read<unknown> };
};

/** `states` on a reading root, past its public type: its listener hears the first watch of each
 * status key, and the leave it gives back ends that watch's hold (ADR 0164). */
type States = Scope.KeyedController<Stated, { at: string }> & {
  listen(listener: (read: "of" | "where", part: StatusKey) => () => void): void;
};

/** A signal as a reader takes it: the ask, and the meta it came with. */
type Taken = { readonly ask: Ask; readonly meta?: Record<string, string> };

/** One watcher: rpc's `channel.send` of one stream. */
type Push = (value: unknown, meta?: Record<string, string>) => void;

/** What a serving root keeps: each cell's root controller, and who watches each slot. */
type Served = {
  roots: Map<string, Scope.DataController<unknown>>;
  copies: Map<string, Scope.DataController<unknown>>;
  /** By slot: a plain key, or a keyed key's part. */
  watchers: Map<string, Map<Push, () => void>>;
  /** A keyed key's slots in use: the part each one reads. */
  parts: Map<string, Ask>;
  /** A keyed key's readers with a part to ask in this pass (ADR 0138 11). */
  pass: Map<Push, Pass>;
  /** The pass's send span, as each of its signals carries it (`meta.traceparent`). */
  sent?: Record<string, string>;
  /** Each keyed key's load, from the config. */
  loads: Load;
  /** A keyed key's load of one part, run on the root; undefined when the key has none. */
  load: (key: string, part: Data.Key, signal: AbortSignal) => Promise<unknown> | undefined;
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
  /** The keys whose cell is keyed (ADR 0135): a stream per part, and an ask. */
  readonly keyed: ReadonlySet<string>;
  /** By keyed key: a reader's ask for a signal, under a process span that links its send. */
  readonly takes: Readonly<Record<string, Operation.Handle<unknown, Taken>>>;
};

type Shape = {
  readonly serve: Tag.Presence<true>;
  readonly load: Tag.Presence<Load>;
  readonly read: Tag.Presence<Read>;
  readonly refetchInterval: Tag.Presence<Readonly<Record<string, number | undefined>>>;
};

type StartEvent = Omit<Capsule.Events["start"], "config"> & { readonly config: Shape };

/** The steps every remoteData capsule runs. */
const steps = resource({
  label: "remoteData.steps",
  target: "scope",
  factory: () => {
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

      const loads = config.load.present ? config.load.value : {};
      // The load parses the part as its own raw input: it reads only the fields it takes. The
      // ask's signal gives it a session of its own, closed when it returns.
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
        parts: new Map(),
        pass: new Map(),
        loads,
        load: loadPart,
      });
      return next();
    };

    /** Joins one watcher to a slot until its `closed` aborts; `last` runs when the slot's last
     * watcher leaves. Resolves when this watcher leaves. */
    const joinAt = (
      own: Served,
      at: string,
      out: { send: Push; closed: AbortSignal },
      last?: () => void,
    ) => {
      const set = own.watchers.get(at) ?? new Map<Push, () => void>();
      own.watchers.set(at, set);
      return new Promise<void>((done) => {
        const end = () => {
          if (set.delete(out.send) && set.size === 0) {
            own.watchers.delete(at);
            last?.();
          }
          done();
        };
        set.set(out.send, end);
        if (out.closed.aborted) end();
        else out.closed.addEventListener("abort", end, { once: true });
      });
    };

    /** A plain key's value now: read at once, at the join, and handed back after an await. That
     * await keeps the order the old `valueOf` gave: the stream's first push goes out after the
     * watch op has returned to rpc, not inside its run. */
    const valueNow = async (own: Served, key: string) => own.roots.get(key)!.get();

    /** A plain key's stream, as rpc runs it: the value now, then each write. Join first, then
     * read: a write that lands meanwhile is pushed, not lost. */
    const watch = async (own: Served, key: string, out: { send: Push; closed: AbortSignal }) => {
      const ended = joinAt(own, key, out);
      out.send(await valueNow(own, key));
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
      own.parts.set(at, ask);
      const ended = joinAt(own, at, out, () => own.parts.delete(at));
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

    /** A reading root's `invalidate`, by the key's cell: a keyed key asks again for the dirty
     * share of each part in use; a plain key's loop opens again if it ended on an answer, or
     * ends on one while it opens (ADR 0140). */
    const askers = new Map<unknown, Set<(dirty: Data.Key) => Promise<void>>>();
    const askersOf = (cell: unknown) => askers.get(cell) ?? askers.set(cell, new Set()).get(cell)!;
    /** Calls each waiting call once, and empties the list. */
    const callAll = (calls: (() => void)[]) => {
      for (const done of calls.splice(0)) done();
    };

    /** A reading root's steps: they share its start's run, log and signal. */
    const reader = (def: Def, event: StartEvent) => {
      const { run, clock, log, load, signal } = event;
      const faults = load(def.faults, meta);

      /** A key's last fault, or none: a new object per change, never mutated. */
      const mark = (key: string, error: RemoteFault | null) => {
        if (signal.aborted) return; // the scope is closing: nothing to show
        const now = faults.get();
        if (!error && !Object.hasOwn(now, key)) return;

        const next: Record<string, RemoteFault> = { ...now };
        if (error) next[key] = error;
        else delete next[key];
        faults.set(next);
      };

      /** A value that does not fit the cell's parse is `invalid` (side "client"), not a skip. */
      const set = (key: string, value: unknown, traceId?: string) => {
        const checked = fits(def, key, value);
        if (!checked.ok) {
          log.error("remoteData value refused", { address: key, why: checked.why });
          return mark(key, def.wire.fault.make(key, "invalid", { side: "client" }, traceId));
        }
        load(def.made[key]!, meta).set(checked.value);
        mark(key, null);
      };

      /** One round of a key's stream, until it ends: the fault it ended with, or null. */
      const round = async (key: string, first: () => void): Promise<RemoteFault | null> => {
        const done = new AbortController();
        try {
          const values = (await run(
            def.wire[key] as never,
            { input: null } as never,
            reading as never,
          )) as AsyncIterable<unknown> & {
            readonly meta?: Record<string, string>;
            stop(reason?: unknown): void;
          };

          // The loop's signal stops the stream; the listener goes with the round, so rounds do
          // not pile listeners on the signal. (Before ADR 0169, the run's own signal ended the
          // stream when the call returned.)
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
       * Keeps a key fresh: its rpc stream, again after it ends or its link breaks, with back-off
       * while faulted (as EventSource retry). A stream's first push is the value now, so a reopen
       * is the catch-up read. Any other fault is the server's answer, and the same open gives it
       * again: the key keeps its fault and waits for an `invalidate` that names it (ADR 0140).
       * `first` settles on the first value or fault; so does each `invalidate` that comes before
       * the stream has a value. One that comes while an open ends on an answer opens it again.
       */
      const loop = async (key: string, first: () => void) => {
        const mine = askersOf(def.made[key]);
        const asked = [first];
        let live = false;
        let wake = () => {};
        const asker = () =>
          new Promise<void>((done) => (live ? done() : (asked.push(done), wake())));
        /** Waits for an `invalidate`, or the stop; at once if one came while the stream opened. */
        const asleep = () => asked.length || new Promise<void>((woken) => (wake = woken));

        mine.add(asker);
        signal.addEventListener("abort", () => wake());
        for (let wait = 50; !signal.aborted;) {
          const before = asked.length;
          const ended = await round(key, () => {
            live = true;
            callAll(asked);
          });
          live = false;
          if (ended) mark(key, ended);
          callAll(asked.splice(0, before));
          if (signal.aborted) break;

          if (ended && ended.fault !== "link") {
            await asleep();
            continue;
          }
          wait = Object.hasOwn(faults.get(), key) ? Math.min(wait * 2, 5000) : 50;
          await clock.sleep(wait, signal).catch(() => undefined);
        }
        mine.delete(asker);
        callAll(asked);
      };

      return { mark, set, round, loop };
    };

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
     * A client's keyed key: the first reader of a part joins it, as a stream whose signals each
     * ask for what they name; the last reader leaves it, and the part's members go, except those
     * another part in use still holds (ADR 0137, 0138).
     */
    const readKeyed = (
      def: Def,
      event: StartEvent,
      key: string,
      mark: (k: string, e: RemoteFault | null) => void,
      states: States,
    ) => {
      const { run, clock, signal, log, config } = event;
      const every = (config.refetchInterval as { value?: Record<string, number> }).value?.[key];
      const cell = event.load(def.made[key]!, meta) as unknown as Keyed;
      const joined = new Map<string, Joined>();
      /** Sets the state of a part, and of each part in use that it holds whole. With `member`, it
       * also reaches each part in use that holds a member of it: an ask's fault is a fault of
       * every part it asked for, but one member does not make a part ready, and a part's stream
       * fault is that part's own (ADR 0139 4). A part that waits on a fault, or rides one that
       * does, keeps its fault until a trigger. */
      const stand = (asked: Ask, now: PartState, member?: boolean) => {
        if (signal.aborted) return;
        for (const j of joined.values()) {
          if ((j.rides ?? j).wake) continue;
          if (reaches(asked, j.ask, member)) states.set({ ...now, at: partSlot(key, j.ask) });
        }
      };
      /** Whether `stand` reaches a part in use. A window reaches only itself (ADR 0139 2). */
      const reaches = (asked: Ask, part: Ask, member?: boolean) =>
        shares(asked, part) && (member || asked.window || holds(asked, part.part));
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
            (error: unknown) => ({ error }),
          );
        pending.delete(entry);
        if (!newer(part) && inUse(entry.ask)) apply(entry.ask, got);

        await Promise.all(entry.later.map((l) => l.done));
      };

      /**
       * Puts one answer in the cell, or its fault in `board.faults`. A fault also puts each part in
       * use that holds a member of the ask in fault; an answer makes ready only the parts the ask
       * holds whole (ADR 0139 4). When each part it is for waits on a fault, or rides one that
       * does (its cover is among them), only a broken link gets in: the backend heals a link, so
       * it wakes them and their streams open again. Any other answer leaves them waiting (ADR 0139
       * 4, 0141).
       */
      const apply = (asked: Ask, got: (() => void) | { error: unknown }) => {
        const parts = [...joined.values()].filter((j) => narrowed(j.ask, asked.part));
        const parked = parts.every((j) => j.rides || j.wake);
        try {
          if ("error" in got) throw got.error;
          if (parked) return;
          got();
          mark(key, null);
          stand(asked, { status: "ready" });
        } catch (error) {
          const at = partSlot(key, asked);
          const fault = def.wire.fault.is(error)
            ? error
            : def.wire.fault.make(at, "invalid", { side: "client" }, undefined);
          if (parked && fault.fault !== "link") return;

          if (parked) parts.forEach((j) => j.wake?.());
          mark(key, fault);
          stand(asked, { status: "fault", fault }, true);
        }
      };

      /** `invalidate` here: ask again for the dirty share of each part in use, once each. A part
       * that waits on a fault asks nothing here: the await ends with its new stream's first ask,
       * or that stream's fault, or nothing when the part leaves (ADR 0147 d4). */
      const reask = async (dirty: Data.Key) => {
        const asks = new Map<string, Ask>();
        const woken: Promise<void>[] = [];
        for (const j of joined.values()) {
          const share = j.rides ? undefined : narrowed(j.ask, dirty);
          // A part that waits on a fault opens again: the new stream's first signal asks.
          if (share && j.wake) woken.push(new Promise(j.wake));
          else if (share) asks.set(partSlot(key, share), share);
        }
        await Promise.all([...asks.values()].map((a) => ask(a)).concat(woken));
      };
      askersOf(def.made[key]).add(reask);

      /** Waits until a trigger wakes the part, or the part leaves; gives the waking `invalidate`'s
       * resolve, if any. The wake clears itself, so the part counts as awake at once, before its
       * stream opens again. */
      const parked = (part: Joined) =>
        new Promise<Heard>((woken) => {
          part.wake = (heard = () => {}) => {
            part.wake = undefined;
            woken(heard);
          };
          part.stop.signal.addEventListener("abort", () => part.wake?.(), { once: true });
        });

      const follow = async (part: Joined) => {
        let heard: Heard = () => {};
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
            if (part.stop.signal.aborted) signals.stop();
            for await (const dirty of signals) heard(ask(dirty, { meta: signals.meta }));
            wait = 50;
          } catch (error) {
            if (part.stop.signal.aborted) break;
            const fault = faultOf(def, key, error, log);
            mark(key, fault);
            stand(part.ask, { status: "fault", fault });
            heard();

            // Only a broken link heals by itself. Any other fault is the server's answer, and the
            // same ask gives it again: the part waits for a trigger (ADR 0139 4).
            if (fault.fault !== "link") {
              heard = await parked(part);
              wait = 50;
              continue;
            }
            wait = Math.min(wait * 2, 5000);
          }
          await clock.sleep(wait, part.stop.signal).catch(() => undefined);
        }
        heard();
      };

      /** A part in use that holds every member of this part, if any. */
      const coverOf = (asked: Ask) =>
        [...joined.values()].find(
          (j) => j.ask !== asked && !j.ask.window && !asked.window && holds(j.ask, asked.part),
        );

      /** A part asks again each `ms` while it is in use, as TanStack's `refetchInterval`. A part
       * that waits on a fault wakes: the time is a trigger (ADR 0139 3, 4). */
      const tick = async (part: Joined, ms: number) => {
        for (;;) {
          await clock.sleep(ms, part.stop.signal);
          void (part.wake ? part.wake() : ask(part.ask));
        }
      };

      /** A part's own stream, until the part leaves or the root closes. */
      const own = (part: Joined) => {
        signal.addEventListener("abort", () => part.stop.abort(), {
          once: true,
          signal: part.stop.signal,
        });
        void follow(part);
        if (every) tick(part, every).catch(() => undefined);
      };

      /** One holder of a part: a reader of the part, or a watch of its status (ADR 0164). */
      const use = (read: "of" | "where", part: Data.Key, window?: Ask["window"]) => {
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
      };
      cell.listen(use);
      return use;
    };

    /** Read: fill every cell from the backend, then keep it fresh. */
    const readStart = async (def: Def, event: StartEvent) => {
      const { config, raise, next, load } = event;
      if (!config.read.present) return raise("MissingConfig", { label: name, key: "read" });

      // A fault on the first value does not fail start: the cell keeps its initial value, and
      // `board.faults` shows the fault.
      const keys = reader(def, event);
      const states = load(def.states, meta) as unknown as States;
      const uses = new Map(
        [...def.keyed].map((key) => [key, readKeyed(def, event, key, keys.mark, states)]),
      );
      states.listen((_, part) => {
        const { key, read } = part[holding];
        return uses.get(key)!(read.read, read.part, read.window);
      });
      await keep(def, keys);
      return next();
    };

    return {
      serveStart,
      watch,
      watchPart,
      answerPart,
      changed,
      /** `invalidate`: signal the readers on a serving root; ask again on a reading root. A
       * serving root runs no reading loop, so it has no asker. */
      invalidate: (def: Def, own: Served | null, key: string, dirty: Data.Key) => {
        if (own) dirtyOn(own, key, dirty);
        return Promise.all([...askersOf(def.made[key])].map((ask) => ask(dirty)));
      },
      readStart,
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
export function remoteData<const D extends Cells>(cells: D) {
  const keys = Object.keys(cells) as (keyof D & string)[];
  const keyed = new Set(keys.filter((key) => cells[key]!.mode === "keyed"));
  const taken = keys.filter((key) => reserved.includes(key));
  if (taken.length) throw new Error(`remoteData: ${taken.join(", ")} is a reserved key`);

  const keyOf = new Map<unknown, string>(keys.map((key) => [cells[key], key]));
  /** This definition's own cells: same shape, new identity. */
  const made = Object.fromEntries(keys.map((key) => [key, remake(cells[key]!)])) as unknown as D;

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
          : [[key, { mode: "stream" as const, input: z.null(), output: z.unknown() }]],
      ),
    ),
    { label: name },
  ) as unknown as Wire &
    ((values: unknown) => Capsule.Installable) & {
      readonly answer: Answer;
      readonly stream: Stream;
    };

  const serveKey = tag<true>({ label: `${name}.serve` });
  const loadKey = tag<Load>({ label: `${name}.load` });
  const readKey = tag<Read>({ label: `${name}.read` });
  const refetchKey = tag<Readonly<Record<string, number | undefined>>>({
    label: `${name}.refetchInterval`,
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
                input: z.null(),
                depends: { out: channel, own: state, s: steps },
                run: ({ out, own, s }) => s.watch(own!, key, out),
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
   * use asks again; the call resolves once the answers are in the cell (ADR 0137 2). A plain
   * key, `{ notes: {} }`, opens again on a reading root if it ended on an answer (ADR 0140).
   */
  const invalidate = operation({
    label: `${name}.invalidate`,
    input: z.make<Dirty<D>>((value) => {
      const entries = Object.entries(Object(value) as object);
      const fit = entries.every(([key, part]) => keys.includes(key) && isKey(part));
      return fit ? { value: value as Dirty<D> } : z.fail("expected keys and parts");
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
      load: loadKey.optional,
      read: readKey.optional,
      refetchInterval: refetchKey.optional,
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

      write({ cell, value, next, load, run, log }) {
        const key = keyOf.get(cell);
        if (key === undefined) return next();
        const served = load(state, meta).get();
        if (!served) return next(); // a reading root: nothing to push
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
    /** The state of a keyed read's part (ADR 0139 1): `useData(board.status(read))`. A watch of
     * it holds the part, as a reader does; a `get()` holds nothing (ADR 0164). Undefined while
     * no one holds the part. */
    status: (read: Data.Read<unknown>) => {
      const key = Object.keys(made).find((k) => made[k] === read.cell)!;
      const watched: StatusKey = { at: partSlot(key, read), [holding]: { key, read } };
      return states.of(watched);
    },
    addresses: keys.flatMap((key) => (keyed.has(key) ? [key, `${key}.ask`] : [key])),
    // A cell with no label says nothing: the transport then names the board, "remoteData".
    names: (address: string) => cells[address.replace(/\.ask$/, "")]?.label.replace(/^anon$/, ""),
    answer: wire.answer,
    stream: wire.stream,
  }) as unknown as Omit<Base, never> &
    Capsule.Shown<D & { faults: typeof faults }> & {
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
