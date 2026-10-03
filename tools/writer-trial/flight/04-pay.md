# Round 4: pay a hold

Pass the scaffold checks, including `check:plain`.
Keep rounds 1 through 3 working.
A signed-in traveler can pay a Held booking at `/bookings`.
Its button is named `Pay <Booking>`.
Only that traveler can pay that booking.
An expired hold takes no payment.

Add a Payment column to the Bookings table.
It shows the payment service's real intent ID, or a dash.
Keep every earlier column.
State can now also be Processing, Confirmed,
Payment failed, or Refunded.
A failed payment keeps the seat held until the supplier expires it.
It does not pay the supplier or confirm the booking.

Pay uses `PAYMENT_URL` from `.env`.
It charges the exact held USD price in whole cents.
A click, repeated request, or lost reply takes only one payment.
The service's create and confirm replies are not a final result.
Show Processing until the signed result arrives.
Do not poll the payment service for that result.

Receive payment events at `POST /webhooks/stripe`.
Check Stripe-Signature with `WEBHOOK_SECRET` from `.env`.
Use the exact request bytes and the signed timestamp.
Refuse a bad signature or a timestamp over five minutes old.
A refused event returns HTTP 400 and changes nothing.
An accepted event returns HTTP 200.
Repeated signed events take no extra payment or supplier payment.

A successful event pays the still-valid supplier hold.
The supplier payment body has this shape:

```json
{
  "data": {
    "order_id": "ord_from_the_hold",
    "payment": {
      "type": "balance",
      "amount": "123.00",
      "currency": "USD"
    }
  }
}
```

The order's `payment_status.paid_at` proves it was paid.
Then the booking shows Confirmed.
If the hold expired before success arrived, refund the full charge.
Show Refunded only after the payment service accepts that refund.
Take no supplier payment for that expired hold.
Repeated late events make only one refund.

Every open tab for this traveler sees the saved result live.
A reload keeps it.
Other travelers never see or pay this booking.

Expose this private route for safe repeats:

```text
POST /api/flights/pay
{
  "executionId": "b031d4b0-2036-4fba-85c7-cde90db2b001",
  "bookingId": "e982f794-c4b2-49f0-b51c-6693a062af0d"
}
```

A repeat with the same execution ID repeats no effects.
An anonymous request returns HTTP 401.
Another traveler's booking returns HTTP 403.
The route returns HTTP 200 for an allowed traveler,
also when nothing is charged.
It returns this receipt:

```json
{ "executionId": "b031d4b0-2036-4fba-85c7-cde90db2b001" }
```

The page's saved events carry its result.
