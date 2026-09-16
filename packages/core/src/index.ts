import { isError, raise } from "./errors.ts";

const cell: unique symbol = Symbol("data");
const command: unique symbol = Symbol("operation");
const tagSym: unique symbol = Symbol("tag");
const edge: unique symbol = Symbol("edge");
const resourceSym: unique symbol = Symbol("resource");
const presetSym: unique symbol = Symbol("preset");

/** A declared dependency edge: a mode (`controller`, `required`, `optional`, `all`) onto a target. */
export type Edge<K extends string, Target> = {
  readonly [edge]: true;
  readonly kind: K;
  readonly target: Target;
};

export declare namespace Data {
  /** Validates raw input into a trusted value once, at the process edge. */
  export type Parse<T> = (raw: unknown) => T;

  /** A reactive value cell — the only reactive unit. */
  export type Cell<T> = {
    readonly [cell]: true;
    readonly label: string;
    readonly initial: T;
    readonly parse: Parse<T> | undefined;
    eq(a: T, b: T): boolean;
    /** Static metadata bindings, read off the handle (never affects resolution). */
    readonly meta: readonly Tag.Binding<unknown>[];
    /** Depend on this cell in write mode: delivered as a controller. */
    readonly controller: Edge<"controller", Cell<T>>;
  };
}

export declare namespace Tag {
  /** The result of reading a tag that may be absent. */
  export type Presence<T> =
    | { readonly present: true; readonly value: T }
    | { readonly present: false };

  /** One value bound to a tag, seeded on a scope. `Handle<any>` is the callable-variance escape hatch. */
  export type Binding<T> = { readonly tag: Handle<any>; readonly value: T };

  /** Any unit carrying static metadata bindings (data/operation/resource/tag). */
  export type Metaed = { readonly meta: readonly Binding<unknown>[] };

  /** Ambient metadata read through the scope chain. Callable to bind a value. */
  export type Handle<T> = {
    readonly [tagSym]: true;
    readonly label: string;
    readonly hasDefault: boolean;
    readonly def: T | undefined;
    readonly parse: Data.Parse<T> | undefined;
    eq(a: T, b: T): boolean;
    /** Static metadata bindings on the tag itself (a tag can be tagged). */
    readonly meta: readonly Binding<unknown>[];
    readonly required: Edge<"required", Handle<T>>;
    readonly optional: Edge<"optional", Handle<T>>;
    readonly all: Edge<"all", Handle<T>>;
    /** Read this tag's static value off a unit's `meta` (nearest binding, else default, else absent). */
    read(unit: Metaed): Presence<T>;
    (value: T): Binding<T>;
  };
}

export declare namespace Observe {
  /** What opened a span: resolving an operation or a resource, or a manual `ctx.obs.child`. */
  export type Kind = "operation" | "resource" | "manual";
  /** A point-in-time note attached to a span. */
  export type Event = {
    readonly name: string;
    readonly time: number;
    readonly attributes: Record<string, unknown>;
  };
  /** One unit of tracked work; nests by explicit `parentId` into a tree. Behavior-neutral. */
  export type Span = {
    readonly id: number;
    readonly parentId: number | undefined;
    readonly name: string;
    readonly kind: Kind;
    readonly start: number;
    end: number | undefined;
    status: "ok" | "failed" | undefined;
    readonly attributes: Record<string, unknown>;
    readonly events: Event[];
  };
  /** A log line, carrying the span it was written under (if any). */
  export type Log = {
    readonly time: number;
    readonly message: string;
    readonly attributes: Record<string, unknown>;
    readonly span: Span | undefined;
  };
  /** Seeded on a scope; every switch is independent. Off (absent, or no `export`/`history`)
   * costs one boolean and allocates no spans. `clock` is injected for deterministic tests. */
  export type Config = {
    readonly clock?: () => number;
    readonly export?: (span: Span) => void;
    readonly history?: number;
    readonly log?: (entry: Log) => void;
  };
  /** The observation receiver on a ctx: the current span, plus manual span/event openers. */
  export type Ctx = {
    readonly span: Span | undefined;
    event(name: string, attributes?: Record<string, unknown>): void;
    child<T>(name: string, fn: (span: Span | undefined) => T): T;
  };
}

export declare namespace Operation {
  /** The receiver a command body reads its own invocation through. `signal` aborts when the owning
   * scope/session closes (hand it to `fetch`/an SDK); `defer` runs one hook when the run settles. */
  export type Ctx<I> = {
    readonly label: string;
    readonly rawInput: unknown;
    readonly input: I;
    readonly signal: AbortSignal;
    readonly defer: (fn: (end: Scope.End) => void | PromiseLike<void>) => void;
    readonly obs: Observe.Ctx;
    readonly log: (message: string, attributes?: Record<string, unknown>) => void;
  };

  /** A command: typed input, declared deps, runs on each resolve. Not reactive, not memoized. */
  export type Command<T, I> = {
    readonly [command]: true;
    readonly label: string;
    readonly input: Data.Parse<I> | undefined;
    readonly depends: Scope.Depends;
    run(deps: Record<string, unknown>, ctx: Ctx<I>): T;
    /** Static metadata bindings, read off the handle (never affects resolution). */
    readonly meta: readonly Tag.Binding<unknown>[];
    /** Depend on this command: delivered as a callable controller. */
    readonly controller: Edge<"controller", Command<T, I>>;
  };
}

export declare namespace Resource {
  /** The receiver a resource factory builds through: `defer` registers one end-hook (commit/roll
   * back/release when the owner settles or the resource is released); `signal` aborts on close. */
  export type Ctx = {
    readonly label: string;
    readonly defer: (fn: (end: Scope.End) => void | PromiseLike<void>) => void;
    readonly signal: AbortSignal;
    readonly obs: Observe.Ctx;
    readonly log: (message: string, attributes?: Record<string, unknown>) => void;
  };

  /** A reusable built instance. `target` picks the owning layer: `scope` = one per chain
   * (owner is the root), `session` = one per session (owner is the requesting layer). */
  export type Handle<T> = {
    readonly [resourceSym]: true;
    readonly label: string;
    readonly target: "scope" | "session";
    readonly depends: Scope.Depends;
    factory(deps: Record<string, unknown>, ctx: Ctx): T;
    /** Static metadata bindings, read off the handle (never affects resolution). */
    readonly meta: readonly Tag.Binding<unknown>[];
  };
}

export declare namespace Scope {
  /** What a resource delivers: an async factory is normalized to a plain `Promise<value>`,
   * so the extra shape of a returned thenable never leaks into the caller's type. */
  export type ResourceValue<T> = T extends PromiseLike<unknown> ? Promise<Awaited<T>> : T;

  /** A build-once handle onto one resource instance. */
  export type ResourceController<T> = {
    resolve(): ResourceValue<T>;
    get(): ResourceValue<T>;
  };

  /** A read/write handle onto one cell. */
  export type DataController<T> = {
    get(): T;
    read(): T;
    set(value: T): void;
    update(fn: (previous: T) => T): void;
    watch(listener: (next: T) => void): () => void;
  };

  /** How a subflow call is supplied (ADR 0022): a pre-typed `input` (parse skipped), or a raw
   * `rawInput` (run through the operation's parse), plus per-call ambient tag bindings that
   * overlay the caller's for this one invocation. A defined `input` wins; an `undefined` `input`
   * counts as absent, so `rawInput` is parsed instead. */
  export type Invocation<I> = {
    readonly input?: I;
    readonly rawInput?: unknown;
    readonly tags?: readonly Tag.Binding<unknown>[];
  };

  /** An invocation that carries an input — exactly one of `input` or `rawInput`, never both and
   * never an `undefined` input smuggled in beside a `rawInput`. */
  export type ProvideInput<I> =
    | {
        readonly input: I;
        readonly rawInput?: never;
        readonly tags?: readonly Tag.Binding<unknown>[];
      }
    | {
        readonly input?: never;
        readonly rawInput: unknown;
        readonly tags?: readonly Tag.Binding<unknown>[];
      };

  /** The `resolve` argument list for input `I`: a genuinely void input is callable with no
   * argument; anything else (including a `never`-typed parse) must supply `input` or `rawInput`.
   * `never` is excluded from the void case first — `[never] extends [void]` is otherwise true. */
  export type CallArgs<I> = [I] extends [never]
    ? [call: ProvideInput<I>]
    : [I] extends [void]
      ? [call?: Invocation<I>]
      : [call: ProvideInput<I>];

  /** A callable handle onto one command — always a function, never a value (ADR 0022). A
   * void-input operation is called `resolve()`; an input-carrying one must supply `input` or
   * `rawInput`. */
  export type CommandController<T, I> = {
    resolve(...call: CallArgs<I>): T;
  };

  export type Dependency =
    | Data.Cell<unknown>
    | Operation.Command<unknown, unknown>
    | Resource.Handle<unknown>
    | Tag.Handle<any>
    | Edge<"controller", Data.Cell<unknown> | Operation.Command<unknown, unknown>>
    | Edge<"required" | "optional" | "all", Tag.Handle<any>>;
  export type Depends = Readonly<Record<string, Dependency>>;

  /** Maps one declared dependency to the value delivered in `deps` — exact, no casts in userland.
   * A bare command is a subflow (a callable controller); a bare resource is its built instance. */
  export type SlotValue<D> =
    D extends Edge<"controller", infer N>
      ? N extends Data.Cell<infer T>
        ? DataController<T>
        : N extends Operation.Command<infer T, infer I>
          ? CommandController<T, I>
          : never
      : D extends Edge<"all", Tag.Handle<infer T>>
        ? T[]
        : D extends Edge<"optional", Tag.Handle<infer T>>
          ? Tag.Presence<T>
          : D extends Edge<"required", Tag.Handle<infer T>>
            ? T
            : D extends Tag.Handle<infer T>
              ? T
              : D extends Data.Cell<infer T>
                ? T
                : D extends Operation.Command<infer T, infer I>
                  ? CommandController<T, I>
                  : D extends Resource.Handle<infer T>
                    ? ResourceValue<T>
                    : never;
  export type SlotValues<D extends Depends> = { [K in keyof D]: SlotValue<D[K]> };

