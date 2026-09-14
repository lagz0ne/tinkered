import { raise } from "./errors.ts";

const cell: unique symbol = Symbol("data");

export declare namespace Data {
  /** Validates raw input into a trusted value once, at the process edge. */
  export type Parse<T> = (raw: unknown) => T;

  /** A reactive value cell — the only reactive unit. `createScope` reads and writes it. */
  export type Cell<T> = {
    readonly [cell]: true;
    readonly label: string;
    readonly initial: T;
    readonly parse: Parse<T> | undefined;
    eq(a: T, b: T): boolean;
  };
}

export declare namespace Scope {
  /** A read/write handle onto one cell. */
  export type Controller<T> = {
    get(): T;
    read(): T;
    set(value: T): void;
    update(fn: (previous: T) => T): void;
    watch(listener: (next: T) => void): () => void;
  };

  /** What `createScope()` returns: the one seam tests and callers touch. */
  export type Handle = {
    getController<T>(target: Data.Cell<T>): Controller<T>;
  };
}

/** Admit a raw value through the cell's parser once; parse failures become a registry error. */
function admit<T>(target: Data.Cell<T>, raw: unknown): T {
  if (!target.parse) return raw as T;
  try {
    return target.parse(raw);
  } catch (cause) {
    raise("DataValidationFailed", { label: target.label, cause });
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
  const target = {
    [cell]: true,
    label,
    initial: undefined as T,
    parse: config.parse,
    eq: config.eq ?? Object.is,
  } as Data.Cell<T>;
  return { ...target, initial: admit(target, config.initial) };
}

type Entry = { value: unknown };
type Watcher = {
  read: () => unknown;
  last: unknown;
  eq: (a: unknown, b: unknown) => boolean;
  fn: (next: unknown) => void;
};

/** Create a scope: the graph that resolves cells to controllers. */
export function createScope(): Scope.Handle {
  const entries = new Map<Data.Cell<unknown>, Entry>();
  const watchers = new Set<Watcher>();

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
    const value = admit(target, next);
    const entry = entryOf(target);
    if (eqOf(target)(entry.value, value)) return;
    entry.value = value;
    flush();
  };

  return {
    getController<T>(target: Data.Cell<T>): Scope.Controller<T> {
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
    },
  };
}

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
