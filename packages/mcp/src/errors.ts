/** Payload type for each mcp error. The registry is empty: this package throws nothing today
 * (a call's failure answers `isError`). `isError` narrows nothing yet and stays for the public
 * surface. */
type Payloads = Record<never, never>;

export declare namespace Errors {
  /** Every mcp error name. */
  export type Name = keyof Payloads;
  /** The typed payload carried by one error name. */
  export type Payload<N extends Name> = Payloads[N];
  /** An mcp error: identified by `kind`, carrying a typed `payload`. */
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
