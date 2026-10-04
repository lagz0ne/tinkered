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
The routing tests share their setup in `beforeEach`.
Tests use HTTP to drive and read each service.
There is no shared start helper.

Each HTTP call checks quote and hold deadlines before it reads or edits state.
No separate supplier timer or watcher repeats that work.
Resources own the listeners, clock, waits, payment watchers,
and map of pending payment work.
Data holds plain settled state.
Hono validates wire bodies and unwraps them before running an operation.
Operations take plain params and return domain values.
They raise one managed error kind for each domain failure.
Each service binds one map from error kinds to wire replies.
Hono settles the call, then maps status, headers, and the envelope.
Wire types live next to the primitives that use them.
Callbacks inside a primitive are part of that primitive.
Process signal callbacks belong to their entry point.

The lead's mutation-lift instruction permits exported entry functions
when Stryker cannot follow child coverage.
Each `main` stays in its process entry file and returns an exit code.
This follows ADR 0078 and leaves the pure helper list at three.

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
The shared listener resource serves one Hono app per service.
Each service binds an error-shape tag in one owned session.
Its start hook borrows the shared HTTP extension hook.
That one hook binds the scope through Hono middleware.
It registers the token check before body decoding and rule waits.
The shared control-route resource registers clock, calls, and route-rule paths once.
The supplier resolves it after registering its deadline check.
Each handler reads only its values and runs one operation.
Common middleware runs separate operations to start and save calls and rules.
Those operations keep protocol facts supplied by Hono.
The call log records status zero until a call finishes.
Saved route replies and payment key replies are owned wire snapshots.
Operations select replay facts; Hono reads and sends the saved snapshot.
Payment intent status is domain state, not an HTTP response code.
Body decoding runs in `decodeBody`.
One resource callback writes JSON and sets the content type.
Its error map also keeps payment control failures in Duffel shape.
The signed webhook client owns the Stripe body, signature, and wire log.
The delivery operation runs `httpRequest` once per event copy.
It maps each reply to `delivered`, `rejected`, or `unreachable`.
The log keeps that outcome; its wire view keeps the exact old status.
The HTTP resource wraps built-in fetch through `httpBackend`.
The payment close hook stops it before Core drains running operations.
The resource also aborts on cleanup and caller cancellation.
The service error guard narrows `HttpRequestFailed` by kind.
Payment keys have separate start and save operations.
Their middleware always resolves or deletes a pending key in `finally`.
The listener tracks response completion before closing all connections.
It aborts an unfinished incoming body on the stop signal.
No operation takes a whole request or chooses work by route name.

## `supplier/index.ts`: `readCurrent`

- `offer: Supplier.Offer`: saved quote from booking or lookup;
  supplies the wire fields kept in the fresh quote.
- `amountCents: number`: matching stock fare from the operation;
  sets the current price.
- `seatsAvailable: number`: matching stock cabin from the operation;
  sets the current seat count.
- Call sites: `order.run` and `readOffer.run`.

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

## Protocol checks

Hono validates form fields before payment operations see their params.
Supplier operations take booking params and return plain domain values.
Call logs and route rules keep raw percent-encoded paths.
An empty supplier offer ID returns `offer_not_found`.
A thrown handler keeps its call-log status at zero.
A thrown handler cannot seed a route replay.
A thrown payment handler frees its key so the same key can retry.
The wire check compares all routes and each error code with the old code.