  /** A test-only substitution of a node's realization, seen by downstream consumers (ADR 0015). */
  export type Preset = {
    readonly [presetSym]: true;
    readonly node: unknown;
    readonly replacement: unknown;
  };

  /** Values seeded on a scope at creation. */
  export type Options = {
    tags?: readonly Tag.Binding<unknown>[];
    observe?: Observe.Config;
    presets?: readonly Preset[];
  };

  /** How a scope settled: cleanly, by an inside-out failure, or as a cancellation. */
  export type Outcome =
    | { readonly status: "success" }
    | { readonly status: "failed"; readonly error?: unknown }
    | { readonly status: "cancelled" };

  /** Why a lifetime ended, delivered to `ctx.defer`. A layer settles with an {@link Outcome}; an
   * individually released resource ends `released` while its layer lives on. */
  export type End = Outcome | { readonly status: "released" };

  /** How to shut a scope down (ADR 0028) — a mode, NOT a wished outcome. Forced (the default) aborts
   * `ctx.signal` to stop in-flight work now; graceful lets it finish first. The outcome is a
   * consequence of the mode and what actually happened, read from the {@link Result}. */
  export type CloseOptions = { readonly graceful?: boolean };

  /** What `close()` resolves to — the ACTUAL settled state, never a thrown error (ADR 0027/0028).
   * `teardownErrors` (defer/cleanup throws, in execution order) may accompany any status. */
  export type Result =
    | { readonly status: "success"; readonly teardownErrors?: readonly unknown[] }
    | {
        readonly status: "cancelled";
        readonly reason: unknown;
        readonly teardownErrors?: readonly unknown[];
      }
    | {
        readonly status: "failed";
        readonly error: unknown;
        readonly teardownErrors?: readonly unknown[];
      };

  /** What `createScope()` returns: the one seam tests and callers touch. */
  export type Handle = {
    getController<T>(target: Data.Cell<T>): DataController<T>;
    getController<T>(target: Resource.Handle<T>): ResourceController<T>;
    getController<T, I>(target: Operation.Command<T, I>): CommandController<T, I>;
    /** Open a child session: it inherits this scope's data and tags, and shadows on write. */
    createSession(options?: Options): Handle;
    /** Run `fn` in a fresh child session: normal return = success, a thrown error = failed(cause),
     * an external forced close while it runs = cancelled. The session auto-closes when `fn` settles;
     * the primary cause is thrown, hook errors aggregated (ADR 0017). */
    session<R>(fn: (scope: Handle) => R | PromiseLike<R>): Promise<R>;
    session<R>(options: Options, fn: (scope: Handle) => R | PromiseLike<R>): Promise<R>;
    /** Reset a node: a data cell reverts to its inherited/initial value and notifies
     * watchers; a resource runs its cleanup, drops its instance, and a re-resolve rebuilds
     * a fresh generation (a late build from the released generation never publishes). */
    release(target: Data.Cell<unknown> | Resource.Handle<unknown>): void;
    /** Register a userland teardown hook, run (LIFO) when this scope closes. */
    onClose(fn: () => void | PromiseLike<void>): void;
    /** The retained span history (bounded by `observe.history`; empty when observation is off). */
    spans(): readonly Observe.Span[];
    /** Resolve once all in-flight command work owned by this scope has settled. */
    settled(): Promise<void>;
    /** Shut this scope down: close children first, join owned work, run outcome hooks then cleanup,
     * then seal. `opts.graceful` lets in-flight work finish; the default (forced) aborts it now
     * ({@link CloseOptions}, ADR 0028). Always resolves to a {@link Result} describing the actual
     * settled state + any teardown errors — never throws (0027). */
    close(opts?: CloseOptions): Promise<Result>;
  };
}

const isData = (n: unknown): n is Data.Cell<unknown> =>
  (n as { [cell]?: true } | null | undefined)?.[cell] === true;
const isCommand = (n: unknown): n is Operation.Command<unknown, unknown> =>
  (n as { [command]?: true } | null | undefined)?.[command] === true;
const isResource = (n: unknown): n is Resource.Handle<unknown> =>
  (n as { [resourceSym]?: true } | null | undefined)?.[resourceSym] === true;
const isTag = (n: unknown): n is Tag.Handle<unknown> =>
  (n as { [tagSym]?: true } | null | undefined)?.[tagSym] === true;
const isEdge = (n: unknown): n is Edge<string, unknown> =>
  (n as { [edge]?: true } | null | undefined)?.[edge] === true;
const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v &&
  (typeof v === "object" || typeof v === "function") &&
  typeof (v as { then?: unknown }).then === "function";

const edgeTo = <K extends string, N>(kind: K, target: N): Edge<K, N> => ({
  [edge]: true,
  kind,
  target,
});

/** Admit a raw value through a parser once; parse failures become a registry error. */
function admit<T>(label: string, parse: Data.Parse<T> | undefined, raw: unknown): T {
  if (!parse) return raw as T;
  try {
    return parse(raw);
  } catch (cause) {
    raise("DataValidationFailed", { label, cause });
  }
}

/** The shared, frozen empty meta for units declared without any — immutable so no caller can
 * reach past the `readonly` type and leak a binding across every no-meta unit. */
const NO_META: readonly Tag.Binding<unknown>[] = Object.freeze([]);

/** Read a tag's static value off a unit's `meta`: the nearest matching binding, else the tag's
 * default, else absent. Static (no scope chain) — this is definition-time metadata. */
function metaFind<T>(unit: Tag.Metaed, target: Tag.Handle<T>): Tag.Presence<T> {
  for (let i = unit.meta.length - 1; i >= 0; i--) {
    const binding = unit.meta[i];
    if (binding.tag === target) return { present: true, value: binding.value as T };
  }
  return target.hasDefault ? { present: true, value: target.def as T } : { present: false };
}

/** Declare a reactive value cell. `parse` validates the initial value once. */

export function data<T>(config: {
  label?: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
  meta?: readonly Tag.Binding<unknown>[];
}): Data.Cell<T> {
  const label = config.label ?? "anon";
  const base = {
    [cell]: true,
    label,
    initial: admit(label, config.parse, config.initial),
    parse: config.parse,
    eq: config.eq ?? Object.is,
    meta: config.meta ?? NO_META,
  } as Data.Cell<T>;
  return Object.assign(base, { controller: edgeTo("controller", base) });
}

/** Declare an ambient tag. Call it to bind a value; read it via `.required`/`.optional`/`.all`. */
export function tag<T>(config: {
  label: string;
  default?: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
  meta?: readonly Tag.Binding<unknown>[];
}): Tag.Handle<T> {
  const parse = config.parse;
  const label = config.label;
  const bind = (value: T): Tag.Binding<T> => ({
    tag: handle,
    value: admit(label, parse, value),
  });
  const handle = Object.assign(bind, {
    [tagSym]: true as const,
    label,
    hasDefault: "default" in config,
    def: config.default,
    parse,
    eq: config.eq ?? Object.is,
    meta: config.meta ?? NO_META,
    read: (unit: Tag.Metaed): Tag.Presence<T> => metaFind(unit, handle),
  }) as Tag.Handle<T>;
  return Object.assign(handle, {
    required: edgeTo("required", handle),
    optional: edgeTo("optional", handle),
    all: edgeTo("all", handle),
  });
}

/** Declare a command: a function with typed input that runs on each resolve. */
export function operation<
  const D extends Scope.Depends = Record<string, never>,
  R = unknown,
  I = void,
>(config: {
  label: string;
  input?: Data.Parse<I>;
  depends?: D;
  run: (deps: Scope.SlotValues<D>, ctx: Operation.Ctx<I>) => R;
  meta?: readonly Tag.Binding<unknown>[];
}): Operation.Command<R, I> {
  const base = {
    [command]: true,
    label: config.label,
    input: config.input,
    depends: config.depends ?? {},
    run: config.run as Operation.Command<R, I>["run"],
    meta: config.meta ?? NO_META,
  } as Operation.Command<R, I>;
  return Object.assign(base, { controller: edgeTo("controller", base) });
}

/** Declare a reusable resource: built once per owner, cleaned up when its owner closes. */
export function resource<
  const D extends Scope.Depends = Record<string, never>,
  T = unknown,
>(config: {
  label: string;
  target?: "scope" | "session";
  depends?: D;
  factory: (deps: Scope.SlotValues<D>, ctx: Resource.Ctx) => T;
  meta?: readonly Tag.Binding<unknown>[];
}): Resource.Handle<T> {
  return {
    [resourceSym]: true,
    label: config.label,
    target: config.target ?? "scope",
    depends: config.depends ?? {},
    factory: config.factory as Resource.Handle<T>["factory"],
    meta: config.meta ?? NO_META,
  } as Resource.Handle<T>;
}

/** Test-only: substitute a node's realization for downstream consumers of a scope (ADR 0015).
 * A `data` value is validated through `parse`; a command takes a replacement `run`; a resource
 * takes a replacement `factory` (built and torn down like the real one). Seed via
 * `createScope({ presets: [preset(node, ...)] })`. The replacement's `deps` are delivered
 * untyped (a `Record<string, unknown>`, like the real factory) — narrow at use. A `void`-returning
 * resource is the one shape whose async/sync parity the type cannot enforce; don't preset one async. */
export function preset<T>(node: Data.Cell<T>, value: T): Scope.Preset;
export function preset<T, I>(
  node: Operation.Command<T, I>,
  run: (deps: Record<string, unknown>, ctx: Operation.Ctx<I>) => T,
): Scope.Preset;
export function preset<T>(
  node: Resource.Handle<T>,
  factory: (deps: Record<string, unknown>, ctx: Resource.Ctx) => T,
): Scope.Preset;
export function preset(node: unknown, replacement: unknown): Scope.Preset {
  return { [presetSym]: true, node, replacement } as Scope.Preset;
}

