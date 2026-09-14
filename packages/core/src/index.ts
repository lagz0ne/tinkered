import { isError, makeError, raise } from "./errors.ts";

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

  /** Ambient metadata read through the scope chain. Callable to bind a value. */
  export type Handle<T> = {
    readonly [tagSym]: true;
    readonly label: string;
    readonly hasDefault: boolean;
    readonly def: T | undefined;
    readonly parse: Data.Parse<T> | undefined;
    eq(a: T, b: T): boolean;
    readonly required: Edge<"required", Handle<T>>;
    readonly optional: Edge<"optional", Handle<T>>;
    readonly all: Edge<"all", Handle<T>>;
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
  /** The receiver a command body reads its own invocation through. */
  export type Ctx<I> = {
    readonly label: string;
    readonly rawInput: unknown;
    readonly input: I;
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
    /** Depend on this command: delivered as a callable controller. */
    readonly controller: Edge<"controller", Command<T, I>>;
  };
}

export declare namespace Resource {
  /** The receiver a resource factory builds through: register per-instance cleanup and
   * an outcome hook that commits (success) or rolls back (failed) when the owner settles. */
  export type Ctx = {
    readonly label: string;
    readonly cleanup: (fn: () => void | PromiseLike<void>) => void;
    readonly onOutcome: (fn: (outcome: Scope.Outcome) => void | PromiseLike<void>) => void;
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

  /** A callable handle onto one command. A `void` input still allows `resolve()`; a required
   * input must be passed (ADR 0020 subflow contract). */
  export type CommandController<T, I> = {
    resolve(input: I): T;
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

  /** How a scope settled: declared outside-in on success, or failed by an inside-out cause. */
  export type Outcome =
    | { readonly status: "success" }
    | { readonly status: "failed"; readonly error?: unknown };

  /** What `createScope()` returns: the one seam tests and callers touch. */
  export type Handle = {
    getController<T>(target: Data.Cell<T>): DataController<T>;
    getController<T>(target: Resource.Handle<T>): ResourceController<T>;
    getController<T, I>(target: Operation.Command<T, I>): CommandController<T, I>;
    /** Open a child session: it inherits this scope's data and tags, and shadows on write. */
    createSession(options?: Options): Handle;
    /** Run `fn` in a fresh child session: normal return = success (outside-in), a thrown
     * error = failed(cause) (inside-out). The session auto-closes with that outcome; the
     * primary cause is thrown, hook errors aggregated (ADR 0017). */
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
    /** Close children first, join owned work, notify outcome hooks then cleanup, then seal.
     * `outcome` defaults to success; failures aggregate into a `TeardownFailed`. */
    close(outcome?: Outcome): Promise<void>;
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

/** Declare a reactive value cell. `parse` validates the initial value once. */
export function data<T>(config: {
  label?: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Data.Cell<T> {
  const label = config.label ?? "anon";
  const base = {
    [cell]: true,
    label,
    initial: admit(label, config.parse, config.initial),
    parse: config.parse,
    eq: config.eq ?? Object.is,
  } as Data.Cell<T>;
  return Object.assign(base, { controller: edgeTo("controller", base) });
}

/** Declare an ambient tag. Call it to bind a value; read it via `.required`/`.optional`/`.all`. */
export function tag<T>(config: {
  label: string;
  default?: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
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
}): Operation.Command<R, I> {
  const base = {
    [command]: true,
    label: config.label,
    input: config.input,
    depends: config.depends ?? {},
    run: config.run as Operation.Command<R, I>["run"],
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
}): Resource.Handle<T> {
  return {
    [resourceSym]: true,
    label: config.label,
    target: config.target ?? "scope",
    depends: config.depends ?? {},
    factory: config.factory as Resource.Handle<T>["factory"],
  } as Resource.Handle<T>;
}

/** Test-only: substitute a node's realization for downstream consumers of a scope (ADR 0015).
 * A `data` value is validated through `parse`; a command takes a replacement `run`. Seed via
 * `createScope({ presets: [preset(node, ...)] })`. Resource presets land in a later ticket. */
export function preset<T>(node: Data.Cell<T>, value: T): Scope.Preset;
export function preset<T, I>(
  node: Operation.Command<T, I>,
  run: (deps: Scope.SlotValues<Operation.Command<T, I>["depends"]>, ctx: Operation.Ctx<I>) => T,
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
/** A teardown hook tagged with the resource that registered it (undefined = userland `onClose`),
 * so `release` can drop exactly one resource's hooks without touching others. */
type CleanupEntry = {
  fn: () => void | PromiseLike<void>;
  resource: Resource.Handle<unknown> | undefined;
};
type OutcomeEntry = {
  fn: (outcome: Scope.Outcome) => void | PromiseLike<void>;
  resource: Resource.Handle<unknown> | undefined;
};

/** One layer of the scope chain. A session is a child layer. */
type Layer = {
  parent: Layer | undefined;
  children: Set<Layer>;
  cells: Map<Data.Cell<unknown>, Entry>;
  effCache: Map<Data.Cell<unknown>, Entry | undefined>;
  resources: Map<Resource.Handle<unknown>, Entry>;
  builds: Map<Resource.Handle<unknown>, Promise<unknown>>;
  building: Set<Resource.Handle<unknown>>;
  generations: Map<Resource.Handle<unknown>, number>;
  dependents: Map<Node, Set<Resource.Handle<unknown>>>;
  presets: Map<unknown, unknown>;
  tags: Map<Tag.Handle<unknown>, unknown[]>;
  watchers: Set<Watcher>;
  pending: Set<Promise<unknown>>;
  cleanups: CleanupEntry[];
  onOutcomes: OutcomeEntry[];
  failure: { cause: unknown } | undefined;
  secondary: unknown[];
  body: Promise<unknown> | undefined;
  closed: boolean;
  closing: Promise<void> | undefined;
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
  if (layer.effCache.has(target)) return layer.effCache.get(target);
  let found: Entry | undefined;
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const owned = cur.cells.get(target);
    if (owned) {
      found = owned;
      break;
    }
  }
  layer.effCache.set(target, found);
  return found;
}

function readCell(layer: Layer, target: Data.Cell<unknown>): unknown {
  const entry = effectiveEntry(layer, target);
  return entry ? entry.value : target.initial;
}

/** Creating a nearer shadow changes the effective cell for this layer and its descendants. */
function invalidateEff(layer: Layer, target: Data.Cell<unknown>): void {
  layer.effCache.delete(target);
  for (const child of layer.children) invalidateEff(child, target);
}

/** Copy-on-write: get or create this layer's own shadow of a cell, seeded from the inherited value. */
function ownCell(layer: Layer, target: Data.Cell<unknown>): Entry {
  let entry = layer.cells.get(target);
  if (!entry) {
    entry = { value: readCell(layer, target) };
    layer.cells.set(target, entry);
    invalidateEff(layer, target);
  }
  return entry;
}

/** Fire watchers on this layer, then descendants (inherited reads see the change; shadowed ones don't). */
function flushTree(layer: Layer): void {
  for (const w of layer.watchers) {
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

function tagFind(layer: Layer, target: Tag.Handle<unknown>): Tag.Presence<unknown> {
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const list = cur.tags.get(target);
    if (list && list.length) return { present: true, value: list[list.length - 1] };
  }
  return target.hasDefault ? { present: true, value: target.def } : { present: false };
}

function tagAll(layer: Layer, target: Tag.Handle<unknown>): unknown[] {
  const out: unknown[] = [];
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const list = cur.tags.get(target);
    if (list) for (let i = list.length - 1; i >= 0; i--) out.push(list[i]);
  }
  return out;
}

function tagRequired(layer: Layer, target: Tag.Handle<unknown>): unknown {
  const found = tagFind(layer, target);
  if (!found.present) raise("MissingTag", { label: target.label });
  return found.value;
}

/** The nearest preset replacement for a command/resource node up the chain, or undefined. */
function presetFor(layer: Layer, node: unknown): unknown {
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    if (cur.presets.has(node)) return cur.presets.get(node);
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
  layer.watchers.add(w);
  return () => void layer.watchers.delete(w);
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
): unknown {
  if (dep.kind === "controller") return resolveControllerEdge(layer, dep.target, parent);
  const target = dep.target as Tag.Handle<unknown>;
  if (dep.kind === "all") return tagAll(layer, target);
  if (dep.kind === "optional") return tagFind(layer, target);
  return tagRequired(layer, target);
}

function resolveDep(
  layer: Layer,
  dep: Scope.Dependency,
  parent: Observe.Span | undefined,
): unknown {
  if (isEdge(dep)) return resolveEdge(layer, dep, parent);
  if (isData(dep)) return readCell(layer, dep);
  if (isTag(dep)) return tagRequired(layer, dep);
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
  onSettle?: (status: "ok" | "failed") => void,
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
      onSettle?.("failed");
    },
  );
  layer.pending.add(tracked);
}

const asPrimary =
  (layer: Layer) =>
  (error: unknown): void => {
    layer.failure ??= { cause: error };
  };
const asSecondary =
  (layer: Layer) =>
  (error: unknown): void => {
    layer.secondary.push(error);
  };

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

/** Run one cleanup now (so sync teardown stays synchronous), collecting any failure as a
 * secondary error: joined by `settled`/`close` and surfaced via `TeardownFailed`, never
 * settling the owner's outcome (ADR 0017). */
function runCleanup(layer: Layer, fn: () => void | PromiseLike<void>): void {
  let result: void | PromiseLike<void>;
  enterTeardown(layer);
  try {
    result = fn();
  } catch (error) {
    layer.secondary.push(error);
    return;
  } finally {
    exitTeardown(layer);
  }
  track(layer, result, asSecondary(layer));
}

function commandController<T, I>(
  layer: Layer,
  target: Operation.Command<T, I>,
  parent: Observe.Span | undefined,
): Scope.CommandController<T, I> {
  return {
    resolve: (raw?: I) => {
      ensureOpen(layer);
      const obs = layer.obs;
      const span = openSpan(obs, parent, target.label, "operation");
      const override = presetFor(layer, target) as Operation.Command<T, I>["run"] | undefined;
      let result: T;
      try {
        const input = (target.input ? target.input(raw) : (undefined as I)) as I;
        const deps: Record<string, unknown> = {};
        for (const key in target.depends) deps[key] = resolveDep(layer, target.depends[key], span);
        const ctx: Operation.Ctx<I> = {
          label: target.label,
          rawInput: raw,
          input,
          obs: obsCtx(obs, span),
          log: logFor(obs, span),
        };
        result = override ? override(deps, ctx) : target.run(deps, ctx);
      } catch (error) {
        closeSpan(obs, span, "failed");
        throw error;
      }
      track(
        layer,
        result,
        asPrimary(layer),
        span ? (status) => closeSpan(obs, span, status) : undefined,
      );
      return result;
    },
  };
}

function ownerOf(layer: Layer, target: Resource.Handle<unknown>): Layer {
  if (target.target === "session") return layer;
  let cur = layer;
  while (cur.parent) cur = cur.parent;
  return cur;
}

function buildResource<T>(
  owner: Layer,
  target: Resource.Handle<T>,
  parent: Observe.Span | undefined,
): unknown {
  const gen = owner.generations.get(target) ?? 0;
  const superseded = (): boolean => (owner.generations.get(target) ?? 0) !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, parent, target.label, "resource");
  owner.building.add(target);
  let settled = false;
  try {
    const deps: Record<string, unknown> = {};
    for (const key in target.depends) {
      const dep = target.depends[key];
      const node = depNode(dep);
      if (node) addDependent(owner, node, target);
      deps[key] = resolveDep(owner, dep, span);
    }
    const ctx: Resource.Ctx = {
      label: target.label,
      cleanup: (fn) => {
        if (settled) raise("Disposed", { reason: "resource factory already finished" });
        if (superseded()) runCleanup(owner, fn);
        else owner.cleanups.push({ fn, resource: target });
      },
      onOutcome: (fn) => {
        if (settled) raise("Disposed", { reason: "resource factory already finished" });
        if (!superseded()) owner.onOutcomes.push({ fn, resource: target });
      },
      obs: obsCtx(obs, span),
      log: logFor(obs, span),
    };
    const result = target.factory(deps, ctx);
    if (!isThenable(result)) {
      settled = true;
      if (canPublish()) owner.resources.set(target, { value: result });
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
    owner.building.delete(target);
  }
}

/** Wire up an async build: publish on success only if still current, and on rejection drop the
 * in-flight entry and (unless superseded by a replacement) detach the failed build's edges. */
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
      if (owner.builds.get(target) === build) owner.builds.delete(target);
      if (canPublish()) owner.resources.set(target, { value: build });
      closeSpan(obs, span, "ok");
      return value;
    },
    (error) => {
      markSettled();
      if (owner.builds.get(target) === build) owner.builds.delete(target);
      if (!superseded()) detachDependent(owner, target);
      closeSpan(obs, span, "failed");
      throw error;
    },
  );
  if (!superseded()) owner.builds.set(target, build);
  track(owner, build, (error) => {
    if (!superseded()) owner.failure ??= { cause: error };
  });
  return build;
}

function resourceController<T>(
  layer: Layer,
  target: Resource.Handle<T>,
  parent: Observe.Span | undefined,
): Scope.ResourceController<T> {
  const owner = ownerOf(layer, target);
  return {
    resolve: () => {
      ensureOpen(layer);
      ensureOpen(owner);
      recordUsed(layer.obs, parent, target);
      const cached = owner.resources.get(target);
      if (cached) return cached.value as Scope.ResourceValue<T>;
      const inflight = owner.builds.get(target);
      if (inflight) return inflight as Scope.ResourceValue<T>;
      if (owner.building.has(target)) raise("CircularResource", { label: target.label });
      return buildResource(owner, target, parent) as Scope.ResourceValue<T>;
    },
    get: () => {
      ensureOpen(layer);
      ensureOpen(owner);
      const cached = owner.resources.get(target);
      if (!cached) raise("NotResolved", { label: target.label });
      return cached.value as Scope.ResourceValue<T>;
    },
  };
}

type Affected = { node: Node; owner: Layer };

/** Drop a resource's cache/generation/hook-registrations and edges at its owner, running no user
 * callback; returns its cleanups for the caller to run after every affected node is invalidated. */
function invalidateResource(
  owner: Layer,
  target: Resource.Handle<unknown>,
): (() => void | PromiseLike<void>)[] {
  owner.generations.set(target, (owner.generations.get(target) ?? 0) + 1);
  owner.resources.delete(target);
  owner.builds.delete(target);
  owner.onOutcomes = owner.onOutcomes.filter((entry) => entry.resource !== target);
  const mine = owner.cleanups.filter((entry) => entry.resource === target).map((entry) => entry.fn);
  owner.cleanups = owner.cleanups.filter((entry) => entry.resource !== target);
  detachDependent(owner, target);
  owner.dependents.delete(target);
  return mine;
}

/** Drop a cell's shadow (revert to inherited/initial) and edges without notifying watchers. */
function invalidateData(owner: Layer, target: Data.Cell<unknown>): void {
  if (owner.cells.has(target)) {
    owner.cells.delete(target);
    invalidateEff(owner, target);
  }
  owner.dependents.delete(target);
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
    const deps = scope.dependents.get(node);
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

/** Release a node and cascade to its dependents across owners. Two phases so a throwing/closing
 * callback can never strand a dependent: first collect every affected (node, owner) and drop all
 * their caches; then notify watchers and run cleanups (each at its own owner). */
function releaseNode(layer: Layer, target: Node): void {
  ensureOpen(layer);
  const targetOwner = isResource(target) ? ownerOf(layer, target) : layer;
  ensureOpen(targetOwner);
  const order = collectAffected(target, targetOwner);
  const cleanups: { owner: Layer; fn: () => void | PromiseLike<void> }[] = [];
  let dataReleased = false;
  for (const { node, owner } of order) {
    if (owner.closed) continue;
    if (isResource(node))
      for (const fn of invalidateResource(owner, node)) cleanups.push({ owner, fn });
    else {
      invalidateData(owner, node);
      dataReleased = true;
    }
  }
  try {
    if (dataReleased) flushTree(layer);
  } finally {
    for (let i = cleanups.length - 1; i >= 0; i--) runCleanup(cleanups[i].owner, cleanups[i].fn);
  }
}

function addDependent(owner: Layer, node: Node, dependent: Resource.Handle<unknown>): void {
  const set = owner.dependents.get(node);
  if (set) set.add(dependent);
  else owner.dependents.set(node, new Set([dependent]));
}

/** Remove one resource from every dependents set (its incoming edges), dropping empty sets. */
function detachDependent(owner: Layer, dependent: Resource.Handle<unknown>): void {
  for (const [node, set] of owner.dependents) {
    if (set.delete(dependent) && set.size === 0) owner.dependents.delete(node);
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

function seedTags(
  bindings: readonly Tag.Binding<unknown>[] | undefined,
): Map<Tag.Handle<unknown>, unknown[]> {
  const tags = new Map<Tag.Handle<unknown>, unknown[]>();
  for (const binding of bindings ?? []) {
    const list = tags.get(binding.tag) ?? [];
    list.push(binding.value);
    tags.set(binding.tag, list);
  }
  return tags;
}

function seedPresets(seeds: readonly Scope.Preset[] | undefined): {
  cells: Map<Data.Cell<unknown>, Entry>;
  presets: Map<unknown, unknown>;
} {
  const cells = new Map<Data.Cell<unknown>, Entry>();
  const presets = new Map<unknown, unknown>();
  for (const p of seeds ?? []) {
    const node = p.node;
    if (isData(node)) cells.set(node, { value: admit(node.label, node.parse, p.replacement) });
    else presets.set(node, p.replacement);
  }
  return { cells, presets };
}

function makeLayer(parent: Layer | undefined, options?: Scope.Options): Layer {
  const tags = seedTags(options?.tags);
  const { cells, presets } = seedPresets(options?.presets);
  const layer: Layer = {
    parent,
    children: new Set(),
    cells,
    effCache: new Map(),
    resources: new Map(),
    builds: new Map(),
    building: new Set(),
    generations: new Map(),
    dependents: new Map(),
    presets,
    tags,
    watchers: new Set(),
    pending: new Set(),
    cleanups: [],
    onOutcomes: [],
    failure: undefined,
    secondary: [],
    body: undefined,
    closed: false,
    closing: undefined,
    obs: parent ? parent.obs : makeObs(options?.observe),
  };
  if (parent) parent.children.add(layer);
  return layer;
}

const SUCCESS: Scope.Outcome = { status: "success" };

async function drainHooks(
  layer: Layer,
  hooks: (() => void | PromiseLike<void>)[],
  causes: unknown[],
): Promise<void> {
  for (let i = hooks.length - 1; i >= 0; i--) {
    let pending: void | PromiseLike<void>;
    enterTeardown(layer);
    try {
      pending = hooks[i]();
    } catch (cause) {
      causes.push(cause);
      continue;
    } finally {
      exitTeardown(layer);
    }
    try {
      await pending;
    } catch (cause) {
      causes.push(cause);
    }
  }
}

async function joinBody(layer: Layer): Promise<{ cause: unknown } | undefined> {
  if (!layer.body) return undefined;
  try {
    await layer.body;
    return undefined;
  } catch (cause) {
    return { cause };
  }
}

function chooseOutcome(
  outcome: Scope.Outcome,
  body: { cause: unknown } | undefined,
  owned: { cause: unknown } | undefined,
): Scope.Outcome {
  if (body) return { status: "failed", error: body.cause };
  if (owned) return { status: "failed", error: owned.cause };
  return outcome;
}

async function closeChildren(
  layer: Layer,
  outcome: Scope.Outcome,
  causes: unknown[],
): Promise<{ cause: unknown } | undefined> {
  let failure: { cause: unknown } | undefined;
  for (const child of Array.from(layer.children)) {
    try {
      await closeLayer(child, outcome);
    } catch (cause) {
      causes.push(cause);
    }
    failure ??= child.failure;
  }
  return failure;
}

function closeLayer(layer: Layer, outcome: Scope.Outcome = SUCCESS): Promise<void> {
  if (!layer.closing) {
    layer.closed = true;
    layer.closing = startClose(layer, outcome);
  }
  if (closeWouldReenter(layer)) {
    ignoreRejection(layer.closing);
    return Promise.resolve();
  }
  return layer.closing;
}

function startClose(layer: Layer, outcome: Scope.Outcome): Promise<void> {
  const run = async (): Promise<void> => {
    const causes: unknown[] = [];
    const bodyFailure = await joinBody(layer);
    const childFailure = await closeChildren(
      layer,
      chooseOutcome(outcome, bodyFailure, undefined),
      causes,
    );
    while (layer.pending.size) await Promise.all(layer.pending);
    const settled = chooseOutcome(outcome, bodyFailure, layer.failure ?? childFailure);
    if (settled.status === "failed") layer.failure = { cause: settled.error };
    await drainHooks(
      layer,
      layer.onOutcomes.map((entry) => () => entry.fn(settled)),
      causes,
    );
    await drainHooks(
      layer,
      layer.cleanups.map((entry) => entry.fn),
      causes,
    );
    if (layer.secondary.length) causes.push(...layer.secondary);
    layer.parent?.children.delete(layer);
    layer.cells.clear();
    layer.effCache.clear();
    layer.resources.clear();
    layer.builds.clear();
    layer.building.clear();
    layer.generations.clear();
    layer.dependents.clear();
    layer.presets.clear();
    layer.tags.clear();
    layer.watchers.clear();
    layer.pending.clear();
    layer.children.clear();
    layer.cleanups.length = 0;
    layer.onOutcomes.length = 0;
    layer.secondary.length = 0;
    if (causes.length) throw makeError("TeardownFailed", { causes });
  };
  return Promise.resolve().then(run);
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
  const body = (async (): Promise<R> => fn(handleFor(child)))();
  child.body = body;
  let result: R | undefined;
  let cause: unknown;
  let failed = false;
  try {
    result = await body;
  } catch (error) {
    failed = true;
    cause = error;
  }
  const outcome: Scope.Outcome = failed ? { status: "failed", error: cause } : SUCCESS;
  let teardownCauses: unknown[] | undefined;
  try {
    await closeLayer(child, outcome);
  } catch (error) {
    if (!isError(error, "TeardownFailed")) throw error;
    teardownCauses = error.payload.causes;
  }
  settleSession(
    failed || child.failure !== undefined,
    failed ? cause : child.failure?.cause,
    teardownCauses,
  );
  return result as R;
}

function handleFor(layer: Layer): Scope.Handle {
  const settled = async (): Promise<void> => {
    while (layer.pending.size) await Promise.all(layer.pending);
  };
  return {
    getController: (<T, I>(target: Data.Cell<T> | Resource.Handle<T> | Operation.Command<T, I>) => {
      ensureOpen(layer);
      if (isData(target)) return dataController(layer, target);
      if (isResource(target)) return resourceController(layer, target, undefined);
      return commandController(layer, target, undefined);
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
      layer.cleanups.push({ fn, resource: undefined });
    },
    settled,
    close: (outcome?: Scope.Outcome) => closeLayer(layer, outcome),
  };
}

/** Create a scope: the root of a layer chain that resolves cells, tags, and commands to controllers. */
export function createScope(options?: Scope.Options): Scope.Handle {
  return handleFor(makeLayer(undefined, options));
}

export { isError };
export type { Errors } from "./errors.ts";
