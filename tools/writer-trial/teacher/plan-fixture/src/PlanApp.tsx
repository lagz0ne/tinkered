import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { Field, NamedTable, Notice, Page } from "./layout.tsx";
import { courses } from "./model.ts";
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
  submitAddLink,
  submitCourse,
  submitRemoveLink,
  submitUndo,
  typeTitle,
} from "./screen.ts";
import { submitComplete, submitReopen } from "./screen.ts";
import { isReady } from "./model.ts";

/** The button one course row has: Reopen when complete, Complete otherwise. */
function CourseButton(props: { readonly row: Course }): ReactElement {
  const { row } = props;
  const complete = useRun(submitComplete);
  const reopen = useRun(submitReopen);
  return row.done ? (
    <button type="button" onClick={() => reopen.run({ input: { id: row.id } })}>
      Reopen {row.title}
    </button>
  ) : (
    <button type="button" onClick={() => complete.run({ input: { id: row.id } })}>
      Complete {row.title}
    </button>
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
      <Field
        name="Title"
        control={
          <input
            value={form.title}
            onChange={(event) => type.run({ input: { value: event.target.value } })}
          />
        }
      />
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
      <Field
        name="Course"
        control={
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
        }
      />
      <Field
        name="Prerequisite"
        control={
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
        }
      />
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
  const undo = useRun(submitUndo);
  const byId = (id: string): Course | undefined => rows.find((row) => row.id === id);
  const requiresText = (row: Course): string => {
    if (row.prerequisiteIds.length === 0) return "None";
    return row.prerequisiteIds.map((pid) => byId(pid)?.title ?? "Removed course").join(", ");
  };
  const statusText = (row: Course): string => {
    if (row.done) return "Done";
    return isReady(rows, row) ? "Ready" : "Blocked";
  };
  const shown =
    filter === "All"
      ? rows
      : filter === "Done"
        ? rows.filter((r) => r.done)
        : rows.filter((r) => isReady(rows, r));
  return (
    <Page>
      <CourseForm />
      <Notice text={alert} />
      <NamedTable
        name="Courses"
        headers={["Title", "Status", "Requires"]}
        rows={shown.map((row) => ({
          key: row.id,
          cells: [row.title, statusText(row), requiresText(row)],
          actions: <CourseButton row={row} />,
        }))}
      />
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
    </Page>
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