type Entry = { value: unknown };
/** A releasable node: a data cell or a resource. Release cascades from a node to its dependents. */
type Node = Data.Cell<unknown> | Resource.Handle<unknown>;
type Watcher = {
  read: () => unknown;
  last: unknown;
  eq: (a: unknown, b: unknown) => boolean;
  fn: (next: unknown) => void;
};
/** An end-hook (`ctx.defer`) tagged with the resource that registered it (undefined = userland
 * `onClose`), so `release` can drop exactly one resource's hooks without touching others. Kept in
 * registration order; teardown runs them in reverse (ADR 0026). */
type DeferEntry = {
  fn: (end: Scope.End) => void | PromiseLike<void>;
  resource: Resource.Handle<unknown> | undefined;
};

/** All per-node state for one layer, colocated in a single record so a scope allocates ONE Map
 * (`Layer.nodes`) instead of a dozen parallel ones — one `Map.get(node)` fetches everything.
 * A CLASS (not `{}` grown field-by-field) so every record shares one V8 hidden class: compact
 * allocation and monomorphic field access on the hot paths. */
class NodeState {
  /** This layer's own data-cell shadow (copy-on-write). */
  cell: Entry | undefined = undefined;
  /** Memoized nearest cell up the chain; `effSet` distinguishes "not computed" from "computed=absent". */
  eff: Entry | undefined = undefined;
  effSet = false;
  /** Built resource instance. */
  resource: Entry | undefined = undefined;
  /** In-flight async build. */
  build: Promise<unknown> | undefined = undefined;
  /** Resource generation (bumped on invalidation to supersede a late build). */
  gen = 0;
  /** Build currently in progress (circular-resource guard). */
  building = false;
  /** In-flight op promises borrowing this resource (release waits on them). */
  borrowers: Set<Promise<unknown>> | undefined = undefined;
  /** Resources that depend on this node (for cascade release/close). */
  dependents: Set<Resource.Handle<unknown>> | undefined = undefined;
  /** Memoized controller: the public `getController` path always passes an undefined observation
   * span, so a controller for (layer, node) is stable — reuse it instead of reallocating closures. */
  controller: unknown = undefined;
}

/** Get-or-create this layer's record for a node. */
function nodeState(layer: Layer, key: object): NodeState {
  let s = layer.nodes.get(key);
  if (s === undefined) {
    s = new NodeState();
    layer.nodes.set(key, s);
  }
  return s;
}

/** A resource's current generation at its owner (0 if never invalidated). */
function genOf(owner: Layer, target: object): number {
  return owner.nodes.get(target)?.gen ?? 0;
}

/** One layer of the scope chain. A session is a child layer. */
type Layer = {
  parent: Layer | undefined;
  children: Set<Layer>;
  /** Single node-keyed store: cells, effective-cache, resources, builds, generations, build-flag,
   * borrowers, dependents, and cached controllers all live in one {@link NodeState} per node. */
  nodes: Map<object, NodeState>;
  /** Lazily allocated: empty unless the scope was seeded with presets/tags or a watcher was added. */
  presets: Map<unknown, unknown> | undefined;
  tags: Map<Tag.Handle<unknown>, unknown[]> | undefined;
  watchers: Set<Watcher> | undefined;
  pending: Set<Promise<unknown>>;
  defers: DeferEntry[];
  abort: AbortController;
  cancelled: boolean;
  swept: boolean;
  bodyEnd: Promise<Scope.Outcome> | undefined;
  failure: { cause: unknown } | undefined;
  descendantFailure: { cause: unknown } | undefined;
  secondary: unknown[];
  body: Promise<unknown> | undefined;
  closed: boolean;
  closing: Promise<Scope.Result> | undefined;
  obs: Obs;
};

/** Late use of a sealed scope fails loudly. */
function ensureOpen(layer: Layer): void {
  if (layer.closed) raise("Disposed", { reason: "scope is closed" });
}

const eqOf =
  <T>(target: Data.Cell<T>) =>
  (a: unknown, b: unknown): boolean =>
    target.eq(a as T, b as T);

/** The nearest cell up the chain (cached per layer); absent means "use the cell's initial". */
function effectiveEntry(layer: Layer, target: Data.Cell<unknown>): Entry | undefined {
  const self = layer.nodes.get(target);
  if (self?.effSet) return self.eff;
  let found: Entry | undefined;
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const owned = cur.nodes.get(target)?.cell;
    if (owned) {
      found = owned;
      break;
    }
  }
  const s = self ?? nodeState(layer, target);
  s.eff = found;
  s.effSet = true;
  return found;
}

function readCell(layer: Layer, target: Data.Cell<unknown>): unknown {
  const entry = effectiveEntry(layer, target);
  return entry ? entry.value : target.initial;
}

/** Creating a nearer shadow changes the effective cell for this layer and its descendants. */
function invalidateEff(layer: Layer, target: Data.Cell<unknown>): void {
  const s = layer.nodes.get(target);
  if (s) {
    s.eff = undefined;
    s.effSet = false;
  }
  for (const child of layer.children) invalidateEff(child, target);
}

/** Copy-on-write: get or create this layer's own shadow of a cell, seeded from the inherited value. */
function ownCell(layer: Layer, target: Data.Cell<unknown>): Entry {
  const s = nodeState(layer, target);
  if (!s.cell) {
    s.cell = { value: readCell(layer, target) };
    invalidateEff(layer, target);
  }
  return s.cell;
}

/** Fire watchers on this layer, then descendants (inherited reads see the change; shadowed ones don't). */
function flushTree(layer: Layer): void {
  const ws = layer.watchers;
  if (ws)
    for (const w of ws) {
      const next = w.read();
      if (!w.eq(w.last, next)) {
        w.last = next;
        w.fn(next);
      }
    }
  for (const child of layer.children) flushTree(child);
}

function writeCell<T>(layer: Layer, target: Data.Cell<T>, next: unknown): void {
  ensureOpen(layer);
  const value = admit(target.label, target.parse, next);
  if (eqOf(target)(readCell(layer, target), value)) return;
  ownCell(layer, target).value = value;
  flushTree(layer);
}

type TagOverlay = Map<Tag.Handle<unknown>, unknown[]>;

/** The last value of a tag list (its nearest binding), or undefined for an absent/empty list. */
function topTag(list: unknown[] | undefined): { present: true; value: unknown } | undefined {
  return list && list.length ? { present: true, value: list[list.length - 1] } : undefined;
}

function tagFind(
  layer: Layer,
  target: Tag.Handle<unknown>,
  overlay?: TagOverlay,
): Tag.Presence<unknown> {
  const front = topTag(overlay?.get(target));
  if (front) return front;
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const hit = topTag(cur.tags?.get(target));
    if (hit) return hit;
  }
  return target.hasDefault ? { present: true, value: target.def } : { present: false };
}

function tagAll(layer: Layer, target: Tag.Handle<unknown>, overlay?: TagOverlay): unknown[] {
  const out: unknown[] = [];
  const front = overlay?.get(target);
  if (front) for (let i = front.length - 1; i >= 0; i--) out.push(front[i]);
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const list = cur.tags?.get(target);
    if (list) for (let i = list.length - 1; i >= 0; i--) out.push(list[i]);
  }
  return out;
}

function tagRequired(layer: Layer, target: Tag.Handle<unknown>, overlay?: TagOverlay): unknown {
  const found = tagFind(layer, target, overlay);
  if (!found.present) raise("MissingTag", { label: target.label });
  return found.value;
}

/** The nearest preset replacement for a command/resource node up the chain, or undefined. */
function presetFor(layer: Layer, node: unknown): unknown {
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const p = cur.presets;
    if (p?.has(node)) return p.get(node);
  }
  return undefined;
}

function addWatcher(
  layer: Layer,
  read: () => unknown,
  eq: (a: unknown, b: unknown) => boolean,
  fn: (next: unknown) => void,
): () => void {
  ensureOpen(layer);
  const w: Watcher = { read, last: read(), eq, fn };
  (layer.watchers ??= new Set()).add(w);
  return () => void layer.watchers?.delete(w);
}

function dataController<T>(layer: Layer, target: Data.Cell<T>): Scope.DataController<T> {
  const read = (): T => readCell(layer, target) as T;
  return {
    get: read,
    read,
    set: (value: T) => writeCell(layer, target, value),
    update: (fn: (previous: T) => T) => {
      ensureOpen(layer);
      writeCell(layer, target, fn(read()));
    },
    watch: (listener: (next: T) => void) =>
      addWatcher(layer, read as () => unknown, eqOf(target), listener as (next: unknown) => void),
  };
}

function resolveControllerEdge(
  layer: Layer,
  target: unknown,
  parent: Observe.Span | undefined,
): unknown {
  if (isData(target)) return dataController(layer, target);
  if (isCommand(target)) return commandController(layer, target, parent);
  raise("InvalidDependency", { label: "edge", reason: "unknown controller target" });
}

function resolveEdge(
  layer: Layer,
  dep: Edge<string, unknown>,
  parent: Observe.Span | undefined,
  overlay?: TagOverlay,
): unknown {
  if (dep.kind === "controller") return resolveControllerEdge(layer, dep.target, parent);
  const target = dep.target as Tag.Handle<unknown>;
  if (dep.kind === "all") return tagAll(layer, target, overlay);
  if (dep.kind === "optional") return tagFind(layer, target, overlay);
  return tagRequired(layer, target, overlay);
}

function resolveDep(
  layer: Layer,
  dep: Scope.Dependency,
  parent: Observe.Span | undefined,
  overlay?: TagOverlay,
): unknown {
  if (isEdge(dep)) return resolveEdge(layer, dep, parent, overlay);
  if (isData(dep)) return readCell(layer, dep);
  if (isTag(dep)) return tagRequired(layer, dep, overlay);
  if (isCommand(dep)) return commandController(layer, dep, parent);
  if (isResource(dep)) return resourceController(layer, dep, parent).resolve();
  raise("InvalidDependency", { label: "unknown", reason: "unknown dependency" });
}

