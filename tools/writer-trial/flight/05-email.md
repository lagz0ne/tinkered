# Round 5: send confirmation mail

Pass the scaffold checks, including `check:plain`.
Keep rounds 1 through 4 working.
A Confirmed booking sends one confirmation to the traveler's account email.
Use the real SMTP settings from `.env`:
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM.
Mailpit captures that email.
Do not send confirmation for a Held, expired, failed, or refunded booking.
Repeated payment webhooks send no extra email.

Use the subject `Flight booking <Booking>`.
The plain text has the booking ID, flight ID, supplier order ID,
supplier, held price in USD, and full UTC departure and arrival times.
Use the same saved values the Bookings table shows.

Add an Email column to the Bookings table.
Its values are Not sent, Sent, and Failed.
Keep every earlier column and state.
Sent means SMTP accepted the confirmation.
A failed send is a partial result: the booking is still Confirmed.
Show this text:
Booking confirmed; email failed. Retry email.
Show a button named `Retry email <Booking>`.
Other open tabs see the failure and the later retry result live.
A reload keeps both the booking and its mail state.

Retry sends the same confirmation to the same traveler.
It does not create a hold, take payment, pay the supplier, or refund.
Once it succeeds, show Sent and remove the retry button.
Another traveler cannot retry this booking's mail.

Expose this private route for safe repeats:

```text
POST /api/flights/email
{
  "executionId": "b031d4b0-2036-4fba-85c7-cde90db2b002",
  "bookingId": "e982f794-c4b2-49f0-b51c-6693a062af0d"
}
```

An anonymous request returns HTTP 401.
Another traveler's booking returns HTTP 403.
A repeat with the same execution ID sends no extra email.
Return a receipt with `executionId`.
Saved events carry the complete or partial result.
