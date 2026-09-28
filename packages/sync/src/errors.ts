type Payloads = {
  SyncConflict: { key: string };
  /** `missing` holds the keys still without a snapshot when a subscribe start broke. */
  SyncNotReady: { label: string; missing: readonly string[] };
};

export declare namespace Errors {
  export type Name = keyof Payloads;
  export type Payload<N extends Name> = Payloads[N];
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Build a registry error without throwing it — for a rejected promise.
 * `raise` throws exactly this. The only construction site in the package. */
export function fail<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): Errors.Of<N> {
  const error = new Error(kind) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  return error;
}

/** Throw a registry error. The only throw site in the package. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw fail(kind, payload);
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
