# Flight service HTTP contracts

## Supplier HTTP

The small wire shapes follow
[Duffel's offer requests](https://duffel.com/docs/api/v2/offer-requests)
and [orders](https://duffel.com/docs/api/v2/orders).
All supplier success replies put the result under `data`.
Prices are decimal strings in USD.
Each offer also has `flight_id`, `cabin_class`, `fare_class`, and `available_seats`.
A search makes a fresh offer ID and keeps its quoted price.
The service keeps the newest 1,024 offers.
Older offer IDs return HTTP 404.
Stored offer count and state bytes stay bounded after many searches.
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
Economy is the default cabin.
One adult is the default passenger.
The trial counts every passenger as one seat.
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