const noop = (): void => undefined;

/** Attach a rejection handler to a fire-and-forget close so an internally started close (from a
 * teardown hook) is never an unhandled rejection; the promise keeps its rejection for a later
 * external awaiter. */
function ignoreRejection(promise: Promise<unknown>): void {
  return void promise.catch(noop);
}

type Obs = {
  observing: boolean;
  clock: () => number;
  export: ((span: Observe.Span) => void) | undefined;
  historyMax: number;
  history: Observe.Span[];
  log: ((entry: Observe.Log) => void) | undefined;
  nextId: number;
};

const OFF_LOG = (): void => undefined;
const OFF_OBS: Observe.Ctx = {
  span: undefined,
  event: () => undefined,
  child: (_name, fn) => fn(undefined),
};

/** A never-aborted signal for the shared {@link EMPTY_CTX}. */
const IDLE_ABORT = new AbortController();
/** Shared ctx for resource factories that declare no ctx param (arity < 2): they cannot touch it, so
 * skip the per-build allocation. `defer` is unreachable without a declared param, so it fails loudly. */
const EMPTY_CTX: Resource.Ctx = {
  label: "",
  defer: () => raise("Disposed", { reason: "resource factory declared no ctx" }),
  signal: IDLE_ABORT.signal,
  obs: OFF_OBS,
  log: OFF_LOG,
};

function makeObs(config: Observe.Config | undefined): Obs {
  const c: Observe.Config = config ?? {};
  const historyMax = c.history ?? 0;
  return {
    observing: c.export !== undefined || historyMax > 0,
    clock: c.clock ?? Date.now,
    export: c.export,
    historyMax,
    history: [],
    log: c.log,
    nextId: 1,
  };
}

function openSpan(
  obs: Obs,
  parent: Observe.Span | undefined,
  name: string,
  kind: Observe.Kind,
): Observe.Span | undefined {
  if (!obs.observing) return undefined;
  return {
    id: obs.nextId++,
    parentId: parent?.id,
    name,
    kind,
    start: obs.clock(),
    end: undefined,
    status: undefined,
    attributes: {},
    events: [],
  };
}

function isolate(run: () => unknown): void {
  try {
    const result = run();
    if (isThenable(result)) ignoreRejection(Promise.resolve(result));
  } catch (error) {
    void error;
  }
}

function closeSpan(obs: Obs, span: Observe.Span | undefined, status: "ok" | "failed"): void {
  if (!span || span.end !== undefined) return;
  span.end = obs.clock();
  span.status = status;
  if (obs.historyMax > 0) {
    obs.history.push(span);
    if (obs.history.length > obs.historyMax) obs.history.shift();
  }
  const sink = obs.export;
  if (sink) isolate(() => sink(span));
}

function settleSpan(obs: Obs, span: Observe.Span, result: unknown): void {
  if (!(result instanceof Promise)) {
    closeSpan(obs, span, "ok");
    return;
  }
  ignoreRejection(
    result.then(
      () => closeSpan(obs, span, "ok"),
      () => closeSpan(obs, span, "failed"),
    ),
  );
}

function obsCtx(obs: Obs, span: Observe.Span | undefined): Observe.Ctx {
  if (!span) return OFF_OBS;
  return {
    span,
    event: (name, attributes) => {
      span.events.push({ name, time: obs.clock(), attributes: attributes ?? {} });
    },
    child: (name, fn) => {
      const child = openSpan(obs, span, name, "manual");
      let result: unknown;
      try {
        result = fn(child);
      } catch (error) {
        closeSpan(obs, child, "failed");
        throw error;
      }
      if (child) settleSpan(obs, child, result);
      return result as ReturnType<typeof fn>;
    },
  };
}

function logFor(
  obs: Obs,
  span: Observe.Span | undefined,
): (message: string, attributes?: Record<string, unknown>) => void {
  const sink = obs.log;
  if (!sink) return OFF_LOG;
  return (message, attributes) =>
    isolate(() => sink({ time: obs.clock(), message, attributes: attributes ?? {}, span }));
}

function recordUsed(
  obs: Obs,
  caller: Observe.Span | undefined,
  target: Resource.Handle<unknown>,
): void {
  if (caller) {
    caller.events.push({ name: "used", time: obs.clock(), attributes: { resource: target.label } });
  }
}

/** Track owned async work so `settled()`/`close` join it. `onReject` decides where a rejection
 * goes: the owner's primary failure (commands, current-generation builds) or the secondary
 * bucket (release/abandoned cleanups) which never changes the outcome (ADR 0017). */
function track(
  layer: Layer,
  result: unknown,
  onReject: (error: unknown) => void,
  onSettle?: (status: "ok" | "failed", error?: unknown) => void,
): void {
  if (!isThenable(result)) {
    onSettle?.("ok");
    return;
  }
  const tracked: Promise<unknown> = Promise.resolve(result).then(
    () => {
      layer.pending.delete(tracked);
      onSettle?.("ok");
    },
    (error: unknown) => {
      layer.pending.delete(tracked);
      onReject(error);
      onSettle?.("failed", error);
    },
  );
  layer.pending.add(tracked);
}

/** Every abort reason we mint carries this brand, so a rejection can be recognized as one of OUR
 * cancellations regardless of WHICH layer's abort produced it — a cancelled child rejects with its
 * own reason, and its awaiting parent must still read that as a clean cancel, not a failure (r11). */
const cancelBrand: unique symbol = Symbol("cancel");

function makeCancelReason(): { [cancelBrand]: true } {
  return { [cancelBrand]: true };
}

function isCancelReason(error: unknown): boolean {
  return typeof error === "object" && error !== null && cancelBrand in error;
}

/** A rejection caused by our own cancellation — a clean cancel, not a failure (ADR 0026). The layer
 * must be aborted AND the error must be a branded cancel reason (from this layer or a descendant it
 * awaited); a real error rejecting during close is unbranded and still counts as a failure. */
function isCancel(layer: Layer, error: unknown): boolean {
  return layer.abort.signal.aborted && isCancelReason(error);
}

const asPrimary =
  (layer: Layer) =>
  (error: unknown): void => {
    if (isCancel(layer, error)) return;
    layer.failure ??= { cause: error };
  };

/** The `defer` end for work that rejected: an abort-caused rejection is `cancelled`, else `failed`. */
function rejectEnd(layer: Layer, error: unknown): Scope.End {
  return isCancel(layer, error) ? { status: "cancelled" } : { status: "failed", error };
}

/** How an operation's run settled, for its `defer`: an abort-caused rejection (or a clean return
 * under an aborted signal) is `cancelled`; a real rejection is `failed`; else `success`. */
function endFor(layer: Layer, status: "ok" | "failed", error: unknown): Scope.End {
  if (status === "failed") return rejectEnd(layer, error);
  return layer.abort.signal.aborted ? { status: "cancelled" } : SUCCESS;
}

/** Layers whose teardown callbacks (cleanups/hooks) are executing right now, by depth. */
const teardownDepth = new Map<Layer, number>();

function enterTeardown(layer: Layer): void {
  teardownDepth.set(layer, (teardownDepth.get(layer) ?? 0) + 1);
}
function exitTeardown(layer: Layer): void {
  const next = (teardownDepth.get(layer) ?? 1) - 1;
  if (next <= 0) teardownDepth.delete(layer);
  else teardownDepth.set(layer, next);
}

/** True if closing `target` would join a layer that is mid-teardown — `target` is that layer or an
 * ancestor of it — so a re-entrant close from within a (descendant) teardown must not wait on itself.
 * A close of an unrelated scope from a cleanup is not re-entrant and gets its real closing promise. */
function closeWouldReenter(target: Layer): boolean {
  for (const active of teardownDepth.keys()) {
    for (let cur: Layer | undefined = active; cur; cur = cur.parent) {
      if (cur === target) return true;
    }
  }
  return false;
}

/** Run `defer` fns in reverse (LIFO) from index `from`, passing `end`, awaiting each before the next
 * so teardown order holds. Stays synchronous while the fns are; the first async one hands the rest to
 * a tracked continuation joined by close. Failures collect as secondary errors, surfaced via
 * `TeardownFailed`, never settling the owner's outcome (ADR 0017, 0026). Returns `undefined` when the
 * whole drain finished synchronously, else a promise that resolves when the async tail completes — so
 * a release chain can wait for a dependent owner's FULL cleanup before tearing down its base (lt2). */
function runDefers(
  layer: Layer,
  fns: ((end: Scope.End) => void | PromiseLike<void>)[],
  end: Scope.End,
  from: number = fns.length - 1,
): Promise<void> | undefined {
  for (let i = from; i >= 0; i--) {
    let pending: void | PromiseLike<void>;
    enterTeardown(layer);
    try {
      pending = fns[i](end);
    } catch (error) {
      layer.secondary.push(error);
      continue;
    } finally {
      exitTeardown(layer);
    }
    if (!isThenable(pending)) continue;
    const rest = i - 1;
    const cont: Promise<void> = Promise.resolve(pending).then(
      () => {
        layer.pending.delete(cont);
        return runDefers(layer, fns, end, rest);
      },
      (error: unknown) => {
        layer.pending.delete(cont);
        layer.secondary.push(error);
        return runDefers(layer, fns, end, rest);
      },
    );
    layer.pending.add(cont);
    return cont;
  }
  return undefined;
}

function readCall<T, I>(
  target: Operation.Command<T, I>,
  call: Scope.Invocation<I> | undefined,
): { input: I; rawInput: unknown; overlay: TagOverlay | undefined } {
  const overlay = call?.tags?.length ? seedTags(call.tags) : undefined;
  if (call !== undefined && call.input !== undefined) {
    return { input: call.input, rawInput: call.input, overlay };
  }
  const rawInput = call?.rawInput;
  const input = (target.input ? target.input(rawInput) : undefined) as I;
  return { input, rawInput, overlay };
}

