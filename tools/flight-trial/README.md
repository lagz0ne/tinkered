# Flight trial data

OpenFlights provides the airports, airlines, and routes.
The schedules, fares, seats, and suppliers are made up.
Routes stopped updating in June 2014.
See [the data license](data/LICENSE.md).

## Generate

Build Core and this package first.
From the workspace root:

```bash
./node_modules/.bin/vp run @tinker/core#build
./node_modules/.bin/vp run flight-trial#build
./node_modules/.bin/vp run flight-trial#generate
```

The default seed is 97.
Seed 97 produces the saved flight JSON bytes.
It gives the known flight its fixed fares, seats, and times.
Each supplier applies its exact markup and fee.
A seed is an integer from 0 through 4294967295.
The same seed writes the same JSON bytes; another seed changes them.
Compression bytes can differ across systems; JSON hashes are the proof.
The output is compressed JSON at `data/flights.json.gz`.
To write another file:

```bash
node tools/flight-trial/scripts/generate.mjs \
  98 tools/flight-trial/.logs/seed-98.json.gz
```

## Read

Import `readFlights` and `Flights` from `flight-trial`.
The reader loads the saved data once.
It can also read gzip bytes supplied by its caller:

```ts
import { readFile } from "node:fs/promises";
import { readFlights } from "flight-trial";

const path = "tools/flight-trial/data/flights.json.gz";
const reader = await readFlights(await readFile(path));
```

The reader borrows the bytes and keeps its own parsed data.
Corrupt gzip and JSON throw the named error `InvalidFlightData`.
Its payload has the file and reason.
Reasons for corrupt input are Invalid gzip and Invalid JSON.
Wrong-shaped data reports the field in that reason.
The reader rejects currency other than USD, missing flight data,
unknown supplier names in saved data, and unknown cabins or fare classes.
It rejects negative or fractional counts and prices,
nonpositive or fractional airline IDs, and seeds outside the 32 bit range.
It accepts zero counts and both seed bounds.
It rejects invalid dates and timestamps,
and airport codes with extra or lowercase letters.
It needs no network and no current clock.
Search with exact airport codes and UTC departure dates:

```ts
const reader = await readFlights();
const offers = reader.search({
  supplier: "supplier-a",
  origin: "LHR",
  destination: "JFK",
  date: "2027-01-15",
});
```

To seed a supplier service, read every offer it carries:

```ts
const supplierOffers = reader.offers("supplier-a");
```

Offers lists every flight the supplier carries.
Offers uses the same prices as search.
A known route returns only matching flights.
A route with no service returns no flights.
An unknown supplier returns no offers.
A supplier without matching airlines returns no offers.
The same flight appears at two suppliers with their own prices.
A nearly full flight has one to three seats in each cabin.
No flight lands before it leaves.
Changing an offer does not change later reads.
Each result is a deep copy owned by its caller.
Services may keep and change that copy.
The same flight starts with the same seats at both suppliers.
Each owner changes its own copy of the seats.
A hold at supplier A does not lower seats at supplier B.

`id` names the flight across suppliers.
`offerId` names the supplier's offer.
Seat stock belongs to the flight and cabin, shared by all fare classes.
Each cabin has saver, standard, and flex prices in USD cents.

## Fixed choices

- Dates: 2027-01-15 and 2027-01-16.
- Dates and times use UTC, not the airport's local time.
- Each airline route has one or two departures per day.
- Distance uses airport positions on a 6,371 km sphere.
- Duration uses 800 km per hour plus 30 minutes.
- Economy has 180 seats; business has 24.
- Every 47th flight has one to three seats left per cabin.
- Other cabins use 20 to 90 percent of seats, rounded down.
- Base fares use distance and a small seeded price change.
- Business costs 2.8 times economy before that change.
- Standard costs 1.2 times saver; flex costs 1.5 times saver.
- Supplier A adds 2 percent plus 100 cents.
- Supplier B adds 4.5 percent.
- Supplier C adds 1 percent plus 500 cents.
- Each airline is at two suppliers, by sorted airline ID.
- All kept airlines in the pinned source have two-character codes.
- Flight numbers repeat daily for the same route and departure slot.
- Flight numbers have one to four digits after the airline code.
- Flight numbers are unique per airline and date.
- Sorted routes each reserve two numbers, one per departure slot.

The source selection rule and source hashes are in `data/manifest.json`.
The subset keeps 60 airports with the most routes.
It keeps only nonstop routes without codeshares.
It keeps only airlines used by those routes.
Historical airline names and codes stay as supplied.

## Check

```bash
./node_modules/.bin/vp run flight-trial#test
./node_modules/.bin/vp run flight-trial#check:sources
node tools/flight-trial/scripts/check-seeds.mjs
```

