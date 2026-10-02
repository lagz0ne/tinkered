/** Payload type for each mcp error. The registry is empty: this package throws nothing (a
 * call's failure answers a tool error result), so it exports no `isError` to narrow with. */
type Payloads = Record<never, never>;

export declare namespace Errors {
  export type Name = keyof Payloads;
  export type Payload<N extends Name> = Payloads[N];
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}
