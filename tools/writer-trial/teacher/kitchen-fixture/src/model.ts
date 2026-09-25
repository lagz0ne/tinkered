/**
 * Teacher-only kitchen queue. Built from the frozen task and the public
 * core declarations only; never copied into a worker image or context.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { fail } from "./errors.ts";

/** Where one ticket is in the kitchen. */
export type TicketState = "waiting" | "cooking" | "served";

/** One table's order of one dish. */
export type Ticket = { id: string; table: number; dish: string; qty: number; state: TicketState };

/** The dishes a table can order, in menu order. */
export const MENU = ["Soup", "Salad", "Pasta", "Steak", "Cake"] as const;

type Kitchen = { tickets: readonly Ticket[]; stove: number };

/** Saved tickets in creation order. */
export const tickets: Data.Cell<readonly Ticket[]> = data({ label: "tickets", initial: [] });

/** How many tickets may cook at once. */
export const stove: Data.Cell<number> = data({ label: "stove", initial: 3 });

const history: Data.Cell<readonly Kitchen[]> = data({ label: "history", initial: [] });

const issued: Data.Cell<number> = data({ label: "issued", initial: 0 });

const MAX_TABLE = 40;
const MAX_QTY = 9;
const MAX_SIZE = 5;
const PLAIN_DIGITS = /^[0-9]+$/;

const kitchenCells = {
  tickets: tickets.controller,
  stove: stove.controller,
  history: history.controller,
  issued: issued.controller,
};

function readTable(raw: unknown): number {
  if (typeof raw !== "string" || !PLAIN_DIGITS.test(raw.trim()))
    throw fail("BadTable", { table: raw });
  const table = Number(raw.trim());
  if (table < 1 || table > MAX_TABLE) throw fail("BadTable", { table: raw });
  return table;
}

function readQty(raw: unknown): number {
  if (typeof raw !== "string" || !PLAIN_DIGITS.test(raw.trim())) throw fail("BadQty", { qty: raw });
  const qty = Number(raw.trim());
  if (qty < 1 || qty > MAX_QTY) throw fail("BadQty", { qty: raw });
  return qty;
}

function readSize(raw: unknown): number {
  if (typeof raw !== "string" || !PLAIN_DIGITS.test(raw.trim()))
    throw fail("BadSize", { size: raw });
  const size = Number(raw.trim());
  if (size < 1 || size > MAX_SIZE) throw fail("BadSize", { size: raw });
  return size;
}

function readDish(raw: unknown): string {
  if (typeof raw !== "string") throw fail("UnknownDish", { dish: raw });
  const dish = MENU.find((name) => name === raw.trim());
  if (dish === undefined) throw fail("UnknownDish", { dish: raw });
  return dish;
}

const findTicket = (rows: readonly Ticket[], id: unknown): Ticket => {
  const ticket = rows.find((row) => row.id === id);
  if (ticket === undefined) throw fail("NotFound", { id: String(id) });
  return ticket;
};

const replaceTicket = (rows: readonly Ticket[], changed: Ticket): readonly Ticket[] =>
  rows.map((row) => (row.id === changed.id ? changed : row));

/** How many tickets are cooking now. */
export const cookingCount = (rows: readonly Ticket[]): number =>
  rows.filter((row) => row.state === "cooking").length;

