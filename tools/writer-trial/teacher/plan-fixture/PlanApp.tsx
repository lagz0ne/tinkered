import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { courses, undoPlan } from "./model.ts";
import type { Course } from "./model.ts";
import {
  courseFilter,
  courseForm,
  coursePick,
  notice,
  pickCourse,
  pickFilter,
  pickPrereq,
  prereqPick,
  selectedCourse,
  selectCourse,
  submitAddLink,
  submitCourse,
  submitRemoveLink,
  typeTitle,
} from "./screen.ts";
import { submitComplete, submitReopen } from "./screen.ts";

/** One course row in saved order. */
function CourseRow(props: { readonly row: Course; readonly requires: string }): ReactElement {
  const { row, requires } = props;
  const complete = useRun(submitComplete);
  const reopen = useRun(submitReopen);
  const select = useRun(selectCourse);
  const selected = useData(selectedCourse);
  const status = row.done ? "Done" : requires === "blocked" ? "Blocked" : "Ready";
  return (
    <tr aria-selected={selected === row.id}>
      <td>{row.title}</td>
      <td>{status}</td>
      <td>{requires === "blocked" || requires === "" ? requires || "None" : requires}</td>
      <td>
        {row.done ? (
          <button type="button" onClick={() => reopen.run({ input: { id: row.id } })}>
            Reopen {row.title}
          </button>
        ) : (
          <button type="button" onClick={() => complete.run({ input: { id: row.id } })}>
            Complete {row.title}
          </button>
        )}
        <button type="button" onClick={() => select.run({ input: { id: row.id } })}>
          Select {row.title}
        </button>
      </td>
    </tr>
  );
}

/** The new-course form: labeled Title input and Add course. */
function CourseForm(): ReactElement {
  const form = useData(courseForm);
  const type = useRun(typeTitle);
  const submit = useRun(submitCourse);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
      }}
    >
      <label>
        Title
        <input
          value={form.title}
          onChange={(event) => type.run({ input: { value: event.target.value } })}
        />
      </label>
      <button type="submit">Add course</button>
    </form>
  );
}

/** The link form: two labeled selects and both link actions. */
function LinkForm(props: { readonly rows: readonly Course[] }): ReactElement {
  const { rows } = props;
  const courseId = useData(coursePick);
  const prerequisiteId = useData(prereqPick);
  const pickOne = useRun(pickCourse);
  const pickTwo = useRun(pickPrereq);
  const add = useRun(submitAddLink);
  const remove = useRun(submitRemoveLink);
  const removedLabel = (id: string): string =>
    rows.some((row) => row.id === id)
      ? (rows.find((row) => row.id === id)?.title ?? id)
      : "Removed course";
  const optionLabel = (id: string): string => (id === "" ? "Choose course" : removedLabel(id));
  const optionValue = (id: string): string => id;
  const courseOptions = (selected: string): readonly string[] =>
    selected === "" || rows.some((row) => row.id === selected)
      ? rows.map((row) => row.id)
      : [...rows.map((row) => row.id), selected];
  return (
    <form>
      <label>
        Course
        <select
          value={courseId}
          onChange={(event) => pickOne.run({ input: { id: event.target.value } })}
        >
          <option value="">Choose course</option>
          {courseOptions(courseId).map((id) => (
            <option key={id} value={optionValue(id)}>
              {optionLabel(id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prerequisite
        <select
          value={prerequisiteId}
          onChange={(event) => pickTwo.run({ input: { id: event.target.value } })}
        >
          <option value="">Choose course</option>
          {courseOptions(prerequisiteId).map((id) => (
            <option key={id} value={optionValue(id)}>
              {optionLabel(id)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => {
          add.run();
        }}
      >
        Add requirement
      </button>
      <button
        type="button"
        onClick={() => {
          remove.run();
        }}
      >
        Remove requirement
      </button>
    </form>
  );
}

/** Inner app: reads cells, runs operations, renders values only. */
function Plan(): ReactElement {
  const rows = useData(courses);
  const filter = useData(courseFilter);
  const alert = useData(notice);
  const pick = useRun(pickFilter);
  const undo = useRun(undoPlan);
  const byId = (id: string): Course | undefined => rows.find((row) => row.id === id);
  const isReady = (row: Course): boolean =>
    !row.done && row.prerequisiteIds.every((pid) => byId(pid)?.done === true);
  const requiresText = (row: Course): string => {
    if (row.prerequisiteIds.length === 0) return "";
    return row.prerequisiteIds.map((pid) => byId(pid)?.title ?? "Removed course").join(", ");
  };
  const blockedText = (row: Course): string => {
    if (row.done) return requiresText(row);
    if (row.prerequisiteIds.length === 0) return "";
    return isReady(row) ? requiresText(row) : "blocked";
  };
  const shown =
    filter === "All" ? rows : filter === "Done" ? rows.filter((r) => r.done) : rows.filter(isReady);
  return (
    <main>
      <CourseForm />
      <div role="alert">{alert === undefined ? "" : alert}</div>
      <table aria-label="Courses">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Requires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <CourseRow key={row.id} row={row} requires={blockedText(row)} />
          ))}
        </tbody>
      </table>
      <div>
        <button type="button" onClick={() => pick.run({ input: "All" })}>
          All
        </button>
        <button type="button" onClick={() => pick.run({ input: "Ready" })}>
          Ready
        </button>
        <button type="button" onClick={() => pick.run({ input: "Done" })}>
          Done
        </button>
      </div>
      <LinkForm rows={rows} />
      <button type="button" onClick={() => undo.run()}>
        Undo
      </button>
    </main>
  );
}

/** One PlanApp owns a fresh scope. Two roots share nothing. */
export function PlanApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <Plan />
    </ScopeProvider>
  );
}
