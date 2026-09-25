/**
 * Teacher-only room booking app after round 5. Built from the frozen packets and the public
 * core declarations only; never copied into a worker image or context.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { fail } from "./errors.ts";

/** One bookable room. */
export type Room = "Cedar" | "Maple";

/** The rooms in screen order. */
export const rooms: readonly Room[] = ["Cedar", "Maple"];

/** The day a booking takes when its caller leaves the date out. */
export const DEFAULT_DATE = "2026-10-01";

/** One saved booking; a series occurrence carries its series id. */
export type Booking = {
  readonly id: string;
  readonly title: string;
  readonly room: Room;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly seriesId?: string;
};

/** What a caller asks to book; an omitted date books the default day. */
export type BookInput = {
  readonly title: string;
  readonly room: string;
  readonly date?: string;
  readonly start: number;
  readonly end: number;
};

/** What a caller saves over the open draft; an omitted date saves the default day. */
export type EditInput = {
  readonly id: string;
  readonly title: string;
  readonly room: string;
  readonly date?: string;
  readonly start: number;
  readonly end: number;
};

/** What a caller asks to book every week, `weeks` times. */
export type SeriesInput = {
  readonly title: string;
  readonly room: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly weeks: number;
};

type Snapshot = { readonly rows: readonly Booking[]; readonly order: readonly string[] };

/** The saved bookings by date, then start time, then creation order. */
export const bookings: Data.Cell<readonly Booking[]> = data({ label: "bookings", initial: [] });

const createdOrder: Data.Cell<readonly string[]> = data({ label: "createdOrder", initial: [] });

/** The saved booking an open edit started from; undefined when no edit is open. */
export const editDraft: Data.Cell<Booking | undefined> = data({
  label: "editDraft",
  initial: undefined,
});

const history: Data.Cell<readonly Snapshot[]> = data({ label: "history", initial: [] });

const listCells = {
  saved: bookings.controller,
  order: createdOrder.controller,
  steps: history.controller,
};

type RawCall = { readonly [field: string]: unknown };

const isRawCall = (raw: unknown): raw is RawCall => typeof raw === "object" && raw !== null;

function fieldOf(raw: unknown, field: string): unknown {
  return isRawCall(raw) ? raw[field] : undefined;
}

function hasField(raw: unknown, field: string): boolean {
  return isRawCall(raw) && Object.hasOwn(raw, field);
}

const asText = (value: unknown): string => (typeof value === "string" ? value : String(value));

function readTitle(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "")
    throw fail("BlankTitle", { title: asText(raw) });
  return raw.trim();
}

function readRoom(raw: unknown): Room {
  const room = rooms.find((each) => each === raw);
  if (room === undefined) throw fail("UnknownRoom", { room: asText(raw) });
  return room;
}

function readTime(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 1439)
    throw fail("BadTime", { value: raw });
  return raw;
}

