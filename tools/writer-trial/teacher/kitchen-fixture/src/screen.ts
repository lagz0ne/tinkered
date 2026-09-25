import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import {
  addTicket,
  cancelTicket,
  serveTicket,
  setStove,
  startCooking,
  undoKitchen,
} from "./model.ts";
import type { Ticket, TicketState } from "./model.ts";
import { errorKind } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The new-ticket form: table and qty text as typed, and the chosen dish. */
export type TicketDraft = { table: string; dish: string; qty: string };

/** Which ticket rows the Tickets table shows. Filtering never deletes. */
export type TicketFilter = "All" | "Waiting" | "Cooking" | "Served";

/** How a ticket state reads on screen. */
export type StateText = "Waiting" | "Cooking" | "Served";

/** One Tickets table row. */
export type TicketRow = {
  id: string;
  table: number;
  dish: string;
  qty: number;
  state: StateText;
};

const emptyTicket: TicketDraft = { table: "", dish: "", qty: "" };

export const ticketDraft: Data.Cell<TicketDraft> = data({
  label: "ticketDraft",
  initial: emptyTicket,
});

export const stoveDraft: Data.Cell<string> = data({ label: "stoveDraft", initial: "" });

export const ticketFilter: Data.Cell<TicketFilter> = data({
  label: "ticketFilter",
  initial: "All",
});

export const notice: Data.Cell<Name | undefined> = data({ label: "notice", initial: undefined });

const STATE_TEXT: Readonly<Record<TicketState, StateText>> = {
  waiting: "Waiting",
  cooking: "Cooking",
  served: "Served",
};

const shownBy = (filter: TicketFilter, state: StateText): boolean =>
  filter === "All" || filter === state;

/** Tickets table rows for one filter, in saved ticket order. */
export const ticketRows = (saved: readonly Ticket[], filter: TicketFilter): readonly TicketRow[] =>
  saved
    .map((ticket) => ({
      id: ticket.id,
      table: ticket.table,
      dish: ticket.dish,
      qty: ticket.qty,
      state: STATE_TEXT[ticket.state],
    }))
    .filter((row) => shownBy(filter, row.state));

const kindOf = (error: unknown): Name => {
  const kind = errorKind(error);
  if (kind === undefined) throw error;
  return kind;
};

/** Type into the Table input. Clears any earlier notice. */
export const typeTable: Operation.Handle<void, { value: string }> = operation({
  label: "typeTable",
  depends: { draft: ticketDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, table: input.value }));
    shown.set(undefined);
  },
});

/** Choose a dish in the new-ticket form. Clears any earlier notice. */
export const chooseDish: Operation.Handle<void, { dish: string }> = operation({
  label: "chooseDish",
  depends: { draft: ticketDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, dish: input.dish }));
    shown.set(undefined);
  },
});

/** Type into the Qty input. Clears any earlier notice. */
export const typeQty: Operation.Handle<void, { value: string }> = operation({
  label: "typeQty",
  depends: { draft: ticketDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, qty: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Stove size input. Clears any earlier notice. */
export const typeStove: Operation.Handle<void, { value: string }> = operation({
  label: "typeStove",
  depends: { draft: stoveDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.set(input.value);
    shown.set(undefined);
  },
});

/** Show All, Waiting, Cooking, or Served rows. Clears any earlier notice. */
export const chooseFilter: Operation.Handle<void, TicketFilter> = operation({
  label: "chooseFilter",
  depends: { filter: ticketFilter.controller, shown: notice.controller },
  run: ({ filter, shown }, { input }) => {
    filter.set(input);
    shown.set(undefined);
  },
});

/** Add the typed ticket. Success clears Table and Qty and keeps Dish; failure keeps all three. */
export const submitTicket: Operation.Handle<void, void> = operation({
  label: "submitTicket",
  depends: { draft: ticketDraft.controller, shown: notice.controller, add: addTicket.controller },
  run: ({ draft, shown, add }) => {
    try {
      add.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.update((text) => ({ ...text, table: "", qty: "" }));
    shown.set(undefined);
  },
});

/** Set the typed stove size. Success clears the input; failure keeps it. */
export const submitStove: Operation.Handle<void, void> = operation({
  label: "submitStove",
  depends: { draft: stoveDraft.controller, shown: notice.controller, set: setStove.controller },
  run: ({ draft, shown, set }) => {
    try {
      set.run({ input: { size: draft.get() } });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.set("");
    shown.set(undefined);
  },
});

/** Start cooking one ticket from its row button. */
export const submitCook: Operation.Handle<void, { ticketId: string }> = operation({
  label: "submitCook",
  depends: { shown: notice.controller, start: startCooking.controller },
  run: ({ shown, start }, { input }) => {
    try {
      start.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Serve one ticket from its row button. */
export const submitServe: Operation.Handle<void, { ticketId: string }> = operation({
  label: "submitServe",
  depends: { shown: notice.controller, serve: serveTicket.controller },
  run: ({ shown, serve }, { input }) => {
    try {
      serve.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Cancel one ticket from its row button. */
export const submitCancel: Operation.Handle<void, { ticketId: string }> = operation({
  label: "submitCancel",
  depends: { shown: notice.controller, cancel: cancelTicket.controller },
  run: ({ shown, cancel }, { input }) => {
    try {
      cancel.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Undo the last passing change. Form text, the dish, and the filter stay. */
export const submitUndo: Operation.Handle<void, void> = operation({
  label: "submitUndo",
  depends: { shown: notice.controller, undo: undoKitchen.controller },
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
