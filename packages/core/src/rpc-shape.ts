import type { Data } from "./index";

// The few value shapes the protocol checks itself, as Standard Schema values (ADR 0130 decision 5).
// Core keeps no schema dependency: a contract brings its own library (zod, valibot, arktype), and
// these cover only the protocol's own op inputs. The names follow zod's, so the code reads the same.

type Result<T> = Data.SchemaResult<T>;

/** A Standard Schema value with the two reads the protocol uses. */
export type Shape<T> = Data.Schema<T> & {
  readonly check: (value: unknown) => Result<T>;
  readonly optional: () => OptionalShape<T>;
};

/** A field an object may leave out. */
export type OptionalShape<T> = Shape<T | undefined> & { readonly isOptional: true };

type Fields = Readonly<Record<string, Data.Schema<unknown>>>;

/** The value type a Standard Schema gives. */
export type Infer<S> =
  S extends Data.Schema<infer T> ? T : S extends (raw: unknown) => infer T ? T : never;

type Optional<F extends Fields> = {
  [K in keyof F]: F[K] extends { readonly isOptional: true } ? K : never;
}[keyof F];

/** An object's value: an `.optional()` field may be left out, as in zod. */
type ObjectOf<F extends Fields> = {
  [K in Exclude<keyof F, Optional<F>>]: Infer<F[K]>;
} & { [K in Optional<F>]?: Infer<F[K]> };

type Flat<T> = { [K in keyof T]: T[K] };

/** An object shape: its fields stay readable, so a contract field can be found by its mark. */
export type ObjectShape<F extends Fields> = Shape<Flat<ObjectOf<F>>> & {
  readonly shape: F;
  readonly extend: <G extends Fields>(more: G) => ObjectShape<Flat<Omit<F, keyof G> & G>>;
};

/** A shape from its check. */
export function make<T>(check: (value: unknown) => Result<T>): Shape<T> {
  return {
    "~standard": { version: 1, vendor: "tinker", validate: check },
    check,
    optional: () =>
      Object.assign(
        make<T | undefined>((v) => (v === undefined ? { value: undefined } : check(v))),
        { isOptional: true as const },
      ),
  };
}

export const fail = (message: string): Result<never> => ({ issues: [{ message }] });

/** Checks a value against any Standard Schema; a promise result is refused, as an edge parses sync. */
export function checkWith<T>(schema: Data.Schema<T>, value: unknown): Result<T> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) return fail("an async schema cannot check a protocol value");

  return result.issues ? { issues: result.issues } : { value: result.value };
}

/** A string; `.regex` narrows it to a pattern. */
export const string = () => {
  const of = (re?: RegExp) =>
    make<string>((v) => {
      if (typeof v !== "string") return fail("expected a string");
      if (re && !re.test(v)) return fail(`expected ${String(re)}`);

      return { value: v };
    });

  return Object.assign(of(), { regex: (re: RegExp) => of(re) });
};

export const unknown = () => make<unknown>((v) => ({ value: v }));

const nil = () => make<null>((v) => (v === null ? { value: null } : fail("expected null")));

/** A value the predicate admits, as it is. */
export const custom = <T>(admits: (v: unknown) => boolean, message = "unexpected value") =>
  make<T>((v) => (admits(v) ? { value: v as T } : fail(message)));

/** Keys of one shape to values of another, as zod's `record(key, value)`. */
export function record<V>(
  key: Data.Schema<string>,
  value: Data.Schema<V>,
): Shape<Record<string, V>> {
  return make<Record<string, V>>((v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail("expected an object");

    const out: Record<string, V> = {};
    for (const [k, each] of Object.entries(v)) {
      if (checkWith(key, k).issues) return fail(`bad key "${k}"`);

      const got = checkWith(value, each);
      if (got.issues) return { issues: got.issues };

      out[k] = got.value;
    }

    return { value: out };
  });
}

export function array<V>(item: Data.Schema<V>): Shape<V[]> {
  return make<V[]>((v) => {
    if (!Array.isArray(v)) return fail("expected an array");

    const out: V[] = [];
    for (const each of v) {
      const got = checkWith(item, each);
      if (got.issues) return { issues: got.issues };

      out.push(got.value);
    }

    return { value: out };
  });
}

export function object<F extends Fields>(fields: F): ObjectShape<F> {
  const check = (v: unknown): Result<Flat<ObjectOf<F>>> => {
    if (typeof v !== "object" || v === null) return fail("expected an object");

    const out: Record<string, unknown> = {};
    for (const [k, field] of Object.entries(fields)) {
      const got = checkWith(field, (v as Record<string, unknown>)[k]);
      if (got.issues) {
        return { issues: got.issues.map((i) => ({ ...i, path: [k, ...(i.path ?? [])] })) };
      }

      if (got.value !== undefined || k in v) out[k] = got.value;
    }

    return { value: out as Flat<ObjectOf<F>> };
  };

  return Object.assign(make(check), {
    shape: fields,
    extend: <G extends Fields>(more: G) =>
      object({ ...fields, ...more } as Flat<Omit<F, keyof G> & G>),
  });
}

export { nil as null };
export type { Infer as infer };
