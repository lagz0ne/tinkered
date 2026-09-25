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
      <label>
        Name
        <input
          value={draft.name}
          onChange={(event) => name.run({ input: { value: event.target.value } })}
        />
      </label>
      <label>
        Copies
        <input
          value={draft.copies}
          onChange={(event) => copies.run({ input: { value: event.target.value } })}
        />
      </label>
      <button type="submit">Add tool</button>
    </form>
  );
}

/** One Tools row; a tool that is not retired has its Retire button. */
function ToolLine(props: { readonly row: ToolRow }): ReactElement {
  const { row } = props;
  const retire = useRun(submitRetire);
  return (
    <tr>
      <td>{row.name}</td>
      <td>{row.copies}</td>
      <td>{row.out}</td>
      <td>{row.status}</td>
      <td>
        {row.status === "Retired" ? null : (
          <button type="button" onClick={() => retire.run({ input: { toolId: row.id } })}>
            Retire {row.name}
          </button>
        )}
      </td>
    </tr>
  );
}

/** The filter buttons and the Tools table. */
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
      <table aria-label="Tools">
        <thead>
          <tr>
            <th>Name</th>
            <th>Copies</th>
            <th>Out</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {toolRows(saved, open, filter).map((row) => (
            <ToolLine key={row.id} row={row} />
          ))}
        </tbody>
      </table>
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
      <label>
        Tool
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
      </label>
      <label>
        Member
        <input
          value={draft.member}
          onChange={(event) => member.run({ input: { value: event.target.value } })}
        />
      </label>
      <button type="submit">Lend</button>
    </form>
  );
}

/** One Loans row with its Return button. */
function LoanLine(props: { readonly row: LoanRow }): ReactElement {
  const { row } = props;
  const giveBack = useRun(submitReturn);
  return (
    <tr>
      <td>{row.toolName}</td>
      <td>{row.member}</td>
      <td>
        <button type="button" onClick={() => giveBack.run({ input: { loanId: row.id } })}>
          Return {row.toolName} from {row.member}
        </button>
      </td>
    </tr>
  );
}

/** The Loans table in saved loan order. */
function LoanTable(): ReactElement {
  const saved = useData(tools);
  const open = useData(loans);
  return (
    <table aria-label="Loans">
      <thead>
        <tr>
          <th>Tool</th>
          <th>Member</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {loanRows(saved, open).map((row) => (
          <LoanLine key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

/** The shared notice and the Undo button. */
function Notice(): ReactElement {
  const shown = useData(notice);
  const undo = useRun(submitUndo);
  return (
    <>
      <div role="alert">{shown}</div>
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
      <main>
        <ToolForm />
        <Notice />
        <ToolTable />
        <LendForm />
        <LoanTable />
      </main>
    </ScopeProvider>
  );
}
