/** Payload type for each mcp error. The registry is empty: this package throws nothing (a
 * call's failure answers a tool error result), so it exports no `isError` to narrow with. */
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
