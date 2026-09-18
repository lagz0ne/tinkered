/** Payload type for each cli error. The registry is the only place this package throws. */
type Payloads = {
  UnknownCommand: { name: string; known: readonly string[] };
};

export declare namespace Errors {
  /** Every cli error name. */
  export type Name = keyof Payloads;
  /** The typed payload carried by one error name. */
  export type Payload<N extends Name> = Payloads[N];
  /** A cli error: identified by `kind`, carrying a typed `payload`. */
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
