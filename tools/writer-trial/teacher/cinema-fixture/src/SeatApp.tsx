import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { Field, NamedTable, Notice, Page } from "./layout.tsx";
import { seats } from "./model.ts";
import {
  chooseFilter,
  notice,
  seatDraft,
  seatFilter,
  seatLines,
  submitBuy,
  submitHold,
  submitRelease,
  submitUndo,
  typeCustomer,
  typeNumber,
  typeRow,
} from "./screen.ts";
import type { SeatFilter, SeatLine } from "./screen.ts";

const filters: readonly SeatFilter[] = ["All", "Free", "Held", "Sold"];

/** The seat form: labeled Row, Number, and Customer inputs, Hold, and Buy. */
function SeatForm(): ReactElement {
  const draft = useData(seatDraft);
  const row = useRun(typeRow);
  const number = useRun(typeNumber);
  const customer = useRun(typeCustomer);
  const hold = useRun(submitHold);
  const buy = useRun(submitBuy);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        hold.run();
      }}
    >
      <Field
        name="Row"
        control={
          <input
            value={draft.row}
            onChange={(event) => row.run({ input: { value: event.target.value } })}
          />
        }
      />
      <Field
        name="Number"
        control={
          <input
            value={draft.number}
            onChange={(event) => number.run({ input: { value: event.target.value } })}
          />
        }
      />
      <Field
        name="Customer"
        control={
          <input
            value={draft.customer}
            onChange={(event) => customer.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Hold</button>
      <button type="button" onClick={() => buy.run()}>
        Buy
      </button>
    </form>
  );
}

/** The button a held seat row has: Release. */
function ReleaseButton(props: { readonly line: SeatLine }): ReactElement {
  const { line } = props;
  const release = useRun(submitRelease);
  return (
    <button type="button" onClick={() => release.run({ input: { seatId: line.id } })}>
      Release {line.id}
    </button>
  );
}

/** The filter buttons and the Seats table. */
function SeatTable(): ReactElement {
  const saved = useData(seats);
  const filter = useData(seatFilter);
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
        name="Seats"
        headers={["Seat", "State", "Customer"]}
        rows={seatLines(saved, filter).map((line) => ({
          key: line.id,
          cells: [line.id, line.state, line.customer],
          actions: line.state === "Held" ? <ReleaseButton line={line} /> : undefined,
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

/** One SeatApp owns a fresh scope. Two apps share nothing. */
export function SeatApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <Page>
        <SeatForm />
        <NoticeBar />
        <SeatTable />
      </Page>
    </ScopeProvider>
  );
}
