/**
 * Teacher-only cinema seat map. Built from the frozen task and the public
 * core declarations only; never copied into a worker image or context.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation, Scope } from "@tinker/core";
import { fail } from "./errors.ts";

/** One seat row letter. */
export type Row = "A" | "B" | "C" | "D" | "E";

/** Where one seat is in the sale. */
export type SeatState = "free" | "held" | "sold";

/** One seat in the map. */
export type Seat = {
  id: string;
  row: string;
  number: number;
  state: SeatState;
  customer: string | null;
};

/** The seat rows in order. */
export const ROWS: readonly Row[] = ["A", "B", "C", "D", "E"];

const NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];
const SEAT_LIMIT = 4;
const ONE_TO_EIGHT = /^[1-8]$/;

const freeSeats: readonly Seat[] = ROWS.flatMap((row) =>
  NUMBERS.map((number): Seat => ({
    id: `${row}${number}`,
    row,
    number,
    state: "free",
    customer: null,
  })),
);

/** Every seat in row order then number order. */
export const seats: Data.Cell<readonly Seat[]> = data({ label: "seats", initial: freeSeats });

const history: Data.Cell<readonly (readonly Seat[])[]> = data({
  label: "history",
  initial: [],
});

type Cells = {
  seats: Scope.DataController<readonly Seat[]>;
  history: Scope.DataController<readonly (readonly Seat[])[]>;
};

const mapCells = { seats: seats.controller, history: history.controller };

const saveStep = (cells: Cells): void => {
  const step = cells.seats.get();
  cells.history.update((steps) => [...steps, step]);
};

type RawCall = { readonly [field: string]: unknown };

const isRawCall = (raw: unknown): raw is RawCall => typeof raw === "object" && raw !== null;

function fieldOf(raw: unknown, field: string): unknown {
  return isRawCall(raw) ? raw[field] : undefined;
}

function readRow(raw: unknown): Row {
  if (typeof raw !== "string") throw fail("BadRow", { row: raw });
  const row = ROWS.find((each) => each === raw.trim());
  if (row === undefined) throw fail("BadRow", { row: raw });
  return row;
}

function readNumber(raw: unknown): number {
  if (typeof raw !== "string" || !ONE_TO_EIGHT.test(raw.trim()))
    throw fail("BadNumber", { number: raw });
  return Number(raw.trim());
}

function readCustomer(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw fail("BlankCustomer", { customer: raw });
  return raw.trim();
}

const findSeat = (rows: readonly Seat[], id: unknown): Seat => {
  const seat = rows.find((row) => row.id === id);
  if (seat === undefined) throw fail("NotFound", { id: String(id) });
  return seat;
};

const replaceSeat = (rows: readonly Seat[], changed: Seat): readonly Seat[] =>
  rows.map((row) => (row.id === changed.id ? changed : row));

/** Hold one seat for a customer; a seat that customer already holds passes with no change. */
export const holdSeat: Operation.Handle<Seat, { row: string; number: string; customer: string }> =
  operation({
    label: "holdSeat",
    depends: mapCells,
    run: (cells, { rawInput }) => {
      const row = readRow(fieldOf(rawInput, "row"));
      const number = readNumber(fieldOf(rawInput, "number"));
      const customer = readCustomer(fieldOf(rawInput, "customer"));
      const rows = cells.seats.get();
      const seat = findSeat(rows, `${row}${number}`);
      if (seat.state === "held" && seat.customer === customer) return seat;
      if (rows.filter((each) => each.customer === customer).length >= SEAT_LIMIT)
        throw fail("SeatLimit", { customer });
      if (seat.state === "sold") throw fail("SeatSold", { id: seat.id });
      if (seat.customer !== null) throw fail("SeatTaken", { id: seat.id, customer: seat.customer });
      const changed: Seat = { ...seat, state: "held", customer };
      saveStep(cells);
      cells.seats.set(replaceSeat(rows, changed));
      return changed;
    },
  });

/** Sell every seat the customer holds, in seat order, as one undo step. */
export const buySeats: Operation.Handle<readonly Seat[], { customer: string }> = operation({
  label: "buySeats",
  depends: mapCells,
  run: (cells, { rawInput }) => {
    const customer = readCustomer(fieldOf(rawInput, "customer"));
    const rows = cells.seats.get();
    const mine = rows.filter((seat) => seat.state === "held" && seat.customer === customer);
    if (mine.length === 0) throw fail("NothingHeld", { customer });
    const sold = mine.map((seat): Seat => ({ ...seat, state: "sold" }));
    saveStep(cells);
    cells.seats.set(sold.reduce(replaceSeat, rows));
    return sold;
  },
});

/** Free a held seat; a seat that is already free passes with no change. */
export const releaseSeat: Operation.Handle<Seat, { seatId: string }> = operation({
  label: "releaseSeat",
  depends: mapCells,
  run: (cells, { rawInput }) => {
    const rows = cells.seats.get();
    const seat = findSeat(rows, fieldOf(rawInput, "seatId"));
    if (seat.state === "free") return seat;
    if (seat.state === "sold") throw fail("SeatSold", { id: seat.id });
    const changed: Seat = { ...seat, state: "free", customer: null };
    saveStep(cells);
    cells.seats.set(replaceSeat(rows, changed));
    return changed;
  },
});

/** Restore the exact seats before the last passing change. */
export const undoSeats: Operation.Handle<void, void> = operation({
  label: "undoSeats",
  depends: mapCells,
  run: (cells) => {
    const steps = cells.history.get();
    const last = steps.at(-1);
    if (last === undefined) throw fail("EmptyUndo", {});
    cells.seats.set(last);
    cells.history.set(steps.slice(0, -1));
  },
});
