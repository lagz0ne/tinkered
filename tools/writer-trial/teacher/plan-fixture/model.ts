/**
 * Teacher-only learning plan. Built from the frozen packet and public
 * core declarations only — never copied into a worker image or context.
 * Enough behavior for the checker to boot: core cells, managed errors,
 * course/link/complete/reopen/undo operations, and a labeled screen.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation, Scope } from "@tinker/core";
import { fail } from "./errors.ts";

export type Course = {
  id: string;
  title: string;
  done: boolean;
  prerequisiteIds: readonly string[];
};

export const courses: Data.Cell<readonly Course[]> = data({
  label: "courses",
  initial: [],
});

const undoHistory: Data.Cell<readonly (readonly Course[])[]> = data({
  label: "undoHistory",
  initial: [],
});

const issuedIds: Data.Cell<readonly string[]> = data({ label: "issuedIds", initial: [] });

type CourseCells = {
  courses: Scope.DataController<readonly Course[]>;
  history: Scope.DataController<readonly (readonly Course[])[]>;
  issued: Scope.DataController<readonly string[]>;
};

const cloneCourses = (rows: readonly Course[]): Course[] =>
  rows.map((row) => ({ ...row, prerequisiteIds: [...row.prerequisiteIds] }));

const cloneOne = (row: Course): Course => ({ ...row, prerequisiteIds: [...row.prerequisiteIds] });

const savedById = (rows: readonly Course[], id: string): Course => {
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw fail("NotFound", { id });
  return found;
};

const pushStep = (cells: CourseCells): void => {
  cells.history.update((prev) => [...prev, cloneCourses(cells.courses.get())]);
};

const freshId = (issued: Scope.DataController<readonly string[]>): string => {
  const id = globalThis.crypto.randomUUID();
  if (issued.get().includes(id)) return freshId(issued);
  issued.set([...issued.get(), id]);
  return id;
};

const titleOf = (raw: unknown): string => {
  if (typeof raw !== "string") throw fail("BlankTitle", { title: raw });
  const trimmed = raw.trim();
  if (trimmed === "") throw fail("BlankTitle", { title: raw });
  return trimmed;
};

/** True when courseId already reaches prerequisiteId through links. */
const reaches = (
  rows: readonly Course[],
  from: string,
  target: string,
  seen: readonly string[] = [],
): boolean => {
  if (from === target) return true;
  if (seen.includes(from)) return false;
  const row = rows.find((r) => r.id === from);
  if (row === undefined) return false;
  return row.prerequisiteIds.some((next) => reaches(rows, next, target, [...seen, from]));
};

/** Ready when incomplete with every direct prerequisite done. */
export const isReady = (rows: readonly Course[], row: Course): boolean =>
  !row.done && row.prerequisiteIds.every((pid) => rows.find((r) => r.id === pid)?.done === true);

/** Create a course with a trimmed title. Fails leave everything unchanged. */
export const createCourse: Operation.Handle<Course, { title: string }> = operation({
  label: "createCourse",
  depends: {
    courses: courses.controller,
    history: undoHistory.controller,
    issued: issuedIds.controller,
  },
  run: ({ courses: coursesCell, history, issued }, ctx) => {
    const title = titleOf(ctx.input.title);
    const saved: Course = {
      id: freshId(issued),
      title,
      done: false,
      prerequisiteIds: [],
    };
    pushStep({ courses: coursesCell, history, issued });
    coursesCell.set([...coursesCell.get(), saved]);
    return cloneOne(saved);
  },
});

/** Link courseId so it requires prerequisiteId. */
export const addPrerequisite: Operation.Handle<
  Course,
  { courseId: string; prerequisiteId: string }
