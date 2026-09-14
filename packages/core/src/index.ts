const cell: unique symbol = Symbol("data");

export declare namespace Data {
  /** Validates raw input into a trusted value once, at the process edge. */
  export type Parse<T> = (raw: unknown) => T;

  /** A reactive value cell — the only reactive unit. `createScope` reads and (later) writes it. */
  export type Cell<T> = {
    readonly [cell]: true;
    readonly label: string;
    readonly initial: T;
    readonly parse: Parse<T> | undefined;
    eq(a: T, b: T): boolean;
  };
}

export declare namespace Scope {
  /** A read (and, from later slices, write) handle onto one cell. */
  export type Controller<T> = {
    get(): T;
    read(): T;
  };

  /** What `createScope()` returns: the one seam tests and callers touch. */
  export type Handle = {
    getController<T>(target: Data.Cell<T>): Controller<T>;
  };
}

/** Declare a reactive value cell. `parse` validates the initial value once. */
export function data<T>(config: {
  label?: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Data.Cell<T> {
  return {
    [cell]: true,
    label: config.label ?? "anon",
    initial: config.parse ? config.parse(config.initial) : config.initial,
    parse: config.parse,
    eq: config.eq ?? Object.is,
  };
}

/** Create a scope: the graph that resolves cells to controllers. */
export function createScope(): Scope.Handle {
  const values = new Map<Data.Cell<unknown>, unknown>();
  return {
    getController<T>(target: Data.Cell<T>): Scope.Controller<T> {
      if (!values.has(target)) values.set(target, target.initial);
      const read = (): T => values.get(target) as T;
      return { get: read, read };
    },
  };
}
