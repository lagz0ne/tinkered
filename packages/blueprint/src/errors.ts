/** Payload type for each blueprint error. The registry is the only place this package throws. */
type Payloads = {
  InvalidBlueprint: { text: string; issues: readonly unknown[] };
  InvalidTemplate: { file: string; issues: readonly unknown[] };
  BlueprintRejected: { findings: readonly string[] };
  NoKey: Record<string, never>;
  JevUnavailable: Record<string, never>;
};

export declare namespace Errors {
  /** Every blueprint error name. */
  export type Name = keyof Payloads;
  /** The typed payload carried by one error name. */
  export type Payload<N extends Name> = Payloads[N];
  /** A blueprint error: identified by `kind`, carrying a typed `payload`. */
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Throw a registry error. The only throw site in the package. The message
 * defaults to the kind; a caller passes its own when stderr should show
 * more — the cli prints the message. */
export function raise<N extends Errors.Name>(
  kind: N,
  payload: Errors.Payload<N>,
  message: string = kind,
): never {
  const error = new Error(message) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  throw error;
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
