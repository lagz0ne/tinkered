import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { buySeats, holdSeat, releaseSeat, undoSeats } from "./model.ts";
import type { Seat, SeatState } from "./model.ts";
import { errorKind } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The seat form: row, number, and customer text as typed. */
export type SeatDraft = { row: string; number: string; customer: string };

/** Which seat rows the Seats table shows. Filtering never deletes. */
export type SeatFilter = "All" | "Free" | "Held" | "Sold";

/** How a seat state reads on screen. */
export type StateText = "Free" | "Held" | "Sold";

/** One Seats table row. */
export type SeatLine = { id: string; state: StateText; customer: string };

const emptyDraft: SeatDraft = { row: "", number: "", customer: "" };

export const seatDraft: Data.Cell<SeatDraft> = data({ label: "seatDraft", initial: emptyDraft });

export const seatFilter: Data.Cell<SeatFilter> = data({ label: "seatFilter", initial: "All" });

export const notice: Data.Cell<Name | undefined> = data({ label: "notice", initial: undefined });

const STATE_TEXT: Readonly<Record<SeatState, StateText>> = {
  free: "Free",
  held: "Held",
  sold: "Sold",
};

const shownBy = (filter: SeatFilter, state: StateText): boolean =>
  filter === "All" || filter === state;

/** Seats table rows for one filter, in saved seat order. */
export const seatLines = (saved: readonly Seat[], filter: SeatFilter): readonly SeatLine[] =>
  saved
    .map((seat) => ({
      id: seat.id,
      state: STATE_TEXT[seat.state],
      customer: seat.customer ?? "None",
    }))
    .filter((line) => shownBy(filter, line.state));

const kindOf = (error: unknown): Name => {
  const kind = errorKind(error);
  if (kind === undefined) throw error;
  return kind;
};

/** Type into the Row input. Clears any earlier notice. */
export const typeRow: Operation.Handle<void, { value: string }> = operation({
  label: "typeRow",
  depends: { draft: seatDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, row: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Number input. Clears any earlier notice. */
export const typeNumber: Operation.Handle<void, { value: string }> = operation({
  label: "typeNumber",
  depends: { draft: seatDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, number: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Customer input. Clears any earlier notice. */
export const typeCustomer: Operation.Handle<void, { value: string }> = operation({
  label: "typeCustomer",
  depends: { draft: seatDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, customer: input.value }));
    shown.set(undefined);
  },
});

/** Show All, Free, Held, or Sold rows. Clears any earlier notice. */
export const chooseFilter: Operation.Handle<void, SeatFilter> = operation({
  label: "chooseFilter",
  depends: { filter: seatFilter.controller, shown: notice.controller },
  run: ({ filter, shown }, { input }) => {
    filter.set(input);
    shown.set(undefined);
  },
});

/** Hold the typed seat. Success clears Row and Number and keeps Customer; failure keeps all. */
export const submitHold: Operation.Handle<void, void> = operation({
  label: "submitHold",
  depends: { draft: seatDraft.controller, shown: notice.controller, hold: holdSeat.controller },
  run: ({ draft, shown, hold }) => {
    try {
      hold.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.update((text) => ({ ...text, row: "", number: "" }));
    shown.set(undefined);
  },
});

/** Buy every seat the typed customer holds. The form text stays either way. */
export const submitBuy: Operation.Handle<void, void> = operation({
  label: "submitBuy",
  depends: { draft: seatDraft.controller, shown: notice.controller, buy: buySeats.controller },
  run: ({ draft, shown, buy }) => {
    try {
      buy.run({ input: { customer: draft.get().customer } });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Release one held seat from its row button. */
export const submitRelease: Operation.Handle<void, { seatId: string }> = operation({
  label: "submitRelease",
  depends: { shown: notice.controller, release: releaseSeat.controller },
  run: ({ shown, release }, { input }) => {
    try {
      release.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Undo the last passing change. Form text and the filter stay. */
export const submitUndo: Operation.Handle<void, void> = operation({
  label: "submitUndo",
  depends: { shown: notice.controller, undo: undoSeats.controller },
  run: ({ shown, undo }) => {
    try {
      undo.run({});
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});
