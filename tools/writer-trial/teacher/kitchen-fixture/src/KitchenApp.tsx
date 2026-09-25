import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { MENU, stove, tickets } from "./model.ts";
import {
  chooseDish,
  chooseFilter,
  notice,
  stoveDraft,
  submitCancel,
  submitCook,
  submitServe,
  submitStove,
  submitTicket,
  submitUndo,
  ticketDraft,
  ticketFilter,
  ticketRows,
  typeQty,
  typeStove,
  typeTable,
} from "./screen.ts";
import type { TicketFilter, TicketRow } from "./screen.ts";

const filters: readonly TicketFilter[] = ["All", "Waiting", "Cooking", "Served"];

/** The new-ticket form: labeled Table input, Dish select, Qty input, and Add ticket. */
function TicketForm(): ReactElement {
  const draft = useData(ticketDraft);
  const table = useRun(typeTable);
  const dish = useRun(chooseDish);
  const qty = useRun(typeQty);
  const submit = useRun(submitTicket);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
      }}
    >
      <label>
        Table
        <input
          value={draft.table}
          onChange={(event) => table.run({ input: { value: event.target.value } })}
        />
      </label>
      <label>
        Dish
        <select
          value={draft.dish}
          onChange={(event) => dish.run({ input: { dish: event.target.value } })}
        >
          <option value="">Choose dish</option>
          {MENU.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Qty
        <input
          value={draft.qty}
          onChange={(event) => qty.run({ input: { value: event.target.value } })}
        />
      </label>
      <button type="submit">Add ticket</button>
    </form>
  );
}

/** The stove form and the saved stove size. */
function StoveForm(): ReactElement {
  const size = useData(stove);
  const draft = useData(stoveDraft);
  const type = useRun(typeStove);
  const submit = useRun(submitStove);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
      }}
    >
      <p>Stove: {size}</p>
      <label>
        Stove size
        <input
          value={draft}
          onChange={(event) => type.run({ input: { value: event.target.value } })}
        />
      </label>
      <button type="submit">Set stove</button>
    </form>
  );
}

/** The buttons one ticket row has in its state. */
function RowButtons(props: { readonly row: TicketRow }): ReactElement | null {
  const { row } = props;
  const cook = useRun(submitCook);
  const serve = useRun(submitServe);
  const cancel = useRun(submitCancel);
  const input = { ticketId: row.id };
  const name = `${row.dish} for table ${row.table}`;
  if (row.state === "Waiting")
    return (
      <>
        <button type="button" onClick={() => cook.run({ input })}>
          Cook {name}
        </button>
        <button type="button" onClick={() => cancel.run({ input })}>
          Cancel {name}
        </button>
      </>
    );
  if (row.state === "Cooking")
    return (
      <button type="button" onClick={() => serve.run({ input })}>
        Serve {name}
      </button>
    );
  return null;
}

/** One Tickets row. */
function TicketLine(props: { readonly row: TicketRow }): ReactElement {
  const { row } = props;
  return (
    <tr>
      <td>{row.table}</td>
      <td>{row.dish}</td>
      <td>{row.qty}</td>
      <td>{row.state}</td>
      <td>
        <RowButtons row={row} />
      </td>
    </tr>
  );
}

/** The filter buttons and the Tickets table. */
function TicketTable(): ReactElement {
  const saved = useData(tickets);
  const filter = useData(ticketFilter);
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
      <table aria-label="Tickets">
        <thead>
          <tr>
            <th>Table</th>
            <th>Dish</th>
            <th>Qty</th>
            <th>State</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {ticketRows(saved, filter).map((row) => (
            <TicketLine key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </>
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

/** One KitchenApp owns a fresh scope. Two apps share nothing. */
export function KitchenApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <main>
        <TicketForm />
        <StoveForm />
        <Notice />
        <TicketTable />
      </main>
    </ScopeProvider>
  );
}
