/**
 * Teacher-only minimal stock desk. Built from the frozen packet and public
 * core declarations only — never copied into a worker image or context.
 * Enough behavior for the checker to boot: core cells, managed errors,
 * move/open/save/discard/undo operations, and a labeled screen.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation, Scope } from "@tinker/core";
import { fail } from "./errors.ts";

export type Item = "Cable" | "Stand";
export type Place = "East" | "West";

export const items: readonly Item[] = ["Cable", "Stand"];
export const places: readonly Place[] = ["East", "West"];

export type Stock = { item: Item; place: Place; quantity: number };
export type Move = { id: string; item: Item; from: Place; to: Place; quantity: number };
export type MoveInput = { item: string; from: string; to: string; quantity: number };
export type EditMoveInput = MoveInput & { id: string };

const initialStock: readonly Stock[] = [
  { item: "Cable", place: "East", quantity: 8 },
  { item: "Cable", place: "West", quantity: 2 },
  { item: "Stand", place: "East", quantity: 3 },
  { item: "Stand", place: "West", quantity: 1 },
];

export const stock: Data.Cell<readonly Stock[]> = data({
  label: "stock",
  initial: initialStock,
});

export const moves: Data.Cell<readonly Move[]> = data({
  label: "moves",
  initial: [],
});

export const editDraft: Data.Cell<Move | undefined> = data({
  label: "editDraft",
  initial: undefined,
});

const undoHistory: Data.Cell<readonly { stock: readonly Stock[]; moves: readonly Move[] }[]> = data(
  { label: "undoHistory", initial: [] },
);

const issuedIds: Data.Cell<readonly string[]> = data({ label: "issuedIds", initial: [] });

const findStock = (rows: readonly Stock[], item: Item, place: Place): Stock => {
  const row = rows.find((r) => r.item === item && r.place === place);
  if (row === undefined) throw fail("UnknownPlace", { place });
  return row;
};

const itemOf = (raw: unknown): Item => {
  if (raw === "Cable" || raw === "Stand") return raw;
  throw fail("UnknownItem", { item: raw });
};

const placeOf = (raw: unknown): Place => {
  if (raw === "East" || raw === "West") return raw;
  throw fail("UnknownPlace", { place: raw });
};

const quantityOf = (raw: unknown): number => {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    throw fail("BadQuantity", { quantity: raw });
  }
  return raw;
};

const checked = (raw: {
  item: unknown;
  from: unknown;
  to: unknown;
  quantity: unknown;
}): { item: Item; from: Place; to: Place; quantity: number } => {
  const item = itemOf(raw.item);
  const from = placeOf(raw.from);
  const to = placeOf(raw.to);
  if (from === to) throw fail("SamePlace", { place: String(raw.from) });
  const quantity = quantityOf(raw.quantity);
  return { item, from, to, quantity };
};

type Cells = {
  stock: Scope.DataController<readonly Stock[]>;
  moves: Scope.DataController<readonly Move[]>;
  history: Scope.DataController<readonly { stock: readonly Stock[]; moves: readonly Move[] }[]>;
  issued: Scope.DataController<readonly string[]>;
};

const shifted = (
  rows: readonly Stock[],
  item: Item,
  from: Place,
  to: Place,
  quantity: number,
): readonly Stock[] => {
  const source = findStock(rows, item, from);
  if (source.quantity < quantity) {
    throw fail("ShortStock", {
      item,
      place: from,
      available: source.quantity,
      requested: quantity,
    });
  }
  return rows.map((row) => {
    if (row.item === item && row.place === from)
      return { ...row, quantity: row.quantity - quantity };
    if (row.item === item && row.place === to) return { ...row, quantity: row.quantity + quantity };
    return row;
  });
};

const pushStep = (cells: Cells): void => {
  cells.history.update((prev) => [...prev, { stock: cells.stock.get(), moves: cells.moves.get() }]);
};

const freshId = (issued: Scope.DataController<readonly string[]>): string => {
  const id = globalThis.crypto.randomUUID();
  if (issued.get().includes(id)) return freshId(issued);
  issued.set([...issued.get(), id]);
  return id;
};

/** Move stock between places. Fails leave everything unchanged. */
export const moveStock: Operation.Handle<Move, MoveInput> = operation({
  label: "moveStock",
  depends: {
    stock: stock.controller,
    moves: moves.controller,
    history: undoHistory.controller,
    issued: issuedIds.controller,
  },
  run: ({ stock: stockCell, moves: movesCell, history, issued }, ctx) => {
    const field = checked(ctx.input);
    const current = stockCell.get();
    const next = shifted(current, field.item, field.from, field.to, field.quantity);
    const move: Move = {
      id: freshId(issued),
      item: field.item,
      from: field.from,
      to: field.to,
      quantity: field.quantity,
    };
    pushStep({ stock: stockCell, moves: movesCell, history, issued });
    stockCell.set(next);
    movesCell.set([...movesCell.get(), move]);
    return move;
  },
});

