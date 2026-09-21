/** Payload type for each process error. The registry is the only place this package throws. */
type Payloads = {
  NoProcess: {
    reason: string;
  };
};

export declare namespace Errors {
  /** Every process error name. */
  export type Name = keyof Payloads;
  /** The typed payload carried by one error name. */
  export type Payload<N extends Name> = Payloads[N];
  /** An process error: identified by `kind`, carrying a typed `payload`. */
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Build a registry error without throwing (for rejecting a promise). */
export function makeError<N extends Errors.Name>(
  kind: N,
  payload: Errors.Payload<N>,
): Errors.Of<N> {
  const error = new Error(kind) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  return error;
}

/** Throw a registry error. The only throw site in the package. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw makeError(kind, payload);
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
