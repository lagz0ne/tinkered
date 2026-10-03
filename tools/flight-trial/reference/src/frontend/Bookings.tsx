import { useData, useResource, useRun } from "@tinker/react";
import { holdUpdates, payHold } from "./bookings.ts";
import { profile, bookingRows } from "./state.ts";
export function BookingsPage() {
  const pay = useRun(payHold);
  const account = useData(profile);
  const rows = useData(bookingRows);
  useResource(holdUpdates);
  if (!account)
    return (
      <main>
        <h1>Bookings</h1>
        <p>Sign in required</p>
      </main>
    );
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1>Bookings</h1>
      <a href="/flights">Search flights</a>
      <div className="overflow-x-auto">
        <table aria-label="Bookings">
          <thead>
            <tr>
              {[
                "Booking",
                "Flight",
                "Supplier",
                "Price",
                "State",
                "Expires",
                "Order",
                "Payment",
                "Action",
              ].map((name) => (
                <th key={name}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.offer.flight_id}</td>
                <td>{row.offer.supplier}</td>
                <td>{row.price} USD</td>
                <td>{row.state}</td>
                <td>{row.expires}</td>
                <td>{row.orderId}</td>
                <td>{row.paymentId ?? "-"}</td>
                <td>
                  {row.state === "Held" && (
                    <button onClick={() => pay.run({ input: row.id })}>Pay {row.id}</button>
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
