/**
 * Teacher-only parcel locker desk. Built from the frozen task and the public
 * core declarations only; never copied into a worker image or context.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation, Scope } from "@tinker/core";
import { fail } from "./errors.ts";

/** A parcel or locker size. S is smallest, L is largest. */
export type Size = "S" | "M" | "L";

/** Where one parcel is at the desk. */
export type ParcelState = "held" | "stored" | "collected";

/** One parcel the desk received. */
export type Parcel = {
  id: string;
  recipient: string;
  size: Size;
  locker: number | null;
  state: ParcelState;
};

/** One locker and the largest parcel size it takes. */
export type Locker = { number: number; size: Size };

/** The six lockers in number order: 1 and 2 are S, 3 and 4 are M, 5 and 6 are L. */
export const LOCKERS: readonly Locker[] = [
  { number: 1, size: "S" },
  { number: 2, size: "S" },
  { number: 3, size: "M" },
  { number: 4, size: "M" },
  { number: 5, size: "L" },
  { number: 6, size: "L" },
];

/** Saved parcels in creation order. */
export const parcels: Data.Cell<readonly Parcel[]> = data({ label: "parcels", initial: [] });

const history: Data.Cell<readonly (readonly Parcel[])[]> = data({
  label: "history",
  initial: [],
});

const issued: Data.Cell<number> = data({ label: "issued", initial: 0 });

const SIZES: readonly Size[] = ["S", "M", "L"];
const RANK: Readonly<Record<Size, number>> = { S: 1, M: 2, L: 3 };
const MAX_OPEN = 3;
const ONE_DIGIT = /^[0-9]$/;

type Cells = {
  parcels: Scope.DataController<readonly Parcel[]>;
  history: Scope.DataController<readonly (readonly Parcel[])[]>;
  issued: Scope.DataController<number>;
};

const deskCells = {
  parcels: parcels.controller,
  history: history.controller,
  issued: issued.controller,
};

const saveStep = (cells: Cells): void => {
  const step = cells.parcels.get();
  cells.history.update((steps) => [...steps, step]);
};

const nextId = (cells: Cells): string => {
  const next = cells.issued.get() + 1;
  cells.issued.set(next);
  return `parcel-${next}`;
};

type RawCall = { readonly [field: string]: unknown };

const isRawCall = (raw: unknown): raw is RawCall => typeof raw === "object" && raw !== null;

function fieldOf(raw: unknown, field: string): unknown {
  return isRawCall(raw) ? raw[field] : undefined;
}

function readRecipient(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "")
    throw fail("BlankRecipient", { recipient: raw });
  return raw.trim();
}

function readSize(raw: unknown): Size {
  if (typeof raw !== "string") throw fail("BadSize", { size: raw });
  const size = SIZES.find((each) => each === raw.trim());
  if (size === undefined) throw fail("BadSize", { size: raw });
  return size;
}

function readLocker(raw: unknown): Locker {
  if (typeof raw !== "string" || !ONE_DIGIT.test(raw.trim()))
    throw fail("BadLocker", { locker: raw });
  const locker = LOCKERS.find((each) => each.number === Number(raw.trim()));
  if (locker === undefined) throw fail("BadLocker", { locker: raw });
  return locker;
}

const findParcel = (rows: readonly Parcel[], id: unknown): Parcel => {
  const parcel = rows.find((row) => row.id === id);
  if (parcel === undefined) throw fail("NotFound", { id: String(id) });
  return parcel;
};

const replaceParcel = (rows: readonly Parcel[], changed: Parcel): readonly Parcel[] =>
  rows.map((row) => (row.id === changed.id ? changed : row));

/** Receive a held parcel with no locker, appended in creation order. */
export const receiveParcel: Operation.Handle<Parcel, { recipient: string; size: string }> =
  operation({
    label: "receiveParcel",
    depends: deskCells,
    run: (cells, { rawInput }) => {
      const recipient = readRecipient(fieldOf(rawInput, "recipient"));
      const size = readSize(fieldOf(rawInput, "size"));
      const rows = cells.parcels.get();
      const open = rows.filter((row) => row.recipient === recipient && row.state !== "collected");
      if (open.length >= MAX_OPEN) throw fail("TooManyParcels", { recipient });
      const saved: Parcel = { id: nextId(cells), recipient, size, locker: null, state: "held" };
      saveStep(cells);
      cells.parcels.set([...rows, saved]);
      return saved;
    },
  });

/** Put a held parcel in a locker; the locker it is already in passes with no change. */
export const storeParcel: Operation.Handle<Parcel, { parcelId: string; locker: string }> =
  operation({
    label: "storeParcel",
    depends: deskCells,
    run: (cells, { rawInput }) => {
      const locker = readLocker(fieldOf(rawInput, "locker"));
      const rows = cells.parcels.get();
      const parcel = findParcel(rows, fieldOf(rawInput, "parcelId"));
      if (parcel.locker === locker.number) return parcel;
      if (parcel.locker !== null)
        throw fail("AlreadyStored", { id: parcel.id, locker: parcel.locker });
      if (parcel.state === "collected") throw fail("Collected", { id: parcel.id });
      if (rows.some((row) => row.locker === locker.number))
        throw fail("LockerBusy", { locker: locker.number });
      if (RANK[locker.size] < RANK[parcel.size])
        throw fail("TooSmall", { locker: locker.number, size: parcel.size });
      const changed: Parcel = { ...parcel, locker: locker.number, state: "stored" };
      saveStep(cells);
      cells.parcels.set(replaceParcel(rows, changed));
      return changed;
    },
  });

/** Hand a stored parcel to its recipient; a collected parcel passes with no change. */
export const collectParcel: Operation.Handle<Parcel, { parcelId: string }> = operation({
  label: "collectParcel",
  depends: deskCells,
  run: (cells, { rawInput }) => {
    const rows = cells.parcels.get();
    const parcel = findParcel(rows, fieldOf(rawInput, "parcelId"));
    if (parcel.state === "collected") return parcel;
    if (parcel.state === "held") throw fail("NotStored", { id: parcel.id });
    const changed: Parcel = { ...parcel, locker: null, state: "collected" };
    saveStep(cells);
    cells.parcels.set(replaceParcel(rows, changed));
    return changed;
  },
});

/** Move a stored parcel back to the desk; a held parcel passes with no change. */
export const returnToDesk: Operation.Handle<Parcel, { parcelId: string }> = operation({
  label: "returnToDesk",
  depends: deskCells,
  run: (cells, { rawInput }) => {
    const rows = cells.parcels.get();
    const parcel = findParcel(rows, fieldOf(rawInput, "parcelId"));
    if (parcel.state === "held") return parcel;
    if (parcel.state === "collected") throw fail("Collected", { id: parcel.id });
    const changed: Parcel = { ...parcel, locker: null, state: "held" };
    saveStep(cells);
    cells.parcels.set(replaceParcel(rows, changed));
    return changed;
  },
});

/** Restore the exact parcels before the last passing change. */
export const undoDesk: Operation.Handle<void, void> = operation({
  label: "undoDesk",
  depends: { parcels: parcels.controller, history: history.controller },
  run: (cells) => {
    const steps = cells.history.get();
    const last = steps.at(-1);
    if (last === undefined) throw fail("EmptyUndo", {});
    cells.parcels.set(last);
    cells.history.set(steps.slice(0, -1));
  },
});
