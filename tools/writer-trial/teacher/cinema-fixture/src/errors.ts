type Payloads = {
  BadRow: { row: unknown };
  BadNumber: { number: unknown };
  BlankCustomer: { customer: unknown };
  NotFound: { id: string };
  SeatTaken: { id: string; customer: string };
  SeatSold: { id: string };
  SeatLimit: { customer: string };
  NothingHeld: { customer: string };
  EmptyUndo: Record<string, never>;
};

/** Every seat map error kind, its payload, and the thrown shape. */
export type Errors = {
  readonly Name: keyof Payloads;
  readonly Payload: Payloads;
  readonly Of: Of;
};

/** One error kind name. */
export type Name = keyof Payloads;

/** A thrown seat map error of one kind. */
export type Of<N extends Name = Name> = Error & {
  readonly kind: N;
  readonly payload: Payloads[N];
};

/** The single place a seat map error is made. */
export function fail<const N extends Name>(kind: N, payload: Payloads[N]): Of<N> {
  const error = new Error(`${kind}: ${JSON.stringify(payload)}`);
  return Object.assign(error, { kind, payload });
}

/** Narrow an unknown thrown value to one registry entry. */
export function isError<const N extends Name>(value: unknown, kind: N): value is Of<N> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "payload" in value &&
    value.kind === kind
  );
}

const kinds: readonly Name[] = [
  "BadRow",
  "BadNumber",
  "BlankCustomer",
  "NotFound",
  "SeatTaken",
  "SeatSold",
  "SeatLimit",
  "NothingHeld",
  "EmptyUndo",
];

/** The kind of a seat map error, for the notice; undefined when the value is not ours. */
export function errorKind(value: unknown): Name | undefined {
  return kinds.find((kind) => isError(value, kind));
}
