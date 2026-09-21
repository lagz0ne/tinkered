/** Payload type for each blueprint error. The registry is the only place this package throws. */
type Payloads = {
  InvalidBlueprint: { text: string; issues: readonly unknown[] };
  BlueprintRejected: { findings: readonly string[] };
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
 * carries the payload lines when there are any (a rejection's finding lines),
 * else the kind — the cli prints the message on stderr. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  const lines = (payload as { findings?: readonly string[] }).findings;
  const error = new Error(
    lines !== undefined && lines.length > 0 ? lines.join("\n") : kind,
  ) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  throw error;
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