function commandController<T, I>(
  layer: Layer,
  target: Operation.Command<T, I>,
  parent: Observe.Span | undefined,
): Scope.CommandController<T, I> {
  const resolve = (call?: Scope.Invocation<I>): T => {
    ensureOpen(layer);
    const obs = layer.obs;
    const span = openSpan(obs, parent, target.label, "operation");
    const override = presetFor(layer, target) as Operation.Command<T, I>["run"] | undefined;
    const defers: ((end: Scope.End) => void | PromiseLike<void>)[] = [];
    const borrowed: { owner: Layer; resource: Resource.Handle<unknown> }[] = [];
    /** Hold a borrow across the op's WHOLE lifetime — body settle (or a throw) AND its own `defer`
     * drain — so a release waits for the op's cleanup (which may still touch the resource) before
     * tearing it down (ADR 0026 Q2). Registered once deps resolve (before the body runs), released
     * after the defer drain on BOTH the success and throwing paths. A fully synchronous op resolves
     * and removes the borrow within `resolve()`, so a later release sees no borrower and stays sync. */
    let settleBorrow: () => void = noop;
    let borrow: Promise<void> | undefined;
    const releaseBorrow = (): void => {
      if (!borrow) return;
      for (const b of borrowed) removeBorrow(b.owner, b.resource, borrow);
      settleBorrow();
    };
    const finishDefers = (status: "ok" | "failed", error?: unknown): void => {
      const tail = runDefers(layer, defers, endFor(layer, status, error));
      if (tail) ignoreRejection(tail.then(releaseBorrow, releaseBorrow));
      else releaseBorrow();
    };
    let result: T;
    try {
      const { input, rawInput, overlay } = readCall(target, call);
      /** Register borrows BEFORE resolving deps: a dep's factory may release another dep during
       * resolution, and the op must already hold it (ADR 0026 Q2). Borrows need only the dep handles. */
      for (const b of collectBorrows(layer, target.depends)) borrowed.push(b);
      if (borrowed.length) {
        borrow = new Promise<void>((r) => (settleBorrow = r));
        for (const b of borrowed) addBorrow(b.owner, b.resource, borrow);
      }
      const deps = buildDeps(layer, target.depends, span, overlay, undefined);
      const ctx: Operation.Ctx<I> = {
        label: target.label,
        rawInput,
        input,
        signal: layer.abort.signal,
        defer: (fn) => void defers.push(fn),
        obs: obsCtx(obs, span),
        log: logFor(obs, span),
      };
      result = override ? override(deps, ctx) : target.run(deps, ctx);
    } catch (error) {
      closeSpan(obs, span, "failed");
      finishDefers("failed", error);
      throw error;
    }
    track(layer, result, asPrimary(layer), (status, error) => {
      if (span) closeSpan(obs, span, status);
      finishDefers(status, error);
    });
    return result;
  };
  return { resolve } as Scope.CommandController<T, I>;
}

function ownerOf(layer: Layer, target: Resource.Handle<unknown>): Layer {
  if (target.target === "session") return layer;
  let cur = layer;
  while (cur.parent) cur = cur.parent;
  return cur;
}

/** Per-dependency edge bookkeeping run when a dependency is realized (undefined for operations, which
 * form no release edges). */
type RegisterEdge = ((dep: Scope.Dependency) => void) | undefined;

/** Install a lazy getter on `deps[key]`: its first read registers the resource's edge, builds/resolves
 * it, and caches; later reads return the cache. A body that never reads the key never triggers the
 * build. The build span, `used` edge, and circular-resource guard all fire at that first access.
 * Enumerable + configurable so `Object.values`/`for..in`/spread still observe (and thus build) it. */
function defineLazyDep(
  deps: Record<string, unknown>,
  key: string,
  layer: Layer,
  dep: Scope.Dependency,
  span: Observe.Span | undefined,
  registerEdge: RegisterEdge,
): void {
  let built = false;
  let value: unknown;
  Object.defineProperty(deps, key, {
    enumerable: true,
    configurable: true,
    get: () => {
      if (!built) {
        registerEdge?.(dep);
        value = resolveDep(layer, dep, span, undefined);
        built = true;
      }
      return value;
    },
  });
}

/** Build the `deps` object a factory/run reads. A resource-target dependency is delivered as a LAZY
 * getter (see {@link defineLazyDep}) so a body that ignores it never builds it. Every other kind (a
 * data snapshot, tag, subflow, or controller) is resolved EAGERLY here, so its value — and, for data,
 * its release edge — is fixed at resolve time, before any suspension (snapshot determinism, ADR 0026).
 * `registerEdge` records a realized resource's dependency edge and is omitted for operations. */
function buildDeps(
  layer: Layer,
  depends: Scope.Depends,
  span: Observe.Span | undefined,
  overlay: TagOverlay | undefined,
  registerEdge: RegisterEdge,
): Record<string, unknown> {
  const deps: Record<string, unknown> = {};
  for (const key in depends) {
    const dep = depends[key];
    if (isResource(dep)) {
      defineLazyDep(deps, key, layer, dep, span, registerEdge);
    } else {
      registerEdge?.(dep);
      deps[key] = resolveDep(layer, dep, span, overlay);
    }
  }
  return deps;
}

function resolveResourceDeps(
  owner: Layer,
  target: Resource.Handle<unknown>,
  span: Observe.Span | undefined,
  superseded: () => boolean,
): Record<string, unknown> {
  return buildDeps(owner, target.depends, span, undefined, (dep) => {
    const node = depNode(dep);
    /** A lazy resource dep registers its release edge only at FIRST ACCESS, which for a paused build
     * can happen after the build was released (superseded). Skip the edge then — a stale build must
     * not record a dependency that would later evict its own LIVE replacement (lazy review P2). */
    if (node && !superseded()) addDependent(owner, node, target);
  });
}

/** Build the ctx a resource factory receives. Only called when the factory declares a ctx param
 * (arity >= 2); otherwise the shared {@link EMPTY_CTX} is passed and nothing is allocated. `defer`
 * closes over the build's `settled`/`superseded` so late registration behaves correctly. */
function buildCtx(
  owner: Layer,
  target: Resource.Handle<unknown>,
  obs: Obs,
  span: Observe.Span | undefined,
  isSettled: () => boolean,
  superseded: () => boolean,
): Resource.Ctx {
  return {
    label: target.label,
    defer: (fn) => {
      if (isSettled()) raise("Disposed", { reason: "resource factory already finished" });
      /** A build that finished after its resource was released (superseded) tears down NOW, but
       * borrow-aware so it still waits for any op that borrowed this resource before running its
       * cleanup (ADR 0026 Q2), and holds its own dependency-closure borrows while it runs. Its `fn`
       * is drained directly — never pushed to `owner.defers` — so it cannot sweep up a LIVE
       * rebuild's defers registered under the same handle. */
      if (superseded()) releaseSupersededDefer(owner, target, fn);
      else owner.defers.push({ fn, resource: target });
    },
    signal: owner.abort.signal,
    obs: obsCtx(obs, span),
    log: logFor(obs, span),
  };
}

function buildResource<T>(
  owner: Layer,
  target: Resource.Handle<T>,
  parent: Observe.Span | undefined,
): unknown {
  const gen = genOf(owner, target);
  const superseded = (): boolean => genOf(owner, target) !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, parent, target.label, "resource");
  nodeState(owner, target).building = true;
  let settled = false;
  try {
    const deps = resolveResourceDeps(owner, target, span, superseded);
    const override = presetFor(owner, target) as Resource.Handle<T>["factory"] | undefined;
    const fn = override ?? target.factory;
    const ctx =
      fn.length >= 2 ? buildCtx(owner, target, obs, span, () => settled, superseded) : EMPTY_CTX;
    const result = fn(deps, ctx);
    if (!isThenable(result)) {
      settled = true;
      if (canPublish()) nodeState(owner, target).resource = { value: result };
      closeSpan(obs, span, "ok");
      return result;
    }
    return finishAsyncBuild(
      owner,
      target,
      result,
      superseded,
      canPublish,
      () => {
        settled = true;
      },
      obs,
      span,
    );
  } catch (error) {
    settled = true;
    if (!superseded()) detachDependent(owner, target);
    closeSpan(obs, span, "failed");
    throw error;
  } finally {
    nodeState(owner, target).building = false;
  }
}

/** Wire up an async build: publish on success only if still current, and on rejection drop the
 * in-flight entry and (unless superseded by a replacement) cache the rejected build. A failed build is
 * sticky — a re-resolve returns the same rejection (not a fresh rebuild) until the resource is
 * released/closed, so `resolve()` stays promise-stable across a consumer's retry (e.g. React Suspense),
 * which would otherwise loop rebuilding. Its dependency edges are KEPT (not detached) while it stays
 * cached, so releasing/closing a dependency still cascades to the cached failure; release and close
 * clear `owner.resources` and detach the edges, so the sticky failure honors the normal lifetime. */
function finishAsyncBuild(
  owner: Layer,
  target: Resource.Handle<unknown>,
  result: PromiseLike<unknown>,
  superseded: () => boolean,
  canPublish: () => boolean,
  markSettled: () => void,
  obs: Obs,
  span: Observe.Span | undefined,
): Promise<unknown> {
  const build: Promise<unknown> = Promise.resolve(result).then(
    (value) => {
      markSettled();
      const done = owner.nodes.get(target);
      if (done?.build === build) done.build = undefined;
      if (canPublish()) nodeState(owner, target).resource = { value: build };
      closeSpan(obs, span, "ok");
      return value;
    },
    (error) => {
      markSettled();
      const done = owner.nodes.get(target);
      if (done?.build === build) done.build = undefined;
      if (!superseded()) nodeState(owner, target).resource = { value: build };
      closeSpan(obs, span, "failed");
      throw error;
    },
  );
  if (!superseded()) nodeState(owner, target).build = build;
  track(owner, build, (error) => {
    if (!superseded() && !isCancel(owner, error)) owner.failure ??= { cause: error };
  });
  return build;
}

