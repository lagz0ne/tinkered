/**
 * Teacher-only gym class waitlist. Built from the frozen task and the public
 * core declarations only; never copied into a worker image or context.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { fail } from "./errors.ts";

/** One gym class. */
export type GymClass = { id: string; name: string; capacity: number };

/** Whether a signup has a place or waits for one. */
export type SignupStatus = "booked" | "waiting";

/** One member in one class. */
export type Signup = { classId: string; member: string; status: SignupStatus };

/** The records one undo step puts back. */
type Records = { classes: readonly GymClass[]; signups: readonly Signup[] };

/** Every class in saved order. */
export const classes: Data.Cell<readonly GymClass[]> = data({ label: "classes", initial: [] });

/** Every signup in saved order. */
export const signups: Data.Cell<readonly Signup[]> = data({ label: "signups", initial: [] });

const history: Data.Cell<readonly Records[]> = data({ label: "history", initial: [] });

const gymCells = {
  classes: classes.controller,
  signups: signups.controller,
  history: history.controller,
};

const CAPACITY = /^(?:[1-9]|1\d|20)$/;

type RawCall = { readonly [field: string]: unknown };

const isRawCall = (raw: unknown): raw is RawCall => typeof raw === "object" && raw !== null;

function fieldOf(raw: unknown, field: string): unknown {
  return isRawCall(raw) ? raw[field] : undefined;
}

function readName(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw fail("BadName", { name: raw });
  return raw.trim();
}

function readCapacity(raw: unknown): number {
  if (typeof raw !== "string" || !CAPACITY.test(raw.trim()))
    throw fail("BadCapacity", { capacity: raw });
  return Number(raw.trim());
}

function readMember(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw fail("BlankMember", { member: raw });
  return raw.trim();
}

const findClass = (rows: readonly GymClass[], id: unknown): GymClass => {
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw fail("NotFound", { id: String(id) });
  return found;
};

const bookedIn = (list: readonly Signup[], classId: string): number =>
  list.filter((each) => each.classId === classId && each.status === "booked").length;

const findSignup = (list: readonly Signup[], classId: string, member: string): Signup | undefined =>
  list.find((each) => each.classId === classId && each.member === member);

/** Book the first `places` waiting signups of one class, in signup order, each in place. */
const bookWaiters = (
  list: readonly Signup[],
  classId: string,
  places: number,
): readonly Signup[] => {
  let left = places;
  return list.map((each): Signup => {
    if (left === 0 || each.classId !== classId || each.status !== "waiting") return each;
    left--;
    return { ...each, status: "booked" };
  });
};

/** Add a class at the end; its id is K and the class count after adding it. */
export const addClass: Operation.Handle<GymClass, { name: string; capacity: string }> = operation({
  label: "addClass",
  depends: gymCells,
  run: (cells, { rawInput }) => {
    const name = readName(fieldOf(rawInput, "name"));
    const capacity = readCapacity(fieldOf(rawInput, "capacity"));
    const rows = cells.classes.get();
    if (rows.some((row) => row.name === name)) throw fail("DuplicateName", { name });
    const added: GymClass = { id: `K${rows.length + 1}`, name, capacity };
    const step: Records = { classes: rows, signups: cells.signups.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.classes.set([...rows, added]);
    return added;
  },
});

/** Change a class's capacity; a larger one books its waiting members first come first served. */
export const setCapacity: Operation.Handle<GymClass, { classId: string; capacity: string }> =
  operation({
    label: "setCapacity",
    depends: gymCells,
    run: (cells, { rawInput }) => {
      const rows = cells.classes.get();
      const found = findClass(rows, fieldOf(rawInput, "classId"));
      const capacity = readCapacity(fieldOf(rawInput, "capacity"));
      if (capacity === found.capacity) return found;
      const list = cells.signups.get();
      const booked = bookedIn(list, found.id);
      if (capacity < booked) throw fail("CapacityTooLow", { classId: found.id, booked });
      const changed: GymClass = { ...found, capacity };
      const step: Records = { classes: rows, signups: list };
      cells.history.update((steps) => [...steps, step]);
      cells.classes.set(rows.map((row) => (row.id === found.id ? changed : row)));
      cells.signups.set(bookWaiters(list, found.id, capacity - booked));
      return changed;
    },
  });

/** Add a member to a class: booked while a place is free, waiting when it is full. */
export const joinClass: Operation.Handle<Signup, { classId: string; member: string }> = operation({
  label: "joinClass",
  depends: gymCells,
  run: (cells, { rawInput }) => {
    const rows = cells.classes.get();
    const found = findClass(rows, fieldOf(rawInput, "classId"));
    const member = readMember(fieldOf(rawInput, "member"));
    const list = cells.signups.get();
    const saved = findSignup(list, found.id, member);
    if (saved !== undefined) return saved;
    const status: SignupStatus = bookedIn(list, found.id) < found.capacity ? "booked" : "waiting";
    const added: Signup = { classId: found.id, member, status };
    const step: Records = { classes: rows, signups: list };
    cells.history.update((steps) => [...steps, step]);
    cells.signups.set([...list, added]);
    return added;
  },
});

/** Remove a member's signup; a booked leaver books the class's first waiting member in place. */
export const leaveClass: Operation.Handle<Signup, { classId: string; member: string }> = operation({
  label: "leaveClass",
  depends: gymCells,
  run: (cells, { rawInput }) => {
    const rows = cells.classes.get();
    const found = findClass(rows, fieldOf(rawInput, "classId"));
    const member = readMember(fieldOf(rawInput, "member"));
    const list = cells.signups.get();
    const saved = findSignup(list, found.id, member);
    if (saved === undefined) throw fail("NotJoined", { classId: found.id, member });
    const rest = list.filter((each) => each !== saved);
    const step: Records = { classes: rows, signups: list };
    cells.history.update((steps) => [...steps, step]);
    cells.signups.set(saved.status === "booked" ? bookWaiters(rest, found.id, 1) : rest);
    return saved;
  },
});

/** Restore the exact classes and signups before the last passing change. */
export const undoGym: Operation.Handle<void, void> = operation({
  label: "undoGym",
  depends: gymCells,
  run: (cells) => {
    const steps = cells.history.get();
    const last = steps.at(-1);
    if (last === undefined) throw fail("EmptyUndo", {});
    cells.classes.set(last.classes);
    cells.signups.set(last.signups);
    cells.history.set(steps.slice(0, -1));
  },
});
