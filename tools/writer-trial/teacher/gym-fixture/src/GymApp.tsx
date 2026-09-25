import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { Field, NamedTable, Notice, Page } from "./layout.tsx";
import { classes, signups } from "./model.ts";
import {
  chooseClass,
  chooseFilter,
  chosenClass,
  classLines,
  gymDraft,
  notice,
  shownClassId,
  signupFilter,
  signupLines,
  submitAdd,
  submitCapacity,
  submitJoin,
  submitRemove,
  submitUndo,
  typeCapacity,
  typeMember,
  typeName,
} from "./screen.ts";
import type { SignupFilter, SignupLine } from "./screen.ts";

const filters: readonly SignupFilter[] = ["All", "Booked", "Waiting"];

/** The class form: labeled Name and Capacity inputs and Add class. */
function ClassForm(): ReactElement {
  const draft = useData(gymDraft);
  const name = useRun(typeName);
  const capacity = useRun(typeCapacity);
  const add = useRun(submitAdd);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        add.run();
      }}
    >
      <Field
        name="Name"
        control={
          <input
            value={draft.name}
            onChange={(event) => name.run({ input: { value: event.target.value } })}
          />
        }
      />
      <Field
        name="Capacity"
        control={
          <input
            value={draft.capacity}
            onChange={(event) => capacity.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Add class</button>
    </form>
  );
}

/** The member form: the Class select, the Member input, Join, and Set capacity. */
function MemberForm(): ReactElement {
  const draft = useData(gymDraft);
  const saved = useData(classes);
  const chosen = useData(chosenClass);
  const choose = useRun(chooseClass);
  const member = useRun(typeMember);
  const join = useRun(submitJoin);
  const setCapacity = useRun(submitCapacity);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        join.run();
      }}
    >
      <Field
        name="Class"
        control={
          <select
            value={shownClassId(saved, chosen)}
            onChange={(event) => choose.run({ input: { classId: event.target.value } })}
          >
            {saved.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        }
      />
      <Field
        name="Member"
        control={
          <input
            value={draft.member}
            onChange={(event) => member.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Join</button>
      <button type="button" onClick={() => setCapacity.run()}>
        Set capacity
      </button>
    </form>
  );
}

/** The shared notice and the Undo button. */
function NoticeBar(): ReactElement {
  const shown = useData(notice);
  const undo = useRun(submitUndo);
  return (
    <>
      <Notice text={shown} />
      <button type="button" onClick={() => undo.run()}>
        Undo
      </button>
    </>
  );
}

/** The Classes table with booked and waiting counts. */
function ClassTable(): ReactElement {
  const saved = useData(classes);
  const list = useData(signups);
  return (
    <NamedTable
      name="Classes"
      headers={["Class", "Capacity", "Booked", "Waiting"]}
      rows={classLines(saved, list).map((line) => ({
        key: line.id,
        cells: [line.name, String(line.capacity), String(line.booked), String(line.waiting)],
      }))}
    />
  );
}

/** The button every signup row has: Remove <member> from <class name>. */
function RemoveButton(props: { readonly line: SignupLine }): ReactElement {
  const { line } = props;
  const remove = useRun(submitRemove);
  return (
    <button
      type="button"
      onClick={() => remove.run({ input: { classId: line.classId, member: line.member } })}
    >
      Remove {line.member} from {line.className}
    </button>
  );
}

/** The filter buttons and the Signups table. */
function SignupTable(): ReactElement {
  const saved = useData(classes);
  const list = useData(signups);
  const filter = useData(signupFilter);
  const choose = useRun(chooseFilter);
  return (
    <>
      <div>
        {filters.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={each === filter}
            onClick={() => choose.run({ input: each })}
          >
            {each}
          </button>
        ))}
      </div>
      <NamedTable
        name="Signups"
        headers={["Class", "Member", "Status"]}
        rows={signupLines(saved, list, filter).map((line) => ({
          key: `${line.classId}:${line.member}`,
          cells: [line.className, line.member, line.status],
          actions: <RemoveButton line={line} />,
        }))}
      />
    </>
  );
}

/** One GymApp owns a fresh scope. Two apps share nothing. */
export function GymApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <Page>
        <ClassForm />
        <MemberForm />
        <NoticeBar />
        <ClassTable />
        <SignupTable />
      </Page>
    </ScopeProvider>
  );
}
