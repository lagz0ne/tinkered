import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { Field, NamedTable, Notice, Page } from "./layout.tsx";
import { parcels } from "./model.ts";
import {
  chooseFilter,
  chooseParcel,
  notice,
  parcelChoices,
  parcelFilter,
  parcelRows,
  receiveDraft,
  storeDraft,
  submitCollect,
  submitReceive,
  submitReturn,
  submitStore,
  submitUndo,
  typeLocker,
  typeRecipient,
  typeSize,
} from "./screen.ts";
import type { ParcelFilter, ParcelRow } from "./screen.ts";

const filters: readonly ParcelFilter[] = ["All", "Held", "Stored", "Collected"];

/** The receive form: labeled Recipient and Size inputs and Receive. */
function ReceiveForm(): ReactElement {
  const draft = useData(receiveDraft);
  const recipient = useRun(typeRecipient);
  const size = useRun(typeSize);
  const submit = useRun(submitReceive);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
      }}
    >
      <Field
        name="Recipient"
        control={
          <input
            value={draft.recipient}
            onChange={(event) => recipient.run({ input: { value: event.target.value } })}
          />
        }
      />
      <Field
        name="Size"
        control={
          <input
            value={draft.size}
            onChange={(event) => size.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Receive</button>
    </form>
  );
}

/** The store form: labeled Parcel select, Locker input, and Store. */
function StoreForm(): ReactElement {
  const saved = useData(parcels);
  const draft = useData(storeDraft);
  const choose = useRun(chooseParcel);
  const locker = useRun(typeLocker);
  const submit = useRun(submitStore);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
      }}
    >
      <Field
        name="Parcel"
        control={
          <select
            value={draft.parcelId}
            onChange={(event) => choose.run({ input: { parcelId: event.target.value } })}
          >
            <option value="">Choose parcel</option>
            {parcelChoices(saved, draft.parcelId).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        }
      />
      <Field
        name="Locker"
        control={
          <input
            value={draft.locker}
            onChange={(event) => locker.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Store</button>
    </form>
  );
}

/** The buttons a stored parcel row has: Collect and Return. */
function RowButtons(props: { readonly row: ParcelRow }): ReactElement {
  const { row } = props;
  const collect = useRun(submitCollect);
  const back = useRun(submitReturn);
  const input = { parcelId: row.id };
  const name = `${row.recipient} from locker ${row.locker}`;
  return (
    <>
      <button type="button" onClick={() => collect.run({ input })}>
        Collect {name}
      </button>
      <button type="button" onClick={() => back.run({ input })}>
        Return {name}
      </button>
    </>
  );
}

/** The filter buttons and the Parcels table. */
function ParcelTable(): ReactElement {
  const saved = useData(parcels);
  const filter = useData(parcelFilter);
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
        name="Parcels"
        headers={["Recipient", "Size", "Locker", "State"]}
        rows={parcelRows(saved, filter).map((row) => ({
          key: row.id,
          cells: [row.recipient, row.size, row.locker ?? "None", row.state],
          actions: row.state === "Stored" ? <RowButtons row={row} /> : undefined,
        }))}
      />
    </>
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

/** One LockerApp owns a fresh scope. Two apps share nothing. */
export function LockerApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <Page>
        <ReceiveForm />
        <StoreForm />
        <NoticeBar />
        <ParcelTable />
      </Page>
    </ScopeProvider>
  );
}
