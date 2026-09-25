import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { addClass, classes, joinClass, leaveClass, setCapacity, undoGym } from "./model.ts";
import type { GymClass, Signup } from "./model.ts";
import { errorKind } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The typed form text: Name and Capacity from the class form, Member from the member form. */
export type GymDraft = { name: string; capacity: string; member: string };

/** Which signup rows the Signups table shows. Filtering never deletes. */
export type SignupFilter = "All" | "Booked" | "Waiting";

/** One Classes table row. */
export type ClassLine = {
  id: string;
  name: string;
  capacity: number;
  booked: number;
  waiting: number;
};

/** One Signups table row. */
export type SignupLine = {
  classId: string;
  className: string;
  member: string;
  status: string;
  booked: boolean;
};

const emptyDraft: GymDraft = { name: "", capacity: "", member: "" };

export const gymDraft: Data.Cell<GymDraft> = data({ label: "gymDraft", initial: emptyDraft });

/** The class id last chosen in the Class select; "" before any choice. */
export const chosenClass: Data.Cell<string> = data({ label: "chosenClass", initial: "" });

export const signupFilter: Data.Cell<SignupFilter> = data({
  label: "signupFilter",
  initial: "All",
});

export const notice: Data.Cell<Name | undefined> = data({ label: "notice", initial: undefined });

/** The class the Class select shows: the chosen one while it exists, else the first, else "". */
export const shownClassId = (saved: readonly GymClass[], chosen: string): string =>
  saved.some((each) => each.id === chosen) ? chosen : (saved.at(0)?.id ?? "");

const countOf = (list: readonly Signup[], classId: string, status: Signup["status"]): number =>
  list.filter((each) => each.classId === classId && each.status === status).length;

/** Classes table rows in saved order, with booked and waiting counts. */
export const classLines = (saved: readonly GymClass[], list: readonly Signup[]): ClassLine[] =>
  saved.map((each) => ({
    id: each.id,
    name: each.name,
    capacity: each.capacity,
    booked: countOf(list, each.id, "booked"),
    waiting: countOf(list, each.id, "waiting"),
  }));

const statusText = (list: readonly Signup[], at: number): string => {
  const signup = list[at];
  if (signup === undefined || signup.status === "booked") return "Booked";
  return `Waiting ${countOf(list.slice(0, at + 1), signup.classId, "waiting")}`;
};

const shownBy = (filter: SignupFilter, booked: boolean): boolean =>
  filter === "All" || (filter === "Booked") === booked;

/** Signups table rows for one filter, in saved order, with the class name and queue place. */
export const signupLines = (
  saved: readonly GymClass[],
  list: readonly Signup[],
  filter: SignupFilter,
): SignupLine[] =>
  list
    .map((each, at) => ({
      classId: each.classId,
      className: saved.find((row) => row.id === each.classId)?.name ?? each.classId,
      member: each.member,
      status: statusText(list, at),
      booked: each.status === "booked",
    }))
    .filter((line) => shownBy(filter, line.booked));

const kindOf = (error: unknown): Name => {
  const kind = errorKind(error);
  if (kind === undefined) throw error;
  return kind;
};

/** Type into the Name input. Clears any earlier notice. */
export const typeName: Operation.Handle<void, { value: string }> = operation({
  label: "typeName",
  depends: { draft: gymDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, name: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Capacity input. Clears any earlier notice. */
export const typeCapacity: Operation.Handle<void, { value: string }> = operation({
  label: "typeCapacity",
  depends: { draft: gymDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, capacity: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Member input. Clears any earlier notice. */
export const typeMember: Operation.Handle<void, { value: string }> = operation({
  label: "typeMember",
  depends: { draft: gymDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, member: input.value }));
    shown.set(undefined);
  },
});

/** Choose a class in the Class select. Clears any earlier notice. */
export const chooseClass: Operation.Handle<void, { classId: string }> = operation({
  label: "chooseClass",
  depends: { chosen: chosenClass.controller, shown: notice.controller },
  run: ({ chosen, shown }, { input }) => {
    chosen.set(input.classId);
    shown.set(undefined);
  },
});

/** Show All, Booked, or Waiting signup rows. Clears any earlier notice. */
export const chooseFilter: Operation.Handle<void, SignupFilter> = operation({
  label: "chooseFilter",
  depends: { filter: signupFilter.controller, shown: notice.controller },
  run: ({ filter, shown }, { input }) => {
    filter.set(input);
    shown.set(undefined);
  },
});

/** Add the typed class. Success clears Name and Capacity; failure keeps both. */
export const submitAdd: Operation.Handle<void, void> = operation({
  label: "submitAdd",
  depends: { draft: gymDraft.controller, shown: notice.controller, add: addClass.controller },
  run: ({ draft, shown, add }) => {
    const { name, capacity } = draft.get();
    try {
      add.run({ input: { name, capacity } });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.update((text) => ({ ...text, name: "", capacity: "" }));
    shown.set(undefined);
  },
});

/** Join the shown class with the typed member. Success clears Member; failure keeps it. */
export const submitJoin: Operation.Handle<void, void> = operation({
  label: "submitJoin",
  depends: {
    draft: gymDraft.controller,
    chosen: chosenClass.controller,
    saved: classes.controller,
    shown: notice.controller,
    join: joinClass.controller,
  },
  run: ({ draft, chosen, saved, shown, join }) => {
    const classId = shownClassId(saved.get(), chosen.get());
    try {
      join.run({ input: { classId, member: draft.get().member } });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.update((text) => ({ ...text, member: "" }));
    shown.set(undefined);
  },
});

/** Set the shown class's capacity to the Capacity text. Success clears Capacity only. */
export const submitCapacity: Operation.Handle<void, void> = operation({
  label: "submitCapacity",
  depends: {
    draft: gymDraft.controller,
    chosen: chosenClass.controller,
    saved: classes.controller,
    shown: notice.controller,
    set: setCapacity.controller,
  },
  run: ({ draft, chosen, saved, shown, set }) => {
    const classId = shownClassId(saved.get(), chosen.get());
    try {
      set.run({ input: { classId, capacity: draft.get().capacity } });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.update((text) => ({ ...text, capacity: "" }));
    shown.set(undefined);
  },
});

/** Remove one signup from its row button. */
export const submitRemove: Operation.Handle<void, { classId: string; member: string }> = operation({
  label: "submitRemove",
  depends: { shown: notice.controller, leave: leaveClass.controller },
  run: ({ shown, leave }, { input }) => {
    try {
      leave.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Undo the last passing change. Form text, the chosen class, and the filter stay. */
export const submitUndo: Operation.Handle<void, void> = operation({
  label: "submitUndo",
  depends: { shown: notice.controller, undo: undoGym.controller },
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
