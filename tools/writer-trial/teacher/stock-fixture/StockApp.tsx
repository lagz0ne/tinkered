import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { editDraft, moves, stock, undoMove } from "./model.ts";
import type { Move } from "./model.ts";
import {
  bookingForm,
  chooseFilter,
  chooseFormField,
  editFormText,
  listFilter,
  notice,
  openEditor,
  submitEditDiscard,
  submitEditSave,
  submitMove,
  typeEditField,
} from "./screen.ts";

/** One stock row. */
function StockRow(props: {
  readonly row: { readonly item: string; readonly place: string; readonly quantity: number };
}): ReactElement {
  const { row } = props;
  return (
    <tr>
      <td>{row.item}</td>
      <td>{row.place}</td>
      <td>{row.quantity}</td>
    </tr>
  );
}

/** One move row with its edit button. */
function MoveRow(props: {
  readonly move: Move;
  readonly onEdit: (id: string) => void;
}): ReactElement {
  const { move, onEdit } = props;
  return (
    <tr>
      <td>{move.item}</td>
      <td>{move.from}</td>
      <td>{move.to}</td>
      <td>{move.quantity}</td>
      <td>
        <button type="button" aria-label="Edit move" onClick={() => onEdit(move.id)}>
          Edit move
        </button>
      </td>
    </tr>
  );
}

/** The move form: labeled text inputs with the packet's initial text. */
function MoveForm(): ReactElement {
  const form = useData(bookingForm);
  const type = useRun(chooseFormField);
  const submit = useRun(submitMove);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
      }}
    >
      <label>
        Item
        <input
          value={form.item}
          onChange={(event) => type.run({ input: { field: "item", value: event.target.value } })}
        />
      </label>
      <label>
        From
        <input
          value={form.from}
          onChange={(event) => type.run({ input: { field: "from", value: event.target.value } })}
        />
      </label>
      <label>
        To
        <input
          value={form.to}
          onChange={(event) => type.run({ input: { field: "to", value: event.target.value } })}
        />
      </label>
      <label>
        Quantity
        <input
          value={form.quantity}
          onChange={(event) =>
            type.run({ input: { field: "quantity", value: event.target.value } })
          }
        />
      </label>
      <button type="submit">Move stock</button>
    </form>
  );
}

/** The open move editor, seeded from the clicked row. */
function MoveEditor(props: {
  readonly draft: {
    readonly id: string;
    readonly item: string;
    readonly from: string;
    readonly to: string;
    readonly quantity: string;
  };
}): ReactElement {
  const { draft } = props;
  const type = useRun(typeEditField);
  const save = useRun(submitEditSave);
  const discard = useRun(submitEditDiscard);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        save.run();
      }}
    >
      <label>
        Edit item
        <input
          value={draft.item}
          onChange={(event) => type.run({ input: { field: "item", value: event.target.value } })}
        />
      </label>
      <label>
        Edit from
        <input
          value={draft.from}
          onChange={(event) => type.run({ input: { field: "from", value: event.target.value } })}
        />
      </label>
      <label>
        Edit to
        <input
          value={draft.to}
          onChange={(event) => type.run({ input: { field: "to", value: event.target.value } })}
        />
      </label>
      <label>
        Edit quantity
        <input
          value={draft.quantity}
          onChange={(event) =>
            type.run({ input: { field: "quantity", value: event.target.value } })
          }
        />
      </label>
      <button type="submit">Save move</button>
      <button type="button" onClick={() => discard.run({ input: { id: draft.id } })}>
        Discard move
      </button>
    </form>
  );
}

/** Inner app: reads cells, runs operations, renders values only. */
function Desk(): ReactElement {
  const rows = useData(stock);
  const all = useData(moves);
  const draft = useData(editDraft);
  const editText = useData(editFormText);
  const filter = useData(listFilter);
  const alert = useData(notice);
  const open = useRun(openEditor);
  const undo = useRun(undoMove);
  const pick = useRun(chooseFilter);
  const shown = filter === "All" ? all : all.filter((m) => m.item === filter);
  return (
    <main>
      <MoveForm />
      <div role="alert">{alert === undefined ? "" : alert}</div>
      <table aria-label="Stock">
        <thead>
          <tr>
            <th>Item</th>
            <th>Place</th>
            <th>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StockRow key={`${row.item}-${row.place}`} row={row} />
          ))}
        </tbody>
      </table>
      <div>
        <button type="button" onClick={() => pick.run({ input: "All" })}>
          All
        </button>
        <button type="button" onClick={() => pick.run({ input: "Cable" })}>
          Cable
        </button>
        <button type="button" onClick={() => pick.run({ input: "Stand" })}>
          Stand
        </button>
      </div>
      <table aria-label="Moves">
        <thead>
          <tr>
            <th>Item</th>
            <th>From</th>
            <th>To</th>
            <th>Quantity</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((move) => (
            <MoveRow key={move.id} move={move} onEdit={(id) => open.run({ input: { id } })} />
          ))}
        </tbody>
      </table>
      {draft !== undefined && editText !== undefined ? <MoveEditor draft={editText} /> : undefined}
      <button type="button" onClick={() => undo.run()}>
        Undo
      </button>
    </main>
  );
}

/** One StockApp owns a fresh scope. Two roots share nothing. */
export function StockApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <Desk />
    </ScopeProvider>
  );
}
