import type { Size } from "./model.ts";

type Payloads = {
  BlankRecipient: { recipient: unknown };
  BadSize: { size: unknown };
  BadLocker: { locker: unknown };
  NotFound: { id: string };
  TooManyParcels: { recipient: string };
  AlreadyStored: { id: string; locker: number };
  Collected: { id: string };
  LockerBusy: { locker: number };
  TooSmall: { locker: number; size: Size };
  NotStored: { id: string };
  EmptyUndo: Record<string, never>;
};

/** Every parcel locker error kind, its payload, and the thrown shape. */
export type Errors = {
  readonly Name: keyof Payloads;
  readonly Payload: Payloads;
  readonly Of: Of;
};

/** One error kind name. */
export type Name = keyof Payloads;

/** A thrown parcel locker error of one kind. */
export type Of<N extends Name = Name> = Error & {
  readonly kind: N;
  readonly payload: Payloads[N];
};

/** The single place a parcel locker error is made. */
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
  "BlankRecipient",
  "BadSize",
  "BadLocker",
  "NotFound",
  "TooManyParcels",
  "AlreadyStored",
  "Collected",
  "LockerBusy",
  "TooSmall",
  "NotStored",
  "EmptyUndo",
];

/** The kind of a parcel locker error, for the notice; undefined when the value is not ours. */
export function errorKind(value: unknown): Name | undefined {
  return kinds.find((kind) => isError(value, kind));
}
