# Plain functions in the flight services

The list below may only shrink.
A plain function must be pure and have at least two call sites.
It takes at most three plain values.
Each value is the smallest piece the function needs.
Each parameter has a TSDoc line with its source and use.
No service has a class.
The package error registry also uses plain errors with a `kind` and payload.
Its `isError` guard follows the Start scaffold; it needs no error class.

Services live in the graph of tags, data, resources,
operations, and extensions.
The two `main.ts` files are process entry points.
Only those files create a service scope and own process signals.
Tests are entry points too.
Each test creates its own scope with tags and the app extension.
Tests use HTTP to drive and read each service.
There is no shared start helper.

Resources own the listeners, clock, waits, watchers,
and map of pending payment work.
Data holds plain settled state.
Operation input readers parse the wire input.
Wire types live next to the primitives that use them.
Callbacks inside a primitive are part of that primitive.
Process signal callbacks belong to their entry point.

The lead's mutation-lift instruction permits exported entry functions
when Stryker cannot follow child coverage.
Each `main` stays in its process entry file and returns an exit code.
This follows ADR 0078 and leaves the pure helper list at six.

## Process entries: `main`

- Payment `main(env: NodeJS.ProcessEnv)`:
  settings from the process environment or HTTP lifecycle fixture;
  needed to configure the root tags.
- Supplier `main(env: NodeJS.ProcessEnv, name: string | undefined)`:
  the same settings source and use;
  name from the process argument or lifecycle fixture;
  needed to choose the supplier stock.
- Call sites: each guarded process entry and the HTTP lifecycle fixture.
- These entries own IO, their scopes, process signals, and exit results
  under the user's explicit test fallback.

Core feedback: shared unit with a slot.
Each service repeats its dispatch operation and listener resource.
A plain builder must not take an operation handle.

## `http.ts`: `reply`

- `status: number`: chosen by the calling operation;
  sets the HTTP response code.
- `body: unknown`: plain JSON from the calling operation;
  supplies the response payload.
- Call sites: common controls, supplier operations,
  payment operations, and both error functions.

## `http.ts`: `reject`

- `code: string`: error choice from the calling operation;
  supplies the Duffel error code and title.
- `status: number`: HTTP choice from the calling operation;
  sets the response code, with 400 as the default.
- Call sites: common controls, supplier operations,
  and payment control operations.

## `supplier/index.ts`: `readCurrent`

- `offer: Supplier.Offer`: saved quote from booking or lookup;
  supplies the wire fields kept in the fresh quote.
- `amountCents: number`: matching stock fare from the operation;
  sets the current price.
- `seatsAvailable: number`: matching stock cabin from the operation;
  sets the current seat count.
- Call sites: `order.run` and `lookup.run`.

## `supplier/index.ts`: `createState`

- `offers: Flights.Offer[]`: plain fixture copies from the reader,
  or an empty initial list; supplies the stock.
- `scenario: string`: parsed control choice or the initial default;
  chooses the starting seat count.
- Call sites: `state.initial` and `resetScenario.run`.

## `payment/index.ts`: `createState`

- No parameters.
- Returns fresh plain empty payment state.
- Call sites: `state.initial` and `resetScenario.run`.

## `payment/index.ts`: `rejectPayment`

- `code: string`: error choice from the calling operation;
  supplies the Stripe error code and message.
- `status: number`: HTTP choice from the calling operation;
  sets the response code, with 400 as the default.
- `type: string`: Stripe error family from the calling operation;
  supplies the wire error type.
- Call sites: payment create, confirm, refund, webhook control,
  route, key handling, and listener operations.