The source check fetches the pinned files.
It checks their SHA-256 hashes and rebuilds the subset.
It checks the total saved data is less than 1,000,000 bytes.
The seed check writes two runs at seed 97 and one at seed 98.
It checks the JSON hashes and the saved default data.
The default JSON hash is saved in `data/manifest.json`.
The check hashes saved JSON after removing gzip compression.
Gzip hashes are printed for reference only.

## Start the services

Each supplier and payment run in their own process and Core scope.
State lives in Core data cells.
Resources own HTTP listeners and watchers.
Operations own calls, seat writes, and webhook sends.
Each process entry serves its settings and closes cleanly on SIGTERM.
Entry lifecycle tests cover real child processes and the exported entry functions.
The entry functions return exit codes.
Tags hold ports, supplier IDs, secrets, tokens, and short delays.

Build the workspace first.
Pull the images right before starting Compose:

```bash
./node_modules/.bin/vp run -r build
docker compose -f tools/flight-trial/compose.yml pull
docker compose -f tools/flight-trial/compose.yml \
  up -d --wait
./node_modules/.bin/vp run flight-trial#services
```

The start command prints one JSON line per ready service.
Each line has its service name, URL, and process ID.
Ctrl-C stops all four processes and closes their scopes.
If a child exits early, the parent stops the other children.

Default ports on the Docker host:

- Postgres: 55432; user and database: flight.
- Postgres password: flight-local-only.
- Mailpit SMTP: 51025; inbox HTTP: 58025.

Default ports for the four processes:

- Supplier A: 4311.
- Supplier B: 4312.
- Supplier C: 4313.
- Payment: 4314.

Set ports with `POSTGRES_PORT`, `SMTP_PORT`, `MAILPIT_PORT`,
`SUPPLIER_A_PORT`, `SUPPLIER_B_PORT`, `SUPPLIER_C_PORT`, and `PAYMENT_PORT`.
A service port of zero asks the OS for a free port.
Compose uses a named Postgres volume.
Both containers share its private network.
The host ports bind to the Docker host's loopback address.
A shell in another container reaches Mailpit on that private network.

The process settings are environment variables:

```text
HOST=127.0.0.1
CONTROL_TOKEN=flight-local-control
WEBHOOK_URL=http://127.0.0.1:4300/webhooks/stripe
WEBHOOK_SECRET=flight-local-secret
HOLD_MS=1000
WEBHOOK_DELAY_MS=20
```

These defaults serve local trials only.
Set `HOST=0.0.0.0` to serve another container on a private network.
Set the webhook URL to the trial app's receiver before starting payment.

## Supplier HTTP