> = operation({
  label: "addPrerequisite",
  depends: {
    courses: courses.controller,
    history: undoHistory.controller,
    issued: issuedIds.controller,
  },
  run: ({ courses: coursesCell, history, issued }, ctx) => {
    const { courseId, prerequisiteId } = ctx.input;
    const rows = coursesCell.get();
    const course = savedById(rows, courseId);
    savedById(rows, prerequisiteId);
    if (courseId === prerequisiteId) throw fail("SelfRequirement", { id: courseId });
    if (course.done) throw fail("CourseDone", { id: courseId });
    if (course.prerequisiteIds.includes(prerequisiteId)) return cloneOne(course);
    if (reaches(rows, prerequisiteId, courseId)) throw fail("Cycle", { courseId, prerequisiteId });
    pushStep({ courses: coursesCell, history, issued });
    const changed: Course = {
      ...course,
      prerequisiteIds: [...course.prerequisiteIds, prerequisiteId],
    };
    coursesCell.set(rows.map((row) => (row.id === courseId ? changed : row)));
    return cloneOne(changed);
  },
});

/** Remove the named link, keeping other links in order. */
export const removePrerequisite: Operation.Handle<
  Course,
  { courseId: string; prerequisiteId: string }
> = operation({
  label: "removePrerequisite",
  depends: {
    courses: courses.controller,
    history: undoHistory.controller,
    issued: issuedIds.controller,
  },
  run: ({ courses: coursesCell, history, issued }, ctx) => {
    const { courseId, prerequisiteId } = ctx.input;
    const rows = coursesCell.get();
    const course = savedById(rows, courseId);
    savedById(rows, prerequisiteId);
    if (course.done) throw fail("CourseDone", { id: courseId });
    if (!course.prerequisiteIds.includes(prerequisiteId))
      throw fail("NotRequired", { courseId, prerequisiteId });
    pushStep({ courses: coursesCell, history, issued });
    const changed: Course = {
      ...course,
      prerequisiteIds: course.prerequisiteIds.filter((id) => id !== prerequisiteId),
    };
    coursesCell.set(rows.map((row) => (row.id === courseId ? changed : row)));
    return cloneOne(changed);
  },
});

/** Complete a course only when its direct prerequisites are done. */
export const completeCourse: Operation.Handle<Course, { id: string }> = operation({
  label: "completeCourse",
  depends: {
    courses: courses.controller,
    history: undoHistory.controller,
    issued: issuedIds.controller,
  },
  run: ({ courses: coursesCell, history, issued }, ctx) => {
    const { id } = ctx.input;
    const rows = coursesCell.get();
    const course = savedById(rows, id);
    if (course.done) return cloneOne(course);
    const open = course.prerequisiteIds.filter((pid) => !savedById(rows, pid).done);
    if (open.length > 0) throw fail("PrerequisitesOpen", { id, prerequisiteIds: [...open] });
    pushStep({ courses: coursesCell, history, issued });
    const changed: Course = { ...course, prerequisiteIds: [...course.prerequisiteIds], done: true };
    coursesCell.set(rows.map((row) => (row.id === id ? changed : row)));
    return cloneOne(changed);
  },
});

/** Reopen a course only when no completed course directly requires it. */
export const reopenCourse: Operation.Handle<Course, { id: string }> = operation({
  label: "reopenCourse",
  depends: {
    courses: courses.controller,
    history: undoHistory.controller,
    issued: issuedIds.controller,
  },
  run: ({ courses: coursesCell, history, issued }, ctx) => {
    const { id } = ctx.input;
    const rows = coursesCell.get();
    const course = savedById(rows, id);
    if (!course.done) return cloneOne(course);
    const dependents = rows
      .filter((row) => row.done && row.prerequisiteIds.includes(id))
      .map((row) => row.id);
    if (dependents.length > 0) throw fail("DependentsDone", { id, dependentIds: dependents });
    pushStep({ courses: coursesCell, history, issued });
    const changed: Course = {
      ...course,
      prerequisiteIds: [...course.prerequisiteIds],
      done: false,
    };
    coursesCell.set(rows.map((row) => (row.id === id ? changed : row)));
    return cloneOne(changed);
  },
});

/** Restore the exact course list before the last passing change. */
export const undoPlan: Operation.Handle<void, void> = operation({
  label: "undoPlan",
  depends: { courses: courses.controller, history: undoHistory.controller },
  run: ({ courses: coursesCell, history }) => {
    const steps = history.get();
    const last = steps[steps.length - 1];
    if (last === undefined) throw fail("EmptyUndo", {});
    coursesCell.set(cloneCourses(last));
    history.set(steps.slice(0, -1));
  },
});

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
