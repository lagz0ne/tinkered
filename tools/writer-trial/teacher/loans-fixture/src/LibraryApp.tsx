import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { loans, tools } from "./model.ts";
import {
  chooseFilter,
  chooseTool,
  lendDraft,
  loanRows,
  notice,
  submitLend,
  submitRetire,
  submitReturn,
  submitTool,
  submitUndo,
  toolDraft,
  toolFilter,
  toolRows,
  typeCopies,
  typeMember,
  typeName,
} from "./screen.ts";
import type { LoanRow, ToolFilter, ToolRow } from "./screen.ts";
import { Field, NamedTable, Notice, Page } from "./layout.tsx";

const filters: readonly ToolFilter[] = ["All", "Available", "Retired"];

/** The new-tool form: labeled Name and Copies inputs and Add tool. */
function ToolForm(): ReactElement {
  const draft = useData(toolDraft);
  const name = useRun(typeName);
  const copies = useRun(typeCopies);
  const submit = useRun(submitTool);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
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
        name="Copies"
        control={
          <input
            value={draft.copies}
            onChange={(event) => copies.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Add tool</button>
    </form>
  );
}

/** The Retire button of one Tools row. */
function RetireButton(props: { readonly row: ToolRow }): ReactElement {
  const { row } = props;
  const retire = useRun(submitRetire);
  return (
    <button type="button" onClick={() => retire.run({ input: { toolId: row.id } })}>
      Retire {row.name}
    </button>
  );
}

/** The filter buttons and the Tools table; a tool that is not retired has its Retire button. */
function ToolTable(): ReactElement {
  const saved = useData(tools);
  const open = useData(loans);
  const filter = useData(toolFilter);
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
        name="Tools"
        headers={["Name", "Copies", "Out", "Status"]}
        rows={toolRows(saved, open, filter).map((row) => ({
          key: row.id,
          cells: [row.name, row.copies, row.out, row.status],
          actions: row.status === "Retired" ? undefined : <RetireButton row={row} />,
        }))}
      />
    </>
  );
}

/** The lend form: labeled Tool select, Member input, and Lend. */
function LendForm(): ReactElement {
  const saved = useData(tools);
  const draft = useData(lendDraft);
  const choose = useRun(chooseTool);
  const member = useRun(typeMember);
  const lend = useRun(submitLend);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        lend.run();
      }}
    >
      <Field
        name="Tool"
        control={
          <select
            value={draft.toolId}
            onChange={(event) => choose.run({ input: { toolId: event.target.value } })}
          >
            <option value="">Choose tool</option>
            {saved.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.name}
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
      <button type="submit">Lend</button>
    </form>
  );
}

/** The Return button of one Loans row. */
function ReturnButton(props: { readonly row: LoanRow }): ReactElement {
  const { row } = props;
  const giveBack = useRun(submitReturn);
  return (
    <button type="button" onClick={() => giveBack.run({ input: { loanId: row.id } })}>
      Return {row.toolName} from {row.member}
    </button>
  );
}

/** The Loans table in saved loan order, each row with its Return button. */
function LoanTable(): ReactElement {
  const saved = useData(tools);
  const open = useData(loans);
  return (
    <NamedTable
      name="Loans"
      headers={["Tool", "Member"]}
      rows={loanRows(saved, open).map((row) => ({
        key: row.id,
        cells: [row.toolName, row.member],
        actions: <ReturnButton row={row} />,
      }))}
    />
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

/** One LibraryApp owns a fresh scope. Two apps share nothing. */
export function LibraryApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <Page>
        <ToolForm />
        <NoticeBar />
        <ToolTable />
        <LendForm />
        <LoanTable />
      </Page>
    </ScopeProvider>
  );
}