function readSlot(raw: unknown): { start: number; end: number } {
  const start = readTime(fieldOf(raw, "start"));
  const end = readTime(fieldOf(raw, "end"));
  if (end <= start) throw fail("EmptySlot", { start, end });
  return { start, end };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayOf(year: number, month: number, day: number): Date {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  return at;
}

function dateText(at: Date): string {
  const year = String(at.getUTCFullYear()).padStart(4, "0");
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readDate(raw: unknown): string {
  if (typeof raw !== "string") throw fail("BadDate", { date: raw });
  const parts = DAY.exec(raw);
  if (parts === null) throw fail("BadDate", { date: raw });
  const at = dayOf(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  if (dateText(at) !== raw) throw fail("BadDate", { date: raw });
  return raw;
}

/** The date of a book or save call: only an omitted field takes the default day. */
function readCallDate(raw: unknown): string {
  if (!hasField(raw, "date")) return DEFAULT_DATE;
  return readDate(fieldOf(raw, "date"));
}

function readWeeks(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 12)
    throw fail("BadCount", { weeks: raw });
  return raw;
}

function readId(raw: unknown): string {
  if (typeof raw !== "string") throw fail("NotFound", { id: String(raw) });
  return raw;
}

function addWeeks(date: string, weeks: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return dateText(dayOf(year, month, day + weeks * 7));
}

const overlaps =
  (room: Room, date: string, start: number, end: number) =>
  (other: Booking): boolean =>
    other.room === room && other.date === date && other.start < end && start < other.end;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** The bookings by date, then start time, then the creation order `order` records. */
function listOrder(rows: readonly Booking[], order: readonly string[]): readonly Booking[] {
  return [...rows].sort(
    (left, right) =>
      compareText(left.date, right.date) ||
      left.start - right.start ||
      order.indexOf(left.id) - order.indexOf(right.id),
  );
}

const copyOf = (booking: Booking): Booking => ({ ...booking });

/** Book one slot on one date. */
export const bookBooking: Operation.Handle<Booking, BookInput> = operation({
  label: "bookBooking",
  depends: listCells,
  run: ({ saved, order, steps }, { rawInput, random }) => {
    const title = readTitle(fieldOf(rawInput, "title"));
    const room = readRoom(fieldOf(rawInput, "room"));
    const date = readCallDate(rawInput);
    const { start, end } = readSlot(rawInput);
    const rows = saved.get();
    if (rows.some(overlaps(room, date, start, end))) throw fail("Clash", { room, start, end });
    const booking: Booking = { id: random.uuid(), title, room, date, start, end };
    const before = order.get();
    const after = [...before, booking.id];
    steps.update((list) => [...list, { rows, order: before }]);
    order.set(after);
    saved.set(listOrder([...rows, booking], after));
    return copyOf(booking);
  },
});

/** Cancel one booking by id; its open draft closes too. */
export const cancelBooking: Operation.Handle<void, { id: string }> = operation({
  label: "cancelBooking",
  depends: { ...listCells, draft: editDraft.controller },
  run: ({ saved, order, steps, draft }, { rawInput }) => {
    const id = readId(fieldOf(rawInput, "id"));
    const rows = saved.get();
    if (!rows.some((booking) => booking.id === id)) throw fail("NotFound", { id });
    const before = order.get();
    steps.update((list) => [...list, { rows, order: before }]);
    order.set(before.filter((each) => each !== id));
    saved.set(rows.filter((booking) => booking.id !== id));
    if (draft.get()?.id === id) draft.set(undefined);
  },
});

/** Open a draft of one booking and return a copy; a second open drops the first draft. */
export const openEdit: Operation.Handle<Booking, { id: string }> = operation({
  label: "openEdit",
  depends: { saved: bookings.controller, draft: editDraft.controller },
  run: ({ saved, draft }, { rawInput }) => {
    const id = readId(fieldOf(rawInput, "id"));
    const booking = saved.get().find((each) => each.id === id);
    if (booking === undefined) throw fail("NotFound", { id });
    draft.set(copyOf(booking));
    return copyOf(booking);
  },
});

/** Save the open draft over its booking; a failed save keeps the booking and the draft. */
export const saveEdit: Operation.Handle<Booking, EditInput> = operation({
  label: "saveEdit",
  depends: { ...listCells, draft: editDraft.controller },
  run: ({ saved, order, steps, draft }, { rawInput }) => {
    const id = readId(fieldOf(rawInput, "id"));
    const rows = saved.get();
    const current = rows.find((booking) => booking.id === id);
    if (draft.get()?.id !== id || current === undefined) throw fail("NotFound", { id });
    const title = readTitle(fieldOf(rawInput, "title"));
    const room = readRoom(fieldOf(rawInput, "room"));
    const date = readCallDate(rawInput);
    const { start, end } = readSlot(rawInput);
    const others = rows.filter((booking) => booking.id !== id);
    if (others.some(overlaps(room, date, start, end))) throw fail("Clash", { room, start, end });
    const edited: Booking = { ...current, title, room, date, start, end };
    steps.update((list) => [...list, { rows, order: order.get() }]);
    saved.set(listOrder([...others, edited], order.get()));
    draft.set(undefined);
    return copyOf(edited);
  },
});

/** Drop the open draft of one booking; the booking stays as saved. */
export const discardEdit: Operation.Handle<void, { id: string }> = operation({
  label: "discardEdit",
  depends: { draft: editDraft.controller },
  run: ({ draft }, { rawInput }) => {
    const id = readId(fieldOf(rawInput, "id"));
    if (draft.get()?.id !== id) throw fail("NotFound", { id });
    draft.set(undefined);
  },
});

/** Book one slot every week for `weeks` weeks, all dates or none. */
export const bookSeries: Operation.Handle<readonly Booking[], SeriesInput> = operation({
  label: "bookSeries",
  depends: listCells,
  run: ({ saved, order, steps }, { rawInput, random }) => {
    const title = readTitle(fieldOf(rawInput, "title"));
    const room = readRoom(fieldOf(rawInput, "room"));
    const date = readDate(fieldOf(rawInput, "date"));
    const { start, end } = readSlot(rawInput);
    const weeks = readWeeks(fieldOf(rawInput, "weeks"));
    const dates = Array.from({ length: weeks }, (_, week) => addWeeks(date, week));
    const rows = saved.get();
    for (const each of dates)
      if (rows.some(overlaps(room, each, start, end))) throw fail("Clash", { room, start, end });
    const seriesId = random.uuid();
    const made = dates.map((each): Booking => ({
      id: random.uuid(),
      title,
      room,
      date: each,
      start,
      end,
      seriesId,
    }));
    const before = order.get();
    const after = [...before, ...made.map((booking) => booking.id)];
    steps.update((list) => [...list, { rows, order: before }]);
    order.set(after);
    saved.set(listOrder([...rows, ...made], after));
    return made.map(copyOf);
  },
});

/** Cancel every remaining occurrence of one series; an open draft of one closes too. */
export const cancelSeries: Operation.Handle<void, { seriesId: string }> = operation({
  label: "cancelSeries",
  depends: { ...listCells, draft: editDraft.controller },
  run: ({ saved, order, steps, draft }, { rawInput }) => {
    const seriesId = readId(fieldOf(rawInput, "seriesId"));
    const rows = saved.get();
    const gone = new Set(
      rows.filter((booking) => booking.seriesId === seriesId).map((booking) => booking.id),
    );
    if (gone.size === 0) throw fail("NotFound", { id: seriesId });
    const before = order.get();
    steps.update((list) => [...list, { rows, order: before }]);
    order.set(before.filter((each) => !gone.has(each)));
    saved.set(rows.filter((booking) => !gone.has(booking.id)));
    const open = draft.get();
    if (open !== undefined && gone.has(open.id)) draft.set(undefined);
  },
});

/** Restore the exact bookings before the last passing change. */
export const undoChange: Operation.Handle<void, void> = operation({
  label: "undoChange",
  depends: listCells,
  run: ({ saved, order, steps }) => {
    const list = steps.get();
    const last = list.at(-1);
    if (last === undefined) throw fail("EmptyUndo", {});
    saved.set(last.rows);
    order.set(last.order);
    steps.set(list.slice(0, -1));
  },
});

/** Rename every remaining occurrence of one series as one undo step. */
export const renameSeries: Operation.Handle<
  readonly Booking[],
  { seriesId: string; title: string }
> = operation({
  label: "renameSeries",
  depends: listCells,
  run: ({ saved, order, steps }, { rawInput }) => {
    const seriesId = readId(fieldOf(rawInput, "seriesId"));
    const title = readTitle(fieldOf(rawInput, "title"));
    const rows = saved.get();
    if (!rows.some((booking) => booking.seriesId === seriesId))
      throw fail("NotFound", { id: seriesId });
    const renamed = rows.map((booking) =>
      booking.seriesId === seriesId ? { ...booking, title } : booking,
    );
    steps.update((list) => [...list, { rows, order: order.get() }]);
    saved.set(renamed);
    return renamed.filter((booking) => booking.seriesId === seriesId).map(copyOf);
  },
});
