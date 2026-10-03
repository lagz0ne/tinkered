# Round 1: search

Build a public flight search page at `/flights`.
Keep the scaffold's account page at `/`.
A visitor needs no account to search.

The form has text inputs named Origin and Destination.
They accept uppercase three-letter airport codes.
Departure date is a date input.
Start with LHR, AMS, and 2027-01-15.
A button named Search starts the search.
This round asks supplier A only, using `SUPPLIER_A_URL`.
Search for one adult in economy.
Show saver fares only.
One click asks that supplier once.

Show a table named Flights.
Its columns are Flight, From, To, Departs, Arrives, Price,
Supplier, and Seats.
Flight is the service's `flight_id`, shared across suppliers.
From and To are airport codes.
Departs and Arrives show the service's UTC timestamps.
Price is the service's decimal amount followed by USD.
Supplier is `supplier-a`.
Seats is the current seat count.
Show every returned saver fare once, in price order, lowest first.
A tie sorts by Flight, then Supplier.

While searching, show Searching.
When the supplier has answered, show Search complete.
If there are no flights, show No flights.
A failed supplier shows `supplier-a: failed`.
Keep the form usable after a failure.
A later search replaces the earlier rows and notices.
LHR to AMS on 2027-01-15 has flights.
An unknown but well-formed route has none.
Never show flights from a previous route as the new result.

Keep the layout usable on a phone.
Test the page and the supplier HTTP calls.
Run build, check, and tests before reporting done.
