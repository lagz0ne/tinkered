import { raise } from "./errors.ts";

const cell: unique symbol = Symbol("data");
const command: unique symbol = Symbol("operation");
const tagSym: unique symbol = Symbol("tag");
const edge: unique symbol = Symbol("edge");

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

export declare namespace Scope {
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

  /** What `createScope()` returns: the one seam tests and callers touch. */
  export type Handle = {
    getController<T>(target: Data.Cell<T>): DataController<T>;
    getController<T, I>(target: Operation.Command<T, I>): CommandController<T, I>;
  };
}

const isData = (n: unknown): n is Data.Cell<unknown> =>
  typeof n === "object" && n !== null && cell in n;
const isCommand = (n: unknown): n is Operation.Command<unknown, unknown> =>
  typeof n === "object" && n !== null && command in n;
const isTag = (n: unknown): n is Tag.Handle<unknown> => typeof n === "function" && tagSym in n;
const isEdge = (n: unknown): n is Edge<string, unknown> =>
  typeof n === "object" && n !== null && edge in n;

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

type Entry = { value: unknown };
type Watcher = {
  read: () => unknown;
  last: unknown;
  eq: (a: unknown, b: unknown) => boolean;
  fn: (next: unknown) => void;
};

/** Create a scope: the graph that resolves cells, tags, and commands to controllers. */
export function createScope(options?: Scope.Options): Scope.Handle {
  const entries = new Map<Data.Cell<unknown>, Entry>();
  const watchers = new Set<Watcher>();
  const tags = new Map<Tag.Handle<unknown>, unknown[]>();
  for (const binding of options?.tags ?? []) {
    const list = tags.get(binding.tag) ?? [];
    list.push(binding.value);
    tags.set(binding.tag, list);
  }

  const eqOf =
    <T>(target: Data.Cell<T>) =>
    (a: unknown, b: unknown): boolean =>
      target.eq(a as T, b as T);

  const entryOf = (target: Data.Cell<unknown>): Entry => {
    let entry = entries.get(target);
    if (!entry) {
      entry = { value: target.initial };
      entries.set(target, entry);
    }
    return entry;
  };

  const flush = () => {
    for (const w of watchers) {
      const next = w.read();
      if (!w.eq(w.last, next)) {
        w.last = next;
        w.fn(next);
      }
    }
  };

  const write = <T>(target: Data.Cell<T>, next: unknown) => {
    const value = admit(target.label, target.parse, next);
    const entry = entryOf(target);
    if (eqOf(target)(entry.value, value)) return;
    entry.value = value;
    flush();
  };

  const tagFind = (target: Tag.Handle<unknown>): Tag.Presence<unknown> => {
    const list = tags.get(target);
    if (list && list.length) return { present: true, value: list[list.length - 1] };
    return target.hasDefault ? { present: true, value: target.def } : { present: false };
  };
  const tagAll = (target: Tag.Handle<unknown>): unknown[] => {
    const list = tags.get(target) ?? [];
    return [...list].reverse();
  };
  const tagRequired = (target: Tag.Handle<unknown>): unknown => {
    const found = tagFind(target);
    if (!found.present) raise("MissingTag", { label: target.label });
    return found.value;
  };

  const dataController = <T>(target: Data.Cell<T>): Scope.DataController<T> => {
    const read = (): T => entryOf(target).value as T;
    return {
      get: read,
      read,
      set: (value: T) => write(target, value),
      update: (fn: (previous: T) => T) => write(target, fn(read())),
      watch: (listener: (next: T) => void) => {
        const w: Watcher = {
          read: read as () => unknown,
          last: read(),
          eq: eqOf(target),
          fn: listener as (next: unknown) => void,
        };
        watchers.add(w);
        return () => void watchers.delete(w);
      },
    };
  };

  const commandController = <T, I>(
    target: Operation.Command<T, I>,
  ): Scope.CommandController<T, I> => ({
    resolve: (raw?: I) => {
      const input = (target.input ? target.input(raw) : (undefined as I)) as I;
      const deps: Record<string, unknown> = {};
      for (const key in target.depends) deps[key] = resolveDep(target.depends[key]);
      return target.run(deps, { label: target.label, rawInput: raw, input });
    },
  });

  const resolveControllerEdge = (target: unknown): unknown => {
    if (isData(target)) return dataController(target);
    if (isCommand(target)) return commandController(target);
    raise("InvalidDependency", { label: "edge", reason: "unknown controller target" });
  };

  const resolveEdge = (dep: Edge<string, unknown>): unknown => {
    if (dep.kind === "controller") return resolveControllerEdge(dep.target);
    const target = dep.target as Tag.Handle<unknown>;
    if (dep.kind === "all") return tagAll(target);
    if (dep.kind === "optional") return tagFind(target);
    return tagRequired(target);
  };

  const resolveDep = (dep: Scope.Dependency): unknown => {
    if (isEdge(dep)) return resolveEdge(dep);
    if (isData(dep)) return entryOf(dep).value;
    if (isTag(dep)) return tagRequired(dep);
    if (isCommand(dep))
      raise("InvalidDependency", {
        label: dep.label,
        reason: "a command is not a value; depend on `command.controller`",
      });
    raise("InvalidDependency", { label: "unknown", reason: "unknown dependency" });
  };

  const handle: Scope.Handle = {
    getController: (<T, I>(target: Data.Cell<T> | Operation.Command<T, I>) =>
      isData(target)
        ? dataController(target)
        : commandController(target)) as Scope.Handle["getController"],
  };
  return handle;
}

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
