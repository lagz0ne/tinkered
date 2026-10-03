# Round 3: hold a seat

Keep rounds 1 and 2 working.
A visitor can search, but must sign in before holding a seat.
Keep the scaffold's account page at `/`.
Keep Make an account, Name, Email, Password, Make account,
Sign in, and Your account as the account page's text.

Each Flights row gains a button named `Hold <Flight>`.
An anonymous hold shows Sign in required and takes no seat.
A signed-in traveler holds one seat in the row's cabin and fare.
The hold must be the chosen supplier's order with `type: hold`.
Read the current offer before asking for the hold.
If its price changed, show Price changed and take no seat.
The traveler can search again to see and accept the new price.
If it has no seat left, show Sold out and take no seat.

The hold lasts until the supplier's `payment_status.payment_required_by` time.
Show that full UTC time, with no local time conversion.
The supplier decides whether a hold is still valid.
An expired hold is shown as Expired and cannot be used for payment.
A search never places a hold by itself.

The signed-in traveler has a page at `/bookings`.
Show a table named Bookings with these columns:
Booking, Flight, Supplier, Price, State, Expires, and Order.
Booking is the app's saved booking ID.
Order is the supplier's real order ID.
State is Held or Expired in this round.
Price is the held decimal amount followed by USD.
The page shows only this traveler's bookings.
A new tab and a page reload keep those same saved holds.
An anonymous visit to this page shows Sign in required.

Two travelers can try to hold the last seat at once.
Only one gets a Held booking.
The other sees Sold out.
Other open results for that supplier, flight, and cabin show
Sold out within five seconds, without a click or reload.
Keep the numeric Seats column; a sold-out row has Seats 0.
A supplier's seat stock is separate from the other suppliers' stock.
Do not replace the chosen supplier during a hold.

The order's `payment_status` also has `awaiting_payment`,
`paid_at`, and `price_guarantee_expires_at`.
A hold awaits payment and has no paid time.
An expired hold no longer awaits payment and has no paid time.
A paid order has a paid time.
There is no order `status` field.