/** Copy the named move into the draft. Unknown ids report NotFound. */
export const openMoveEdit: Operation.Handle<Move, { id: string }> = operation({
  label: "openMoveEdit",
  depends: { moves: moves.controller, draft: editDraft.controller },
  run: ({ moves: movesCell, draft }, ctx) => {
    const id = ctx.input.id;
    const saved = movesCell.get().find((m) => m.id === id);
    if (saved === undefined) throw fail("NotFound", { id });
    const copy: Move = { ...saved };
    draft.set(copy);
    return copy;
  },
});

/** Save the open draft: reverse the old move, then apply the replacement. */
export const saveMoveEdit: Operation.Handle<Move, EditMoveInput> = operation({
  label: "saveMoveEdit",
  depends: {
    stock: stock.controller,
    moves: moves.controller,
    draft: editDraft.controller,
    history: undoHistory.controller,
    issued: issuedIds.controller,
  },
  run: ({ stock: stockCell, moves: movesCell, draft, history, issued }, ctx) => {
    const id = ctx.input.id;
    const open = draft.get();
    if (open === undefined || open.id !== id) throw fail("NotFound", { id });
    const saved = movesCell.get().find((m) => m.id === id);
    if (saved === undefined) throw fail("NotFound", { id });
    const field = checked(ctx.input);
    const current = stockCell.get();
    const restored = shifted(current, saved.item, saved.to, saved.from, saved.quantity);
    const next = shifted(restored, field.item, field.from, field.to, field.quantity);
    const replaced: Move = {
      id,
      item: field.item,
      from: field.from,
      to: field.to,
      quantity: field.quantity,
    };
    pushStep({ stock: stockCell, moves: movesCell, history, issued });
    stockCell.set(next);
    movesCell.set(movesCell.get().map((m) => (m.id === id ? replaced : m)));
    draft.set(undefined);
    return replaced;
  },
});

/** Close the draft for that id without writing anything. */
export const discardMoveEdit: Operation.Handle<void, { id: string }> = operation({
  label: "discardMoveEdit",
  depends: { draft: editDraft.controller },
  run: ({ draft }, ctx) => {
    const id = ctx.input.id;
    const open = draft.get();
    if (open === undefined || open.id !== id) throw fail("NotFound", { id });
    draft.set(undefined);
  },
});

/** Restore the exact stock and move list before the last passing change. */
export const undoMove: Operation.Handle<void, void> = operation({
  label: "undoMove",
  depends: {
    stock: stock.controller,
    moves: moves.controller,
    history: undoHistory.controller,
  },
  run: ({ stock: stockCell, moves: movesCell, history }) => {
    const steps = history.get();
    const last = steps[steps.length - 1];
    if (last === undefined) throw fail("EmptyUndo", {});
    stockCell.set(last.stock);
    movesCell.set(last.moves);
    history.set(steps.slice(0, -1));
  },
});

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