function resourceController<T>(
  layer: Layer,
  target: Resource.Handle<T>,
  parent: Observe.Span | undefined,
): Scope.ResourceController<T> {
  const owner = ownerOf(layer, target);
  /** Second cache layer: the controller (already cached per node) holds the owner's node record
   * directly, so a warm resolve is a field read — no per-call `owner.nodes.get`. The record is a
   * stable object mutated in place by build/invalidate, so it always reflects the current state. */
  const rec = nodeState(owner, target);
  return {
    resolve: () => {
      ensureOpen(layer);
      ensureOpen(owner);
      recordUsed(layer.obs, parent, target);
      if (rec.resource) return rec.resource.value as Scope.ResourceValue<T>;
      if (rec.build) return rec.build as Scope.ResourceValue<T>;
      if (rec.building) raise("CircularResource", { label: target.label });
      return buildResource(owner, target, parent) as Scope.ResourceValue<T>;
    },
    get: () => {
      ensureOpen(layer);
      ensureOpen(owner);
      if (!rec.resource) raise("NotResolved", { label: target.label });
      return rec.resource.value as Scope.ResourceValue<T>;
    },
  };
}

type Affected = { node: Node; owner: Layer };

/** Drop a resource's cache/generation/defer-registrations and edges at its owner, running no user
 * callback; returns its `defer`s (registration order) for the caller to run after every affected node
 * is invalidated. */
/** Drop a resource's cache, in-flight build, and edges (a fresh generation invalidates a late build).
 * The resource's `defer`s stay in `owner.defers` — release drains them by reverse registration order
 * (`extractReleasedDefers`) alongside its affected dependents, so a diamond tears down dependents
 * before dependencies (ADR 0026), not per-resource grouped at build-completion. */
function invalidateResource(owner: Layer, target: Resource.Handle<unknown>): void {
  const s = nodeState(owner, target);
  s.gen = (s.gen ?? 0) + 1;
  s.resource = undefined;
  s.build = undefined;
  detachDependent(owner, target);
  s.dependents = undefined;
}

/** Pull the affected resources' `defer`s out of `owner.defers` in registration order (removing them so
 * a later close cannot re-run them). The release drain reverses this → dependents (registered after
 * their dependencies) tear down first. */
function extractReleasedDefers(
  owner: Layer,
  resources: Set<Resource.Handle<unknown>>,
): ((end: Scope.End) => void | PromiseLike<void>)[] {
  const released: ((end: Scope.End) => void | PromiseLike<void>)[] = [];
  owner.defers = owner.defers.filter((entry) => {
    if (entry.resource !== undefined && resources.has(entry.resource)) {
      released.push(entry.fn);
      return false;
    }
    return true;
  });
  return released;
}

/** Drop a cell's shadow (revert to inherited/initial) and edges without notifying watchers. */
function invalidateData(owner: Layer, target: Data.Cell<unknown>): void {
  const s = owner.nodes.get(target);
  if (s?.cell) {
    s.cell = undefined;
    invalidateEff(owner, target);
  }
  if (s) s.dependents = undefined;
}

/** Whether a node's dependents can live below its owner: a `scope` resource and a data cell are
 * shared down the chain, so dependents may sit in descendant sessions; a `session` resource is a
 * per-session instance whose dependents are only ever in its own owner layer. */
function spansDescendants(node: Node): boolean {
  return !isResource(node) || node.target === "scope";
}

/** Visit each (dependent resource, its owner) that depends on `node`. Scope nodes search the
 * owner's whole subtree (to reach session instances); a session node searches only its owner. */
function forEachDependent(
  nodeOwner: Layer,
  node: Node,
  visit: (target: Resource.Handle<unknown>, owner: Layer) => void,
): void {
  const deep = spansDescendants(node);
  const stack: Layer[] = [nodeOwner];
  while (stack.length) {
    const scope = stack.pop() as Layer;
    const deps = scope.nodes.get(node)?.dependents;
    if (deps) for (const target of deps) visit(target, scope);
    if (deep) for (const child of scope.children) stack.push(child);
  }
}

/** Walk dependents from a node (iterative; keyed on node+owner so diamonds collapse while the same
 * handle in two sessions stays distinct) → every affected (node, owner), in release order. */
function collectAffected(target: Node, targetOwner: Layer): Affected[] {
  const seen = new Map<Node, Set<Layer>>();
  const order: Affected[] = [];
  const stack: Affected[] = [{ node: target, owner: targetOwner }];
  while (stack.length) {
    const item = stack.pop() as Affected;
    let owners = seen.get(item.node);
    if (!owners) {
      owners = new Set();
      seen.set(item.node, owners);
    }
    if (owners.has(item.owner)) continue;
    owners.add(item.owner);
    order.push(item);
    forEachDependent(item.owner, item.node, (t, owner) => stack.push({ node: t, owner }));
  }
  return order;
}

/** A released owner's affected resources and their OLD defers, extracted up front. */
type Released = {
  resources: Set<Resource.Handle<unknown>>;
  fns: ((end: Scope.End) => void | PromiseLike<void>)[];
};

/** Release a node and cascade to its dependents across owners. Two phases so a throwing/closing/
 * rebuilding callback can never strand a dependent or sweep up a fresh value: first collect every
 * affected (node, owner), drop all their caches, and EXTRACT their old defers up front (keeps a
 * rebuild's fresh defer out of the drain — r10); then notify watchers and drain the pre-extracted
 * defers. Owners drain DESCENDANTS-FIRST (ledger invariant 6: children before parents), each chained
 * after the prior via `prev`, so a dependency — always at a same-or-ancestor owner — tears down after
 * its dependents (and after that owner's full, incl. async, drain); within an owner it is reverse-
 * registration order. Each owner's drain waits for in-flight OPERATIONS borrowing its resources
 * (ADR 0026 Q2). */
function releaseNode(layer: Layer, target: Node): void {
  ensureOpen(layer);
  const targetOwner = isResource(target) ? ownerOf(layer, target) : layer;
  ensureOpen(targetOwner);
  const affected = new Map<Layer, Released>();
  const dataReleased = invalidateAffected(collectAffected(target, targetOwner), affected);
  try {
    if (dataReleased) flushTree(layer);
  } finally {
    let prev: Promise<void> | undefined;
    for (const [owner, entry] of byDepthDesc(affected)) {
      prev = drainBorrowAware(owner, entry.resources, entry.fns, prev);
    }
  }
}

/** Affected owners deepest-first (descendants before ancestors): a released dependency lives at a
 * same-or-ancestor owner of its dependents, so this order tears dependents down before dependencies. */
function byDepthDesc(affected: Map<Layer, Released>): [Layer, Released][] {
  return [...affected].sort(([ownerA], [ownerB]) => layerDepth(ownerB) - layerDepth(ownerA));
}

function layerDepth(layer: Layer): number {
  let depth = 0;
  for (let cur = layer.parent; cur; cur = cur.parent) depth++;
  return depth;
}

/** Tear down a superseded build's late `defer` immediately but borrow-aware (waits for an op that
 * borrowed the resource before running; ADR 0026 Q2). Drained directly — never pushed to
 * `owner.defers` — so it can't sweep up a LIVE rebuild's defers under the same handle. */
function releaseSupersededDefer(
  owner: Layer,
  target: Resource.Handle<unknown>,
  fn: (end: Scope.End) => void | PromiseLike<void>,
): void {
  const done = drainBorrowAware(owner, new Set([target]), [fn], undefined);
  if (done) ignoreRejection(done);
}

/** Run `fns` as a release drain at `owner`, after the prior (more-dependent) owner's drain (`prev`)
 * and after any in-flight OPERATION borrowing one of `resources` settles (ADR 0026 Q2 — the cache is
 * already invalidated; only physical teardown waits). Returns a promise the next owner chains on, or
 * `undefined` when it ran fully synchronously (no `prev`, no borrowers) so an all-sync release stays
 * synchronous. `fns` is passed explicitly (not re-selected by resource handle) so a superseded old
 * build's late defer never sweeps up the LIVE rebuild's defers under the same handle. Tracked in
 * `owner.pending`, joined by close. */
function drainBorrowAware(
  owner: Layer,
  resources: Set<Resource.Handle<unknown>>,
  fns: ((end: Scope.End) => void | PromiseLike<void>)[],
  prev: Promise<void> | undefined,
): Promise<void> | undefined {
  const borrowers = collectBorrowers(owner, resources);
  if (fns.length === 0 && borrowers.length === 0) return prev;
  if (prev === undefined && borrowers.length === 0) return runDefers(owner, fns, RELEASED);
  const waitOn: Promise<unknown>[] = prev ? [...borrowers, prev] : borrowers;
  const wait: Promise<void> = Promise.allSettled(waitOn).then(() => {
    owner.pending.delete(wait);
    return runDefers(owner, fns, RELEASED);
  });
  owner.pending.add(wait);
  return wait;
}

/** Drop every affected node's cache at its owner, then extract each affected owner's OLD defers (in
 * registration order) BEFORE any cleanup or watcher runs. Returns whether any data cell was reset (so
 * the caller flushes watchers). Extracting up front keeps a rebuild's fresh defer out of the drain. */
function invalidateAffected(order: Affected[], affected: Map<Layer, Released>): boolean {
  let dataReleased = false;
  for (const { node, owner } of order) {
    if (owner.closed) continue;
    if (isResource(node)) {
      invalidateResource(owner, node);
      const entry = affected.get(owner) ?? { resources: new Set(), fns: [] };
      entry.resources.add(node);
      affected.set(owner, entry);
    } else {
      invalidateData(owner, node);
      dataReleased = true;
    }
  }
  for (const [owner, entry] of affected) entry.fns = extractReleasedDefers(owner, entry.resources);
  return dataReleased;
}

function addDependent(owner: Layer, node: Node, dependent: Resource.Handle<unknown>): void {
  const s = nodeState(owner, node);
  if (s.dependents) s.dependents.add(dependent);
  else s.dependents = new Set([dependent]);
}

