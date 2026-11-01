// Prototype of the proposed Core API. Not Core: a small model to type-check and run.

const tagSym = Symbol("tag");
const extensionSym = Symbol("extension");
const unitSym = Symbol("unit");

/* ---------- Tag: one change, the type knows if there is a default ---------- */

export declare namespace Tag {
  type Binding<T> = { readonly tag: Handle<any, boolean>; readonly value: T };
  type Handle<T, D extends boolean = boolean> = {
    readonly [tagSym]: true;
    readonly label: string;
    readonly hasDefault: D;
    readonly def: T | undefined;
    (value: T): Binding<T>;
  };
  type Value<H> = H extends Handle<infer T, any> ? T : never;
}

export function tag<T>(config: { label: string; default: T }): Tag.Handle<T, true>;
export function tag<T>(config: { label: string }): Tag.Handle<T, false>;
export function tag<T>(config: { label: string; default?: T }): Tag.Handle<T, boolean> {
  const handle = Object.assign((value: T): Tag.Binding<T> => ({ tag: handle, value }), {
    [tagSym]: true as const,
    label: config.label,
    hasDefault: "default" in config,
    def: config.default,
  });
  return handle as Tag.Handle<T, boolean>;
}

/* ---------- Units: stand-ins for operation and resource ---------- */

export type Unit<O = unknown> = { readonly [unitSym]: true; readonly label: string; readonly out?: O };

export function operation<O>(label: string): Unit<O> {
  return { [unitSym]: true, label };
}
export const resource = operation;

/* ---------- Extension: Handle (shape) -> call -> Binding, like Tag ---------- */

export declare namespace Extension {
  /** Config as declared: key -> tag. */
  type Shape = Record<string, Tag.Handle<any, boolean>>;

  type RequiredKeys<S extends Shape> = {
    [K in keyof S]: S[K] extends Tag.Handle<any, false> ? K : never;
  }[keyof S];
  type OptionalKeys<S extends Shape> = Exclude<keyof S, RequiredKeys<S>>;

  /**
   * Values as given. A tag with no default is a required KEY: leaving it out is a type error.
   * Its value may still be `undefined` (an env var not set): Core then fails start and names it.
   * An optional key may be left out or `undefined`: the tag's default stays.
   */
  type Values<S extends Shape> = {
    [K in RequiredKeys<S>]: Tag.Value<S[K]> | undefined;
  } & {
    [K in OptionalKeys<S>]?: Tag.Value<S[K]> | undefined;
  };

  /** Config as the hooks read it: checked, defaults filled. */
  type Config<S extends Shape> = { [K in keyof S]: Tag.Value<S[K]> };

  /** What the extension holds; flat on the handle (`mail.enqueue`). */
  type Exports = Record<string, Unit<any> | Handle<any, any>>;

  type Reserved = "label" | "config" | "hooks";

  type Explain = {
    readonly explain: string;
    readonly watches?: readonly Unit[];
    readonly changes?: readonly Unit[];
  };

  /** One live record line: what an extension loaded, and its state now. */
  type Loaded = {
    readonly unit: string;
    readonly explain: string;
    readonly watches: readonly string[];
    readonly changes: readonly string[];
    status: "loading" | "ready" | "running" | "failed" | "released";
  };

  type Start<S extends Shape> = {
    readonly config: Config<S>;
    /** The one verb: build or run a unit, and record why. Works at any time. */
    load<O>(unit: Unit<O>, why: Explain): Promise<O | undefined>;
    next(): Promise<void>;
  };

  type Hooks<S extends Shape> = {
    start?(event: Start<S>): Promise<void>;
  };

  type Handle<S extends Shape, E extends Exports> = {
    readonly [extensionSym]: true;
    readonly label: string;
    readonly config: S;
    readonly hooks: Hooks<S> | undefined;
  } & ([Extensions.RequiredOf<S>] extends [never]
    ? (values?: Values<S>) => Binding
    : (values: Values<S>) => Binding) &
    E;

  type Binding = {
    readonly extension: Handle<any, any>;
    readonly values: Record<string, unknown>;
  };
}

declare namespace Extensions {
  type RequiredOf<S extends Extension.Shape> = Extension.RequiredKeys<S>;
}

export function extension<
  const S extends Extension.Shape = {},
  const E extends Extension.Exports = {},
>(def: {
  label: string;
  config?: S;
  exports?: E & { [K in Extension.Reserved]?: never };
  hooks?: Extension.Hooks<S>;
}): Extension.Handle<S, E> {
  const bind = (values: Record<string, unknown> = {}): Extension.Binding => ({
    extension: handle as Extension.Handle<any, any>,
    values,
  });
  const handle = Object.assign(bind, def.exports ?? {}, {
    [extensionSym]: true as const,
    label: def.label,
    config: def.config ?? ({} as S),
    hooks: def.hooks,
  });
  return handle as unknown as Extension.Handle<S, E>;
}

/* ---------- Scope: seeds config, checks it, keeps the live record ---------- */

export type Record_ = { label: string; config: Record<string, unknown>; loaded: Extension.Loaded[] };

export class MissingConfig extends Error {
  constructor(readonly key: string) {
    super(`Missing config: ${key}`);
  }
}

const secret = /secret|password|token/i;

export function createScope(options: {
  extensions?: readonly (Extension.Binding | false | undefined)[];
  tags?: readonly (Tag.Binding<unknown> | false | undefined)[];
}) {
  const values = new Map<Tag.Handle<any, boolean>, unknown>();
  for (const binding of options.tags ?? []) if (binding) values.set(binding.tag, binding.value);

  const records: Record_[] = [];
  const events: string[] = [];
  const bindings = (options.extensions ?? []).filter((b): b is Extension.Binding => !!b);

  const ready = (async () => {
    for (const { extension, values: given } of bindings) {
      const config: Record<string, unknown> = {};
      const shown: Record<string, unknown> = {};
      for (const [key, t] of Object.entries(extension.config as Extension.Shape)) {
        const value = given[key] === undefined ? t.def : given[key];
        if (value === undefined && !t.hasDefault) throw new MissingConfig(t.label);
        values.set(t, value);
        config[key] = value;
        shown[key] = secret.test(key) ? "[hidden]" : value;
      }
      const record: Record_ = { label: extension.label, config: shown, loaded: [] };
      records.push(record);
      await extension.hooks?.start?.({
        config: config as never,
        next: async () => {},
        async load(unit: Unit<unknown>, why: Extension.Explain) {
          const line: Extension.Loaded = {
            unit: unit.label,
            explain: why.explain,
            watches: (why.watches ?? []).map((u: Unit) => u.label),
            changes: (why.changes ?? []).map((u: Unit) => u.label),
            status: "ready",
          };
          record.loaded.push(line);
          events.push(`loaded ${extension.label} > ${unit.label}`);
          return undefined;
        },
      } as Extension.Start<Extension.Shape>);
    }
  })();

  return {
    ready,
    read: <T>(t: Tag.Handle<T, boolean>) => values.get(t) as T,
    /** Live: the current record of every extension. */
    get extensions(): readonly Record_[] {
      return records;
    },
    events,
  };
}
