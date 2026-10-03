import { useData, useRun, useResource } from "@tinker/react";
import { Link } from "@tanstack/react-router";
import {
  flightDraft,
  flightRows,
  flightProgress,
  flightNotice,
  editFlightDraft,
  findFlights,
} from "./flights.ts";
import { bookingNotice } from "./state.ts";
import { holdSeat, seatUpdates } from "./bookings.ts";
export function FlightsPage() {
  useResource(seatUpdates);
  const hold = useRun(holdSeat);
  const held = useData(bookingNotice);
  const draft = useData(flightDraft);
  const rows = useData(flightRows);
  const progress = useData(flightProgress);
  const notice = useData(flightNotice);
  const edit = useRun(editFlightDraft);
  const search = useRun(findFlights);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1>Flights</h1>
      <a href="/bookings">Bookings</a>
      <p role="alert">{held}</p>
      <Link to="/">Account</Link>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search.run();
        }}
      >
        <label>
          Origin
          <input
            aria-label="Origin"
            value={draft.origin}
            onChange={(event) => edit.run({ input: { ...draft, origin: event.target.value } })}
          />
        </label>
        <label>
          Destination
          <input
            aria-label="Destination"
            value={draft.destination}
            onChange={(event) => edit.run({ input: { ...draft, destination: event.target.value } })}
          />
        </label>
        <label>
          Departure date
          <input
            aria-label="Departure date"
            type="date"
            value={draft.date}
            onChange={(event) => edit.run({ input: { ...draft, date: event.target.value } })}
          />
        </label>
        <button>Search</button>
      </form>
      <p role="status">{notice}</p>
      {Object.entries(progress).map(([supplier, status]) => (
        <p key={supplier}>
          {supplier}: {status}
        </p>
      ))}
      {notice === "Search complete" && rows.length === 0 && <p>No flights</p>}
      <div className="overflow-x-auto">
        <table aria-label="Flights">
          <thead>
            <tr>
              {["Flight", "From", "To", "Departs", "Arrives", "Price", "Supplier", "Seats"].map(
                (name) => (
                  <th key={name}>{name}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.flight_id}>
                <td>{row.flight_id}</td>
                <td>{row.slices.at(0)!.origin.iata_code}</td>
                <td>{row.slices.at(0)!.destination.iata_code}</td>
                <td>{row.slices.at(0)!.segments.at(0)!.departing_at}</td>
                <td>{row.slices.at(0)!.segments.at(0)!.arriving_at}</td>
                <td>{row.total_amount} USD</td>
                <td>{row.supplier}</td>
                <td>{row.available_seats}</td>
                <td>
                  {row.available_seats === 0 ? (
                    "Sold out"
                  ) : (
                    <button onClick={() => hold.run({ input: row.id })}>
                      Hold {row.flight_id}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