The small wire shapes follow
[Duffel's offer requests](https://duffel.com/docs/api/v2/offer-requests)
and [orders](https://duffel.com/docs/api/v2/orders).
All supplier success replies put the result under `data`.
Prices are decimal strings in USD.
Each offer also has `flight_id`, `cabin_class`, `fare_class`, and `available_seats`.
A search makes a fresh offer ID and keeps its quoted price.
Expired offers are removed before the next service or control call.
Offer count and state bytes stay bounded across expired search batches.
The service keeps at most 65,536 live offers.
At that limit, a new search returns HTTP 429 `offer_limit_reached`.
It never removes a valid quote to admit a new search.
The grader can read both with `GET /control/state`.
Search returns data flights shared by suppliers A and B on LHR to AMS.
Each supplier starts with all stock from `offers(supplier)`.
Each supplier owns its own seat stock.
Fare classes share that supplier's flight and cabin stock.

Search uses one direct slice:

```text
POST /air/offer_requests
{
  "data": {
    "slices": [{
      "origin": "LHR",
      "destination": "AMS",
      "departure_date": "2027-01-15"
    }],
    "passengers": [{ "type": "adult" }],
    "cabin_class": "economy"
  }
}
```

The reply has `data.id` and `data.offers`.
Offer request IDs start with `orq_`.
Each offer has an ISO `expires_at`, 30 minutes from the service clock.
A quote still works after 200 further searches while it is valid.
At or after its deadline, booking or reading it returns HTTP 409
with Duffel-shaped `offer_expired`.
Its opaque ID keeps the deadline after its stored data is removed.
This follows [Duffel’s offer lifetime](https://duffel.com/docs/api/v2/offers)
and [expiry error](https://duffel.com/docs/api/overview/response-handling).
Economy is the default cabin.
One adult is the default passenger.
The trial counts every passenger as one seat.
Search accepts `adult`, `child`, and `infant_without_seat` passenger kinds.
Other passenger kinds return a named Duffel error.
The offers include saver, standard, and flex fares.
Search checks the route, date, cabin, and the whole group's seat count.
Each slice has one segment with departure and arrival times.
The segment gives the airline ID and a one-to-four-digit flight number.
The saved number includes the airline prefix; the HTTP number leaves it out.
This follows [Duffel's segment shape](https://duffel.com/docs/api/v2/offers).
Bad supplier requests return a named Duffel error.

Read a current quote with `GET /air/offers/:id`.
It returns the current price and seats.
An order still checks the original search price.
A price change makes a searched offer stale.
Changed prices cause `offer_price_changed`, with HTTP 409.
Sold-out cabins cause `offer_sold_out`, with HTTP 409.
The last seat goes to only one of two parallel orders.

Create an order with the returned offer ID:

```text
POST /air/orders
{
  "data": {
    "selected_offers": ["off_returned_by_search"],
    "type": "hold"
  }
}
```

`type` is `hold` or `instant`.
Orders take seats at once.
A business group pays its chosen fare for each passenger.
It uses only that cabin's seats.
Orders keep the selected offer, flight, cabin, and passenger count.
An order has `payment_status` with four fields:
`awaiting_payment`, `payment_required_by`, `paid_at`,
and `price_guarantee_expires_at`.
A hold starts with `awaiting_payment: true` and a deadline.
It expires at that time and frees its seats.
A business hold frees its own cabin when it expires.
An expired hold does not undo a later grader seat edit.
An instant order has `awaiting_payment: false` and `paid_at`.
Orders have no top-level `status` or `payment_required_by`.
Read either with `GET /air/orders/:id`.

Pay a hold with the order's exact total:

```text
POST /air/payments
{
  "data": {
    "order_id": "ord_returned_by_order",
    "payment": {
      "amount": "123.00",
      "currency": "USD",
      "type": "balance"
    }
  }
}
```

A paid hold keeps its seat after the hold time.
Only an unpaid hold can accept a payment.
A paid hold or instant order returns HTTP 409.
An expired hold cannot be paid.
Errors have Duffel's `errors: [{ type, code, title }]` shape.
The trial skips passenger identity checks and instant payment details.
It does not support order cancellation or multiple slices.

## Payment HTTP

The small shapes follow
[Stripe's PaymentIntents](https://docs.stripe.com/api/payment_intents).
Payment accepts JSON or form bodies.
Form bodies read nested bracket keys and booleans.
Form metadata keeps plain values and skips unsafe nested keys.
They keep metadata and automatic payment settings.
It returns Stripe objects directly, without a `data` wrapper.
Bad payment input and missing resources return Stripe errors.
Currency codes have three letters and are saved in lowercase.
A repeated confirmation keeps one delivery.
An intent key keeps its original reply after the intent changes.
Create an intent with whole cents:

```text
POST /v1/payment_intents
{ "amount": 12300, "currency": "usd" }
```

Confirm it with `POST /v1/payment_intents/:id/confirm` and `{}`.
Confirm returns `processing`.
A watcher on the intent data sends a webhook later.
A confirmation sends its webhook on real time before the grader sets a clock.
Success sends `payment_intent.succeeded`.
Failure sends `payment_intent.payment_failed`.
Read the current intent with `GET /v1/payment_intents/:id`.

Each webhook has a `Stripe-Signature` header.
It holds `t=<unix>,v1=<hex signature>`.
The signature is HMAC-SHA256 over `t.body`, with the shared secret.
The signature uses real time to meet Stripe's 300 second limit.
The event's `created` field uses the service clock.
Use the exact body bytes to check it.
The service logs each delivery status; zero means the HTTP send failed.
It makes no automatic retries.

Set `Idempotency-Key` on payment POST calls to make a call safe to repeat.
Parallel calls with one key return the same intent.
Later calls return the first reply for that key.
Reusing a key with a changed route or body returns HTTP 400.
Its error type is `idempotency_error`.
Replays have the header `Idempotent-Replayed: true`.
Keys stay until a scenario reset or process stop.
The trial compares the decoded body as JSON, including key order.

Refund a succeeded intent:

```text
POST /v1/refunds
{ "payment_intent": "pi_returned_by_create" }
```

An optional `amount` chooses a partial refund in cents.
Without it, the service refunds the remaining amount.
A refund key returns the same refund on repeat.
Partial refunds share the paid limit only with the same intent.
Total refunds cannot exceed the paid amount.
An unconfirmed or failed payment cannot be refunded.
Errors use `error: { type, code, message }`.
The trial does not model cards or bank accounts.

## Grader control HTTP

Every control call needs this header:

```text
Authorization: Bearer flight-local-control
```

Control uses its own `/control/` path prefix.
Service calls need no token on the private trial network.
Holds expire on real time before the grader sets a clock.
The test clock starts only when the grader chooses it.
Switch to it before starting timed work.
Advancing before setting a clock starts a test clock from real time.
Stopping a service ends its virtual waits and closes its HTTP port.
A scenario reset keeps the current clock.
It clears service state, route rules, and the call log.
A supplier scenario reset restores stock and clears quotes and orders.
A payment scenario reset clears intents, keys, route faults, and old deliveries.
The grader rejects bad flight, route, scenario, clock, and webhook plan changes.
Unknown intent IDs also fail.
The control operation writes a fresh plain scenario value.
The HTTP listener and its scope stay open.

All four services accept:

```text
POST /control/scenario
{ "name": "default" }

POST /control/clock
{ "now": 10000 }

POST /control/clock
{ "advanceMs": 500 }

POST /control/routes
{
  "route": "POST /air/offer_requests",
  "delayMs": 500,
  "status": 503,
  "repeat": 1
}

GET /control/calls
```

Route names are the HTTP method, a space, and the exact path.
A route delay uses that service's clock.
`status` injects a failure from 400 through 599.
An injected payment failure uses Stripe's error shape.
Omit `status` to run the route after the delay.
`repeat` replays that many calls after the first reply, without another action.
A repeated order reply takes no extra seats.
Setting a route again clears its saved reply.
The call log counts a delayed call before it ends and records its final status.
A call finishing after reset cannot return to the new call log.
A delayed call cannot restore a replaced or cleared route rule.
Parallel delayed calls consume only the chosen number of repeats.
Each call has its route, request start time, status, and `kind`.
The kind is `service`, `control`, or `webhook`.
For service and control calls, status zero means the call is still pending.
The log includes control calls and payment webhook sends.
Filter by service route to count app calls.
A control call without the grader token returns HTTP 401.

Supplier also accepts the `last-seat` scenario.
It gives every cabin one seat when the scenario starts.
The grader can change a loaded flight before its first search.
Set a price or seat count before or after search:

```text
POST /control/flights
{
  "flight_id": "1756-LHR-AMS-2027-01-15-1",
  "cabin_class": "economy",
  "fare_class": "saver",
  "amount_cents": 1,
  "seats": 1
}
```

Price changes affect the chosen fare class.
Seat changes affect the cabin and all its fares.
All stock is loaded before HTTP starts.
Stock changes keep fields they do not set.
The stock change reply echoes the accepted fields, including the default saver fare.
Unknown flight IDs return `flight_not_found`, with HTTP 404.

Payment also accepts the `payment-failed` scenario.
Choose the result and delivery plan before confirming an intent:

```text
POST /control/payment
{
  "outcome": "failed",
  "mode": "late",
  "delayMs": 1000
}
```

`outcome` is `succeeded` or `failed`.
`mode` is `now`, `late`, `twice`, or `never`.
`now` uses the configured 20 ms confirmation delay.
`late` uses `delayMs` instead.
A late webhook waits for the chosen time.
`twice` sends the same signed event twice.
`never` leaves the intent processing and sends no webhook.
A changed payment plan applies to the next confirmation.

To steer one existing intent:

```text
POST /control/webhooks
{
  "intent_id": "pi_returned_by_create",
  "mode": "now",
  "delayMs": 1000
}
```

This replaces that intent's pending webhook plan.
A manual `now` sends at once.
A manual `never` cancels the pending send.
Manual late and twice plans change only the chosen intent.
A failed outcome uses the default confirmation plan if no mode is given.
The grader can cancel a pending webhook and send it now later.
Already sent events stay in the log.

## Service proof

The tests use only HTTP after starting on free ports.
They never read service cells or call service operations.
They cover seat races, hold expiry, stale prices, signed webhooks,
safe repeats, late and twice delivery, controls, and refunds.

```bash
./node_modules/.bin/vp run flight-trial#test
node tools/flight-trial/scripts/check-services.mjs
node tools/flight-trial/scripts/check-mail.mjs
```

The process check uses free ports and proves four distinct process IDs.
The mail check sends through SMTP and reads Mailpit's inbox API.
It accepts `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_HOST`, and `MAILPIT_PORT`.
On this box, run its client on the Compose network:

```bash
docker pull node:24-alpine
docker run --rm -i --network flight-trial_default \
  -e SMTP_HOST=mailpit -e SMTP_PORT=1025 \
  -e MAILPIT_HOST=mailpit -e MAILPIT_PORT=8025 \
  node:24-alpine node --input-type=module \
  < tools/flight-trial/scripts/check-mail.mjs
```
