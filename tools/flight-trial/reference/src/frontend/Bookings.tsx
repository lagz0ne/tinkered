import { useData, useRun } from "@tinker/react";
import { payHold, retryConfirmation } from "./bookings.ts";
import { profile, bookingRows, bookingNotice } from "./state.ts";
export function BookingsPage() {
  const retry = useRun(retryConfirmation);
  const notice = useData(bookingNotice);
  const pay = useRun(payHold);
  const account = useData(profile);
  const rows = useData(bookingRows);
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
      <p role="alert">
        {rows.some((row) => row.emailState === "Failed")
          ? "Booking confirmed; email failed. Retry email."
          : notice}
      </p>
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
                "Email",
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
                <td>{row.emailState}</td>
                <td>
                  {row.state === "Confirmed" && row.emailState === "Failed" && (
                    <button onClick={() => retry.run({ input: row.id })}>
                      Retry email {row.id}
                    </button>
                  )}
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