/** Add a waiting ticket, or grow the waiting ticket for the same table and dish. */
export const addTicket: Operation.Handle<Ticket, { table: string; dish: string; qty: string }> =
  operation({
    label: "addTicket",
    depends: kitchenCells,
    run: (cells, { input }) => {
      const table = readTable(input.table);
      const dish = readDish(input.dish);
      const qty = readQty(input.qty);
      const rows = cells.tickets.get();
      const open = rows.find(
        (row) => row.state === "waiting" && row.table === table && row.dish === dish,
      );
      if (open !== undefined) {
        const total = open.qty + qty;
        if (total > MAX_QTY) throw fail("TooMany", { id: open.id, qty: total });
        const merged: Ticket = { ...open, qty: total };
        const step = { tickets: cells.tickets.get(), stove: cells.stove.get() };
        cells.history.update((steps) => [...steps, step]);
        cells.tickets.set(replaceTicket(rows, merged));
        return merged;
      }
      const next = cells.issued.get() + 1;
      cells.issued.set(next);
      const saved: Ticket = { id: `ticket-${next}`, table, dish, qty, state: "waiting" };
      const step = { tickets: cells.tickets.get(), stove: cells.stove.get() };
      cells.history.update((steps) => [...steps, step]);
      cells.tickets.set([...rows, saved]);
      return saved;
    },
  });

/** Start cooking a waiting ticket; a cooking ticket passes with no change. */
export const startCooking: Operation.Handle<Ticket, { ticketId: string }> = operation({
  label: "startCooking",
  depends: kitchenCells,
  run: (cells, { input }) => {
    const rows = cells.tickets.get();
    const ticket = findTicket(rows, input.ticketId);
    if (ticket.state === "cooking") return ticket;
    if (ticket.state === "served") throw fail("AlreadyServed", { id: ticket.id });
    const size = cells.stove.get();
    if (cookingCount(rows) >= size) throw fail("StoveFull", { size });
    const changed: Ticket = { ...ticket, state: "cooking" };
    const step = { tickets: cells.tickets.get(), stove: cells.stove.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.tickets.set(replaceTicket(rows, changed));
    return changed;
  },
});

/** Serve a cooking ticket; a served ticket passes with no change. */
export const serveTicket: Operation.Handle<Ticket, { ticketId: string }> = operation({
  label: "serveTicket",
  depends: kitchenCells,
  run: (cells, { input }) => {
    const rows = cells.tickets.get();
    const ticket = findTicket(rows, input.ticketId);
    if (ticket.state === "served") return ticket;
    if (ticket.state === "waiting") throw fail("NotCooking", { id: ticket.id });
    const changed: Ticket = { ...ticket, state: "served" };
    const step = { tickets: cells.tickets.get(), stove: cells.stove.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.tickets.set(replaceTicket(rows, changed));
    return changed;
  },
});

/** Remove a waiting ticket. */
export const cancelTicket: Operation.Handle<void, { ticketId: string }> = operation({
  label: "cancelTicket",
  depends: kitchenCells,
  run: (cells, { input }) => {
    const rows = cells.tickets.get();
    const ticket = findTicket(rows, input.ticketId);
    if (ticket.state !== "waiting") throw fail("CannotCancel", { id: ticket.id });
    const step = { tickets: cells.tickets.get(), stove: cells.stove.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.tickets.set(rows.filter((row) => row.id !== ticket.id));
  },
});

/** Change the stove size; the size it already has passes with no change. */
export const setStove: Operation.Handle<number, { size: string }> = operation({
  label: "setStove",
  depends: kitchenCells,
  run: (cells, { input }) => {
    const size = readSize(input.size);
    if (size === cells.stove.get()) return size;
    const cooking = cookingCount(cells.tickets.get());
    if (size < cooking) throw fail("BelowCooking", { size, cooking });
    const step = { tickets: cells.tickets.get(), stove: cells.stove.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.stove.set(size);
    return size;
  },
});

/** Restore the exact tickets and stove size before the last passing change. */
export const undoKitchen: Operation.Handle<void, void> = operation({
  label: "undoKitchen",
  depends: { tickets: tickets.controller, stove: stove.controller, history: history.controller },
  run: (cells) => {
    const steps = cells.history.get();
    const last = steps.at(-1);
    if (last === undefined) throw fail("EmptyUndo", {});
    cells.tickets.set(last.tickets);
    cells.stove.set(last.stove);
    cells.history.set(steps.slice(0, -1));
  },
});
