import { data, operation } from "@tinker/core";
import type { Data, Operation, Scope } from "@tinker/core";
import {
  addPrerequisite,
  completeCourse,
  createCourse,
  removePrerequisite,
  reopenCourse,
} from "./model.ts";
import { errorKind, fail } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The new-course form text, exactly as typed. */
export type TitleText = { title: string };

/** Which rows the Courses table shows. Filtering never deletes. */
export type CourseFilter = "All" | "Ready" | "Done";

export const courseForm: Data.Cell<TitleText> = data({
  label: "courseForm",
  initial: { title: "" },
});

export const coursePick: Data.Cell<string> = data({ label: "coursePick", initial: "" });

export const prereqPick: Data.Cell<string> = data({ label: "prereqPick", initial: "" });

export const courseFilter: Data.Cell<CourseFilter> = data({
  label: "courseFilter",
  initial: "All",
});

export const notice: Data.Cell<Name | undefined> = data({
  label: "notice",
  initial: undefined,
});

export const selectedCourse: Data.Cell<string> = data({ label: "selectedCourse", initial: "" });

/** Run one body, showing the first managed error's kind and rethrowing. */
const withNotice = <R>(body: () => R, cell: Scope.DataController<Name | undefined>): R => {
  try {
    return body();
  } catch (error) {
    const kind = errorKind(error);
    if (kind === undefined) throw error;
    cell.set(kind);
    throw error;
  }
};

/** Type into the new-course form. Typing clears any earlier notice. */
export const typeTitle: Operation.Handle<void, { value: string }> = operation({
  label: "typeTitle",
  depends: { form: courseForm.controller, noticeCell: notice.controller },
  run: ({ form, noticeCell }, ctx) => {
    form.set({ title: ctx.input.value });
    noticeCell.set(undefined);
  },
});

/** Choose the Course select. Choosing clears any earlier notice. */
export const pickCourse: Operation.Handle<void, { id: string }> = operation({
  label: "pickCourse",
  depends: { pick: coursePick.controller, noticeCell: notice.controller },
  run: ({ pick, noticeCell }, ctx) => {
    pick.set(ctx.input.id);
    noticeCell.set(undefined);
  },
});

/** Choose the Prerequisite select. Choosing clears any earlier notice. */
export const pickPrereq: Operation.Handle<void, { id: string }> = operation({
  label: "pickPrereq",
  depends: { pick: prereqPick.controller, noticeCell: notice.controller },
  run: ({ pick, noticeCell }, ctx) => {
    pick.set(ctx.input.id);
    noticeCell.set(undefined);
  },
});

/** Show All, Ready, or Done rows. Filtering clears any earlier notice. */
export const pickFilter: Operation.Handle<void, CourseFilter> = operation({
  label: "pickFilter",
  depends: { filter: courseFilter.controller, noticeCell: notice.controller },
  run: ({ filter, noticeCell }, ctx) => {
    filter.set(ctx.input);
    noticeCell.set(undefined);
  },
});

/** Select a course row. Selecting adds no record and no undo step. */
export const selectCourse: Operation.Handle<void, { id: string }> = operation({
  label: "selectCourse",
  depends: { selected: selectedCourse.controller },
  run: ({ selected }, ctx) => {
    selected.set(ctx.input.id);
  },
});

/** Submit the new-course form. Success clears Title; failure keeps it. */
export const submitCourse: Operation.Handle<void, void> = operation({
  label: "submitCourse",
  depends: {
    form: courseForm.controller,
    noticeCell: notice.controller,
    create: createCourse.controller,
  },
  run: ({ form, noticeCell, create }) =>
    withNotice(() => {
      create.run({ input: { title: form.get().title } });
      form.set({ title: "" });
      noticeCell.set(undefined);
    }, noticeCell),
});

/** Add the selected link. Keeps both selects after success or failure. */
export const submitAddLink: Operation.Handle<void, void> = operation({
  label: "submitAddLink",
  depends: {
    pick: coursePick.controller,
    prereq: prereqPick.controller,
    noticeCell: notice.controller,
    add: addPrerequisite.controller,
  },
  run: ({ pick, prereq, noticeCell, add }) =>
    withNotice(() => {
      const courseId = pick.get();
      const prerequisiteId = prereq.get();
      if (courseId === "" || prerequisiteId === "") throw fail("NotFound", { id: "" });
      add.run({ input: { courseId, prerequisiteId } });
      noticeCell.set(undefined);
    }, noticeCell),
});

/** Remove the selected link. Keeps both selects after success or failure. */
export const submitRemoveLink: Operation.Handle<void, void> = operation({
  label: "submitRemoveLink",
  depends: {
    pick: coursePick.controller,
    prereq: prereqPick.controller,
    noticeCell: notice.controller,
    remove: removePrerequisite.controller,
  },
  run: ({ pick, prereq, noticeCell, remove }) =>
    withNotice(() => {
      const courseId = pick.get();
      const prerequisiteId = prereq.get();
      if (courseId === "" || prerequisiteId === "") throw fail("NotFound", { id: "" });
      remove.run({ input: { courseId, prerequisiteId } });
      noticeCell.set(undefined);
    }, noticeCell),
});

/** Complete one course from its row button. */
export const submitComplete: Operation.Handle<void, { id: string }> = operation({
  label: "submitComplete",
  depends: { noticeCell: notice.controller, complete: completeCourse.controller },
  run: ({ noticeCell, complete }, ctx) =>
    withNotice(() => {
      complete.run({ input: { id: ctx.input.id } });
      noticeCell.set(undefined);
    }, noticeCell),
});

/** Reopen one course from its row button. */
export const submitReopen: Operation.Handle<void, { id: string }> = operation({
  label: "submitReopen",
  depends: { noticeCell: notice.controller, reopen: reopenCourse.controller },
  run: ({ noticeCell, reopen }, ctx) =>
    withNotice(() => {
      reopen.run({ input: { id: ctx.input.id } });
      noticeCell.set(undefined);
    }, noticeCell),
});
