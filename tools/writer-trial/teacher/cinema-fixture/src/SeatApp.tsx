import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
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
      <label>
        Row
        <input
          value={draft.row}
          onChange={(event) => row.run({ input: { value: event.target.value } })}
        />
      </label>
      <label>
        Number
        <input
          value={draft.number}
          onChange={(event) => number.run({ input: { value: event.target.value } })}
        />
      </label>
      <label>
        Customer
        <input
          value={draft.customer}
          onChange={(event) => customer.run({ input: { value: event.target.value } })}
        />
      </label>
      <button type="submit">Hold</button>
      <button type="button" onClick={() => buy.run()}>
        Buy
      </button>
    </form>
  );
}

/** The button one seat row has: Release for a held seat only. */
function RowButtons(props: { readonly line: SeatLine }): ReactElement | null {
  const { line } = props;
  const release = useRun(submitRelease);
  if (line.state !== "Held") return null;
  return (
    <button type="button" onClick={() => release.run({ input: { seatId: line.id } })}>
      Release {line.id}
    </button>
  );
}

/** One Seats row. */
function SeatRow(props: { readonly line: SeatLine }): ReactElement {
  const { line } = props;
  return (
    <tr>
      <td>{line.id}</td>
      <td>{line.state}</td>
      <td>{line.customer}</td>
      <td>
        <RowButtons line={line} />
      </td>
    </tr>
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
      <table aria-label="Seats">
        <thead>
          <tr>
            <th>Seat</th>
            <th>State</th>
            <th>Customer</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {seatLines(saved, filter).map((line) => (
            <SeatRow key={line.id} line={line} />
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

/** One SeatApp owns a fresh scope. Two apps share nothing. */
export function SeatApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <main>
        <SeatForm />
        <Notice />
        <SeatTable />
      </main>
    </ScopeProvider>
  );
}
