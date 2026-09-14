import { makeError, raise } from "./errors.ts";

const cell: unique symbol = Symbol("data");
const command: unique symbol = Symbol("operation");
const tagSym: unique symbol = Symbol("tag");
const edge: unique symbol = Symbol("edge");
const resourceSym: unique symbol = Symbol("resource");

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

export declare namespace Operation {
  /** The receiver a command body reads its own invocation through. */
  export type Ctx<I> = {
    readonly label: string;
    readonly rawInput: unknown;
    readonly input: I;
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
  /** The receiver a resource factory builds through: register per-instance cleanup. */
  export type Ctx = {
    readonly label: string;
    readonly cleanup: (fn: () => void | PromiseLike<void>) => void;
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

  /** A callable handle onto one command. */
  export type CommandController<T, I> = {
    resolve(input?: I): T;
  };

  export type Dependency =
    | Data.Cell<unknown>
    | Operation.Command<unknown, unknown>
    | Tag.Handle<any>
    | Edge<"controller", Data.Cell<unknown> | Operation.Command<unknown, unknown>>
    | Edge<"required" | "optional" | "all", Tag.Handle<any>>;
  export type Depends = Readonly<Record<string, Dependency>>;

  /** Maps one declared dependency to the value delivered in `deps` — exact, no casts in userland. */
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
                : never;
  export type SlotValues<D extends Depends> = { [K in keyof D]: SlotValue<D[K]> };

  /** Values seeded on a scope at creation. */
  export type Options = { tags?: readonly Tag.Binding<unknown>[] };

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
    /** Register a userland teardown hook, run (LIFO) when this scope closes. */
    onClose(fn: () => void | PromiseLike<void>): void;
    /** Resolve once all in-flight command work owned by this scope has settled. */
    settled(): Promise<void>;
    /** Close children first, join owned work, run teardown, then seal so late acts fail. */
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

type Entry = { value: unknown };
type Watcher = {
  read: () => unknown;
  last: unknown;
  eq: (a: unknown, b: unknown) => boolean;
  fn: (next: unknown) => void;
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
  generation: number;
  tags: Map<Tag.Handle<unknown>, unknown[]>;
  watchers: Set<Watcher>;
  pending: Set<Promise<unknown>>;
  onCloses: (() => void | PromiseLike<void>)[];
  closed: boolean;
  closing: Promise<void> | undefined;
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

function resolveControllerEdge(layer: Layer, target: unknown): unknown {
  if (isData(target)) return dataController(layer, target);
  if (isCommand(target)) return commandController(layer, target);
  raise("InvalidDependency", { label: "edge", reason: "unknown controller target" });
}

function resolveEdge(layer: Layer, dep: Edge<string, unknown>): unknown {
  if (dep.kind === "controller") return resolveControllerEdge(layer, dep.target);
  const target = dep.target as Tag.Handle<unknown>;
  if (dep.kind === "all") return tagAll(layer, target);
  if (dep.kind === "optional") return tagFind(layer, target);
  return tagRequired(layer, target);
}

function resolveDep(layer: Layer, dep: Scope.Dependency): unknown {
  if (isEdge(dep)) return resolveEdge(layer, dep);
  if (isData(dep)) return readCell(layer, dep);
  if (isTag(dep)) return tagRequired(layer, dep);
  if (isCommand(dep))
    raise("InvalidDependency", {
      label: dep.label,
      reason: "a command is not a value; depend on `command.controller`",
    });
  raise("InvalidDependency", { label: "unknown", reason: "unknown dependency" });
}

function track(layer: Layer, result: unknown): void {
  if (!isThenable(result)) return;
  const tracked: Promise<unknown> = Promise.resolve(result).then(
    () => layer.pending.delete(tracked),
    () => layer.pending.delete(tracked),
  );
  layer.pending.add(tracked);
}

function commandController<T, I>(
  layer: Layer,
  target: Operation.Command<T, I>,
): Scope.CommandController<T, I> {
  return {
    resolve: (raw?: I) => {
      ensureOpen(layer);
      const input = (target.input ? target.input(raw) : (undefined as I)) as I;
      const deps: Record<string, unknown> = {};
      for (const key in target.depends) deps[key] = resolveDep(layer, target.depends[key]);
      const result = target.run(deps, { label: target.label, rawInput: raw, input });
      track(layer, result);
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

function buildResource<T>(owner: Layer, target: Resource.Handle<T>): unknown {
  owner.building.add(target);
  let settled = false;
  try {
    const deps: Record<string, unknown> = {};
    for (const key in target.depends) deps[key] = resolveDep(owner, target.depends[key]);
    const ctx: Resource.Ctx = {
      label: target.label,
      cleanup: (fn) => {
        if (settled) raise("Disposed", { reason: "resource factory already finished" });
        owner.onCloses.push(fn);
      },
    };
    const result = target.factory(deps, ctx);
    if (!isThenable(result)) {
      settled = true;
      owner.resources.set(target, { value: result });
      return result;
    }
    const gen = owner.generation;
    const build: Promise<unknown> = Promise.resolve(result).then(
      (value) => {
        settled = true;
        if (owner.builds.get(target) === build) owner.builds.delete(target);
        if (!owner.closed && owner.generation === gen)
          owner.resources.set(target, { value: build });
        return value;
      },
      (error) => {
        settled = true;
        if (owner.builds.get(target) === build) owner.builds.delete(target);
        throw error;
      },
    );
    owner.builds.set(target, build);
    track(owner, build);
    return build;
  } finally {
    owner.building.delete(target);
  }
}

function resourceController<T>(
  layer: Layer,
  target: Resource.Handle<T>,
): Scope.ResourceController<T> {
  const owner = ownerOf(layer, target);
  return {
    resolve: () => {
      ensureOpen(layer);
      ensureOpen(owner);
      const cached = owner.resources.get(target);
      if (cached) return cached.value as Scope.ResourceValue<T>;
      const inflight = owner.builds.get(target);
      if (inflight) return inflight as Scope.ResourceValue<T>;
      if (owner.building.has(target)) raise("CircularResource", { label: target.label });
      return buildResource(owner, target) as Scope.ResourceValue<T>;
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

function makeLayer(parent: Layer | undefined, options?: Scope.Options): Layer {
  const tags = new Map<Tag.Handle<unknown>, unknown[]>();
  for (const binding of options?.tags ?? []) {
    const list = tags.get(binding.tag) ?? [];
    list.push(binding.value);
    tags.set(binding.tag, list);
  }
  const layer: Layer = {
    parent,
    children: new Set(),
    cells: new Map(),
    effCache: new Map(),
    resources: new Map(),
    builds: new Map(),
    building: new Set(),
    generation: 0,
    tags,
    watchers: new Set(),
    pending: new Set(),
    onCloses: [],
    closed: false,
    closing: undefined,
  };
  if (parent) parent.children.add(layer);
  return layer;
}

function closeLayer(layer: Layer): Promise<void> {
  if (layer.closing) return layer.closing;
  layer.closed = true;
  layer.generation++;
  const children = Array.from(layer.children);
  const run = async (): Promise<void> => {
    const causes: unknown[] = [];
    for (const child of children) {
      try {
        await closeLayer(child);
      } catch (cause) {
        causes.push(cause);
      }
    }
    while (layer.pending.size) await Promise.all(layer.pending);
    for (let i = layer.onCloses.length - 1; i >= 0; i--) {
      try {
        await layer.onCloses[i]();
      } catch (cause) {
        causes.push(cause);
      }
    }
    layer.parent?.children.delete(layer);
    layer.cells.clear();
    layer.effCache.clear();
    layer.resources.clear();
    layer.builds.clear();
    layer.building.clear();
    layer.tags.clear();
    layer.watchers.clear();
    layer.pending.clear();
    layer.children.clear();
    layer.onCloses.length = 0;
    if (causes.length) throw makeError("TeardownFailed", { causes });
  };
  layer.closing = Promise.resolve().then(run);
  return layer.closing;
}

function handleFor(layer: Layer): Scope.Handle {
  const settled = async (): Promise<void> => {
    while (layer.pending.size) await Promise.all(layer.pending);
  };
  return {
    getController: (<T, I>(target: Data.Cell<T> | Resource.Handle<T> | Operation.Command<T, I>) => {
      ensureOpen(layer);
      if (isData(target)) return dataController(layer, target);
      if (isResource(target)) return resourceController(layer, target);
      return commandController(layer, target);
    }) as Scope.Handle["getController"],
    createSession: (options?: Scope.Options) => {
      ensureOpen(layer);
      return handleFor(makeLayer(layer, options));
    },
    onClose: (fn: () => void | PromiseLike<void>) => {
      ensureOpen(layer);
      layer.onCloses.push(fn);
    },
    settled,
    close: () => closeLayer(layer),
  };
}

/** Create a scope: the root of a layer chain that resolves cells, tags, and commands to controllers. */
export function createScope(options?: Scope.Options): Scope.Handle {
  return handleFor(makeLayer(undefined, options));
}

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
