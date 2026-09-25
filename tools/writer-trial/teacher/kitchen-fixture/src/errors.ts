type Payloads = {
  BadTable: { table: unknown };
  UnknownDish: { dish: unknown };
  BadQty: { qty: unknown };
  BadSize: { size: unknown };
  NotFound: { id: string };
  TooMany: { id: string; qty: number };
  StoveFull: { size: number };
  NotCooking: { id: string };
  AlreadyServed: { id: string };
  CannotCancel: { id: string };
  BelowCooking: { size: number; cooking: number };
  EmptyUndo: Record<string, never>;
};

/** Every kitchen queue error kind, its payload, and the thrown shape. */
export type Errors = {
  readonly Name: keyof Payloads;
  readonly Payload: Payloads;
  readonly Of: Of;
};

/** One error kind name. */
export type Name = keyof Payloads;

/** A thrown kitchen error of one kind. */
export type Of<N extends Name = Name> = Error & {
  readonly kind: N;
  readonly payload: Payloads[N];
};

/** The single place a kitchen error is made. */
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
  "BadTable",
  "UnknownDish",
  "BadQty",
  "BadSize",
  "NotFound",
  "TooMany",
  "StoveFull",
  "NotCooking",
  "AlreadyServed",
  "CannotCancel",
  "BelowCooking",
  "EmptyUndo",
];

/** The kind of a kitchen error, for the notice; undefined when the value is not ours. */
export function errorKind(value: unknown): Name | undefined {
  return kinds.find((kind) => isError(value, kind));
}