/** Remove one resource from every dependents set (its incoming edges), dropping empty sets. */
function detachDependent(owner: Layer, dependent: Resource.Handle<unknown>): void {
  for (const s of owner.nodes.values()) {
    const set = s.dependents;
    if (set && set.delete(dependent) && set.size === 0) s.dependents = undefined;
  }
}

/** The releasable node a dependency reads through, if any — a bare data cell or its controller
 * edge, or a bare resource. Tags and commands (subflows) create no release edge. */
function depNode(dep: Scope.Dependency): Node | undefined {
  if (isData(dep)) return dep;
  if (isResource(dep)) return dep;
  if (isEdge(dep) && dep.kind === "controller" && isData(dep.target)) return dep.target;
  return undefined;
}

/** The resource handle an operation dependency borrows a built value from — a bare resource or any
 * resource edge (`required`/`optional`/`all`/`controller`) — so release can wait for in-flight
 * borrowers before physically tearing that resource down (ADR 0026 Q2). */
function resourceDepHandle(dep: Scope.Dependency): Resource.Handle<unknown> | undefined {
  if (isResource(dep)) return dep;
  if (isEdge(dep) && isResource(dep.target)) return dep.target;
  return undefined;
}

type Borrow = { owner: Layer; resource: Resource.Handle<unknown> };

/** The (owner, resource) borrows for an operation's dependencies: the resources it directly resolves
 * (ADR 0026 Q2 — a release waits for in-flight OPERATIONS borrowing the released resource). Cross-owner
 * and diamond ordering is handled by the depth-ordered release chain, not by transitive borrows. */
function collectBorrows(layer: Layer, depends: Scope.Depends): Borrow[] {
  const out: Borrow[] = [];
  for (const key in depends) {
    const res = resourceDepHandle(depends[key]);
    if (res !== undefined) out.push({ owner: ownerOf(layer, res), resource: res });
  }
  return out;
}

function addBorrow(owner: Layer, resource: Resource.Handle<unknown>, work: Promise<unknown>): void {
  const s = nodeState(owner, resource);
  if (s.borrowers) s.borrowers.add(work);
  else s.borrowers = new Set([work]);
}

function removeBorrow(
  owner: Layer,
  resource: Resource.Handle<unknown>,
  work: Promise<unknown>,
): void {
  const s = owner.nodes.get(resource);
  const set = s?.borrowers;
  if (set && set.delete(work) && set.size === 0 && s) s.borrowers = undefined;
}

/** In-flight operation promises borrowing any of `resources` at `owner`, so release can wait for them
 * to settle before running the resources' cleanup. */
function collectBorrowers(
  owner: Layer,
  resources: Set<Resource.Handle<unknown>>,
): Promise<unknown>[] {
  const out: Promise<unknown>[] = [];
  for (const resource of resources) {
    const set = owner.nodes.get(resource)?.borrowers;
    if (set) for (const work of set) out.push(work);
  }
  return out;
}

function seedTags(
  bindings: readonly Tag.Binding<unknown>[] | undefined,
): Map<Tag.Handle<unknown>, unknown[]> | undefined {
  if (!bindings || bindings.length === 0) return undefined;
  const tags = new Map<Tag.Handle<unknown>, unknown[]>();
  for (const binding of bindings) {
    const list = tags.get(binding.tag) ?? [];
    list.push(binding.value);
    tags.set(binding.tag, list);
  }
  return tags;
}

function seedPresets(seeds: readonly Scope.Preset[] | undefined): {
  nodes: Map<object, NodeState>;
  presets: Map<unknown, unknown> | undefined;
} {
  const nodes = new Map<object, NodeState>();
  let presets: Map<unknown, unknown> | undefined;
  for (const p of seeds ?? []) {
    const node = p.node;
    if (isData(node)) {
      const s = new NodeState();
      s.cell = { value: admit(node.label, node.parse, p.replacement) };
      nodes.set(node, s);
    } else (presets ??= new Map()).set(node, p.replacement);
  }
  return { nodes, presets };
}

function makeLayer(parent: Layer | undefined, options?: Scope.Options): Layer {
  const tags = seedTags(options?.tags);
  const { nodes, presets } = seedPresets(options?.presets);
  const layer: Layer = {
    parent,
    children: new Set(),
    nodes,
    presets,
    tags,
    watchers: undefined,
    pending: new Set(),
    defers: [],
    abort: new AbortController(),
    cancelled: false,
    swept: false,
    bodyEnd: undefined,
    failure: undefined,
    descendantFailure: undefined,
    secondary: [],
    body: undefined,
    closed: false,
    closing: undefined,
    obs: parent ? parent.obs : makeObs(options?.observe),
  };
  if (parent) {
    parent.children.add(layer);
    /** Born into a subtree already being collected by an active ancestor close: inherit `swept` so this
     * late child's real failure + teardown errors still push up to the collecting ancestor when it
     * finishes; inherit the abort if the ancestor close is FORCED (creation under a CLOSED scope is
     * blocked by `ensureOpen`, so a swept-but-open parent means an ancestor is mid-close). */
    if (parent.swept) layer.swept = true;
    if (parent.abort.signal.aborted) layer.abort.abort(parent.abort.signal.reason);
  }
  return layer;
}

/** Mark a layer's whole subtree `swept`, iteratively (no recursion — deep trees are safe). Run
 * SYNCHRONOUSLY at close-call time so a descendant that finishes and detaches before this close's async
 * body runs is still marked — then `finishLayer` pushes its real failure + teardown errors up to its
 * parent, and a collecting ancestor sees them at any depth. A layer's own close never marks itself, so
 * a unit that fails independently does not propagate. */
function markSwept(root: Layer): void {
  const stack: Layer[] = [...root.children];
  while (stack.length) {
    const layer = stack.pop() as Layer;
    layer.swept = true;
    for (const child of layer.children) stack.push(child);
  }
}

/** Abort a layer and its whole subtree (forced teardown), sharing the root's reason so `isCancel`
 * recognizes the cancel across the subtree and awaited work unblocks. Run inside the async close body
 * (not at call time) so it does not race ahead of the body's own settlement — a body that already
 * resolved is classified `success`, not flipped to `cancelled` by a later forced close. */
function abortSubtree(root: Layer): void {
  if (!root.abort.signal.aborted) root.abort.abort(makeCancelReason());
  const reason = root.abort.signal.reason;
  const stack: Layer[] = [...root.children];
  while (stack.length) {
    const layer = stack.pop() as Layer;
    if (!layer.abort.signal.aborted) layer.abort.abort(reason);
    for (const child of layer.children) stack.push(child);
  }
}

const SUCCESS: Scope.Outcome = { status: "success" };
const RELEASED: Scope.End = { status: "released" };

/** Drain a layer's `defer`s in reverse registration order (LIFO, ADR 0026), awaiting each before the
 * next, passing the settled `end`; teardown failures collect in `layer.secondary` in execution order
 * (→ `TeardownFailed`). The teardown guard spans the synchronous call so a callback that synchronously
 * re-enters `close()` is acked (Q3 no-hang). */
async function drainDefers(layer: Layer, entries: DeferEntry[], end: Scope.End): Promise<void> {
  for (let i = entries.length - 1; i >= 0; i--) {
    let pending: void | PromiseLike<void>;
    enterTeardown(layer);
    try {
      pending = entries[i].fn(end);
    } catch (cause) {
      layer.secondary.push(cause);
      continue;
    } finally {
      exitTeardown(layer);
    }
    try {
      await pending;
    } catch (cause) {
      layer.secondary.push(cause);
    }
  }
}

/** A layer's body end, classified at the moment the body settled (`bodyEnd`, attached at session
 * creation so the abort-state reflects whether the body was interrupted, not the later own-close
 * abort — Q5). A bodyless layer returns undefined (its outcome comes from the close request). */
function classifyBody(layer: Layer): Promise<Scope.Outcome | undefined> {
  return layer.bodyEnd ?? Promise.resolve(undefined);
}

/** The reality-only settlement reducer (ADR 0028): a real failure wins — the body threw, an owned-work
 * op rejected, or a descendant really failed (bubbled into `layer.failure`/`descendantFailure`) — then
 * an interrupted body settles `cancelled`, else `success`. No wished outcome participates. Records the
 * winning real failure in `layer.failure` so it propagates to a collecting ancestor. A body that
 * rejects (whether it threw or surfaced a descendant failure it awaited) is a real body failure; we do
 * NOT distinguish an "own" throw from a "propagated" one (unknowable by value — rounds 7–9). */
function settleOutcome(layer: Layer, body: Scope.Outcome | undefined): Scope.Outcome {
  if (body?.status === "failed") {
    /** A body failure is the PRIMARY cause and outranks a caught/recorded owned-work failure, so it
     * OVERRIDES `layer.failure` (which `asPrimary` may already have set from the op) — otherwise a
     * collecting ancestor would push up the owned-work error while this layer reports the body error. */
    layer.failure = { cause: body.error };
    return body;
  }
  const owned = layer.failure ?? layer.descendantFailure;
  if (owned) {
    layer.failure ??= owned;
    return { status: "failed", error: owned.cause };
  }
  if (layer.cancelled) return { status: "cancelled" };
  return SUCCESS;
}

/** A best-effort outcome for a re-entrant close ack before the layer has settled: whatever real state
 * is already known (a recorded failure, then an interrupted body), else success. */
function bestEffort(layer: Layer): Scope.Outcome {
  if (layer.failure) return { status: "failed", error: layer.failure.cause };
  return layer.cancelled ? { status: "cancelled" } : SUCCESS;
}

/** Drive every currently-attached child to close (children first, awaited sequentially). The mode is
 * re-checked per child: once an EARLIER child's failure has been collected (pushed into this layer's
 * `descendantFailure` while we awaited it), the remaining children close FORCED so their resources roll
 * back too. Collection is NOT done here: each child's real failure + teardown errors flow up through
 * `finishLayer` (swept push), so a child that already finished and detached still reaches its ancestor. */
