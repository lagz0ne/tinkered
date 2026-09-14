/** Payload type for each core error. The registry is the only place core throws. */
type Payloads = {
  DataValidationFailed: { label: string; cause: unknown };
  InvalidDependency: { label: string; reason: string };
};

export declare namespace Errors {
  /** Every core error name. */
  export type Name = keyof Payloads;
  /** The typed payload carried by one error name. */
  export type Payload<N extends Name> = Payloads[N];
  /** A core error: identified by `kind`, carrying a typed `payload`. */
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Throw a registry error. The only throw site in the package. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  const error = new Error(kind) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  throw error;
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
