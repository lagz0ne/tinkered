import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { Field, NamedTable, Notice, Page } from "./layout.tsx";
import { editDraft, moves, stock, undoMove } from "./model.ts";
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
      <Field
        name="Item"
        control={
          <input
            value={form.item}
            onChange={(event) => type.run({ input: { field: "item", value: event.target.value } })}
          />
        }
      />
      <Field
        name="From"
        control={
          <input
            value={form.from}
            onChange={(event) => type.run({ input: { field: "from", value: event.target.value } })}
          />
        }
      />
      <Field
        name="To"
        control={
          <input
            value={form.to}
            onChange={(event) => type.run({ input: { field: "to", value: event.target.value } })}
          />
        }
      />
      <Field
        name="Quantity"
        control={
          <input
            value={form.quantity}
            onChange={(event) =>
              type.run({ input: { field: "quantity", value: event.target.value } })
            }
          />
        }
      />
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
      <Field
        name="Edit item"
        control={
          <input
            value={draft.item}
            onChange={(event) => type.run({ input: { field: "item", value: event.target.value } })}
          />
        }
      />
      <Field
        name="Edit from"
        control={
          <input
            value={draft.from}
            onChange={(event) => type.run({ input: { field: "from", value: event.target.value } })}
          />
        }
      />
      <Field
        name="Edit to"
        control={
          <input
            value={draft.to}
            onChange={(event) => type.run({ input: { field: "to", value: event.target.value } })}
          />
        }
      />
      <Field
        name="Edit quantity"
        control={
          <input
            value={draft.quantity}
            onChange={(event) =>
              type.run({ input: { field: "quantity", value: event.target.value } })
            }
          />
        }
      />
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
    <Page>
      <MoveForm />
      <Notice text={alert} />
      <NamedTable
        name="Stock"
        headers={["Item", "Place", "Quantity"]}
        rows={rows.map((row) => ({
          key: `${row.item}-${row.place}`,
          cells: [row.item, row.place, row.quantity],
        }))}
      />
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
      <NamedTable
        name="Moves"
        headers={["Item", "From", "To", "Quantity"]}
        rows={shown.map((move) => ({
          key: move.id,
          cells: [move.item, move.from, move.to, move.quantity],
          actions: (
            <button type="button" onClick={() => open.run({ input: { id: move.id } })}>
              Edit move
            </button>
          ),
        }))}
      />
      {draft !== undefined && editText !== undefined ? <MoveEditor draft={editText} /> : undefined}
      <button type="button" onClick={() => undo.run()}>
        Undo
      </button>
    </Page>
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