async function closeChildren(layer: Layer, force: boolean): Promise<void> {
  for (const child of Array.from(layer.children)) {
    await closeLayer(child, force || (layer.failure ?? layer.descendantFailure) !== undefined);
  }
}

function closeLayer(layer: Layer, force = true): Promise<Scope.Result> {
  if (!layer.closing) {
    layer.closed = true;
    layer.closing = startClose(layer, force);
  }
  /** A second/later close (any mode) returns the in-flight close's Result — the mode of the FIRST call
   * wins (no graceful→forced escalation in v1; force-close from the start if a hang is a concern). This
   * also means a session's automatic self-close does not override an in-progress explicit graceful
   * close (ADR 0028). */
  /** A `close()` re-entered from within this layer's (or an ancestor's) own teardown is a request-only
   * acknowledgement: return an already-resolved best-effort `Result` so it never waits on itself (no
   * hang, no throw — ADR 0026 Q3, 0027/0028). The real settled `Result` is `layer.closing`. */
  if (closeWouldReenter(layer)) {
    return Promise.resolve(buildResult(bestEffort(layer), layer, undefined));
  }
  return layer.closing;
}

/** Build the `close()` Result from the settled outcome, the layer's abort reason (for a cancel), and
 * the teardown errors — never throws (ADR 0027). */
function buildResult(
  settled: Scope.Outcome,
  layer: Layer,
  teardownErrors: readonly unknown[] | undefined,
): Scope.Result {
  if (settled.status === "failed")
    return { status: "failed", error: settled.error, teardownErrors };
  if (settled.status === "cancelled") {
    return { status: "cancelled", reason: layer.abort.signal.reason, teardownErrors };
  }
  return { status: "success", teardownErrors };
}

/** Run a layer's close (ADR 0028): sweep the subtree, classify the body, close children, join owned
 * work, settle by reality, drain defers, then re-settle (a late child failure can land during the
 * drain) and detach. Never throws — resolves to the `Result`. A layer already aborted by an ancestor's
 * FORCED close is itself being force-torn-down whatever its own close mode, so it rolls back. The sweep
 * is SYNCHRONOUS (at close-call time) so a child that finishes and detaches before this close's async
 * body runs is still marked `swept` and its failure/errors still collected. */
/** Whether a layer's teardown rolls its subtree back (resources see `cancelled`) rather than committing
 * gracefully: the close is forced, an ancestor already aborted it, or it is FAILING — a real failure
 * (body throw, or an already-recorded owned-work / descendant failure) rolls the subtree back even
 * under a graceful close (transaction-abort). */
function rollsBack(layer: Layer, forced: boolean, body: Scope.Outcome | undefined): boolean {
  return (
    forced || body?.status === "failed" || (layer.failure ?? layer.descendantFailure) !== undefined
  );
}

function startClose(layer: Layer, force: boolean): Promise<Scope.Result> {
  const forced = force || layer.abort.signal.aborted;
  markSwept(layer);
  const run = async (): Promise<Scope.Result> => {
    if (forced) abortSubtree(layer);
    const body = await classifyBody(layer);
    const rollback = rollsBack(layer, forced, body);
    /** A session settles cancelled iff its body was interrupted; a bodyless scope iff its teardown rolls
     * back (POSIX-style: forced rolls resources back, graceful commits) — a body that SUCCEEDED is never
     * cancelled by a forced self-close. */
    if (body ? body.status === "cancelled" : rollback) layer.cancelled = true;
    await closeChildren(layer, rollback);
    while (layer.pending.size) await Promise.all(layer.pending);
    const settled = settleOutcome(layer, body);
    await drainDefers(layer, layer.defers, settled);
    /** Re-settle once more: a late real failure (pushed up from a child whose cleanup was parked on a
     * gate) can land WHILE we await the defers; `settleOutcome` never downgrades a recorded failure, so
     * the result stays monotonic and a collecting ancestor still sees it. */
    const finalSettled = settleOutcome(layer, body);
    const teardownErrors = finishLayer(layer);
    return buildResult(finalSettled, layer, teardownErrors);
  };
  return Promise.resolve().then(run);
}

/** Detach the layer and clear all its state after teardown; returns the collected teardown errors
 * (in execution order) for `TeardownFailed`, or undefined if there were none. A layer swept by an
 * ancestor's close pushes its teardown errors + failure up to its parent as it detaches, so a
 * collecting ancestor gathers descendant results at any depth even when a descendant finished and
 * detached before the intervening scopes began their own close (F1 / grandchild). */
function finishLayer(layer: Layer): unknown[] | undefined {
  const teardownErrors = layer.secondary.length ? [...layer.secondary] : undefined;
  const parent = layer.parent;
  if (parent) {
    parent.children.delete(layer);
    if (layer.swept) {
      for (const cause of layer.secondary) parent.secondary.push(cause);
      /** A descendant's settled failure goes to a SEPARATE slot ranked BELOW the parent's OWN failure
       * (body/owned-work): a real owned-work failure must still beat a failure a child merely inherited
       * from the close request (a wished `failed` echoed back down and up). First descendant wins. */
      if (layer.failure) parent.descendantFailure ??= layer.failure;
    }
  }
  layer.nodes.clear();
  layer.presets = undefined;
  layer.tags = undefined;
  layer.watchers = undefined;
  layer.pending.clear();
  layer.children.clear();
  layer.defers.length = 0;
  layer.secondary.length = 0;
  return teardownErrors;
}

function settleSession(
  hasFailure: boolean,
  cause: unknown,
  teardownCauses: unknown[] | undefined,
): void {
  if (hasFailure) {
    if (teardownCauses) raise("TeardownFailed", { causes: [cause, ...teardownCauses] });
    throw cause;
  }
  if (teardownCauses) raise("TeardownFailed", { causes: teardownCauses });
}

async function runSession<R>(
  parent: Layer,
  options: Scope.Options | undefined,
  fn: (scope: Scope.Handle) => R | PromiseLike<R>,
): Promise<R> {
  ensureOpen(parent);
  const child = makeLayer(parent, options);
  const body = runBodyFn(child, fn);
  child.body = body;
  child.bodyEnd = body.then(
    (): Scope.Outcome => (child.abort.signal.aborted ? { status: "cancelled" } : SUCCESS),
    (cause: unknown): Scope.Outcome =>
      isCancel(child, cause) ? { status: "cancelled" } : { status: "failed", error: cause },
  );
  const result = await bodyResult(body);
  /** `close()` never throws (ADR 0027/0028); it resolves to the actual settled `Result`. A session is
   * promise-style, so map that Result back to resolve/reject: a real failure or cancellation rejects
   * (with the cause / abort reason), a clean run resolves the body value; teardown errors aggregate
   * into `TeardownFailed` either way. The self-close is FORCED — the body is done, so any still-running
   * owned work is aborted rather than awaited; the body's own outcome decides success/cancelled. */
  const ended = await closeLayer(child, true);
  const teardownCauses = ended.teardownErrors ? [...ended.teardownErrors] : undefined;
  if (ended.status === "failed") settleSession(true, ended.error, teardownCauses);
  else if (ended.status === "cancelled") settleSession(true, ended.reason, teardownCauses);
  else settleSession(false, undefined, teardownCauses);
  return result as R;
}

/** Run the session body, normalizing to a promise. `fn` is called synchronously (no extra adoption
 * microtask) so an already-settled value/promise settles `bodyEnd` before a later abort, letting the
 * body's OWN end reflect whether the BODY was interrupted (an aborted body → cancelled) rather than a
 * subsequent self-close abort. A sync throw becomes a rejection. */
function runBodyFn<R>(child: Layer, fn: (scope: Scope.Handle) => R | PromiseLike<R>): Promise<R> {
  try {
    return Promise.resolve(fn(handleFor(child)));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** The session body's value, or undefined if it rejected — the body's end (success/failed/cancelled)
 * is classified authoritatively by `startClose` via `classifyBody` (ADR 0026). */
async function bodyResult<R>(body: Promise<R>): Promise<R | undefined> {
  try {
    return await body;
  } catch {
    return undefined;
  }
}

function handleFor(layer: Layer): Scope.Handle {
  const settled = async (): Promise<void> => {
    while (layer.pending.size) await Promise.all(layer.pending);
  };
  return {
    getController: (<T, I>(target: Data.Cell<T> | Resource.Handle<T> | Operation.Command<T, I>) => {
      ensureOpen(layer);
      const s = nodeState(layer, target);
      if (s.controller) return s.controller;
      const ctl = isData(target)
        ? dataController(layer, target)
        : isResource(target)
          ? resourceController(layer, target, undefined)
          : commandController(layer, target, undefined);
      s.controller = ctl;
      return ctl;
    }) as Scope.Handle["getController"],
    createSession: (options?: Scope.Options) => {
      ensureOpen(layer);
      return handleFor(makeLayer(layer, options));
    },
    session: (<R>(
      a: Scope.Options | ((scope: Scope.Handle) => R | PromiseLike<R>),
      b?: (scope: Scope.Handle) => R | PromiseLike<R>,
    ) => {
      if (typeof a === "function") return runSession(layer, undefined, a);
      if (!b)
        raise("InvalidDependency", { label: "session", reason: "session(options, fn) needs fn" });
      return runSession(layer, a, b);
    }) as Scope.Handle["session"],
    release: (target: Data.Cell<unknown> | Resource.Handle<unknown>) => releaseNode(layer, target),
    spans: () => layer.obs.history.slice(),
    onClose: (fn: () => void | PromiseLike<void>) => {
      ensureOpen(layer);
      layer.defers.push({ fn: () => fn(), resource: undefined });
    },
    settled,
    close: (opts?: Scope.CloseOptions) => closeLayer(layer, !opts?.graceful),
  };
}

/** Create a scope: the root of a layer chain that resolves cells, tags, and commands to controllers. */
export function createScope(options?: Scope.Options): Scope.Handle {
  return handleFor(makeLayer(undefined, options));
}

export { isError };
export type { Errors } from "./errors.ts";
