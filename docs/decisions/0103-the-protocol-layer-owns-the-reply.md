# 0103 The protocol layer owns the reply

Date: 2026-10-04. Status: accepted. Refines: 0101. Uses: 0067.

## Context

ADR 0101 moved routing to the framework.
But the flight-trial services still let operations speak HTTP.
They take the whole wire body (`{ data: { selected_offers } }`),
return `reply(201, { data: order })`, and pick status codes
with `reject("offer_sold_out", 409)`.

The user ruled: the reply is protocol, like the route and the headers.
What comes in and what goes out are handled at the same layer.
Tinker does not say how a result is shown on the wire.

## Precedent

Effect's `HttpApi`: an endpoint declares its payload schema,
its success status, and each error with its status, at the API layer.
The handler returns a plain value or fails with a typed error.

Go's `net/http`: the service returns `(value, error)`;
the handler maps `errors.Is(err, ErrNotFound)` to `404`.

Where we are simpler: no endpoint DSL.
A Hono handler or a Start route maps by hand, in one place per service.

## Decision

Both directions belong to the protocol layer (Hono, TanStack Start):

- **In:** route, params, headers, and the wire envelope.
  The handler reads `body.data.selected_offers[0]` and validates the wire shape.
  The operation gets only its params: `{ offerId, passengers, type }`.
- **Out:** status, headers, and the wire envelope.
  The operation returns a plain value or raises a managed error (ADR 0067).
  The handler maps the value to `201 { data: order }`
  and each error kind to its status and wire error body.

```ts
// protocol layer: one place per service
http.post("/air/orders", async (c) => {
  const { selected_offers, passengers, type } = c.req.valid("json").data;
  const result = await c.var.scope.settle(order, {
    input: { offerId: selected_offers[0], passengers: passengers.length, type },
  });
  if (result.status === "success") return c.json({ data: result.value }, 201);
  return wireError(c, result.error); // kind -> status + Duffel error body
});

// Tinker: domain only
const order = operation({
  input: orderInput, // { offerId, passengers, type }
  depends: { state: state.controller, holdMs, clock },
  run: ({ state, holdMs, clock }, { input }) => {
    if (soldOut) raise("OfferSoldOut", { offerId: input.offerId });
    return booked; // a Supplier.Order, no status, no envelope
  },
});
```

No operation returns a status code, a header, or a wire envelope.
No operation reads a wire envelope.
The outgoing side mirrors this: an operation that calls another service
maps that service's HTTP reply to domain values or managed errors,
so its callers never see a status code.

## Consequences

- `reply`, `reject`, and `rejectPayment` go: three fewer plain functions.
- The error-to-status table is one readable map per service.
- Wire validation moves to the framework,
  which closes the core-feedback row "Bad input as a wire reply"
  for these services: the operation's input reader sees only valid params.
- The Start scaffold puts telemetry headers, body checks, and replies in its route.
- Its sync route reads the cursor and builds the SSE reply.

## Named protocol exception

`handleAuth` in `src/scaffold/backend/auth.server.ts` mounts better-auth.
That third-party handler owns its Request and Response contract.
This is protocol code, called only by the auth route and proof tests.
Keeping its operation lets the route settle failures through Core.
It also keeps auth mail work under the mounted call.
No feature operation may use this exception.
The plain check allows only that exact file and declaration name.

Raw request headers live in the scaffold's request wiring.
The app backend, server seam, and protocol entry do not export them.
Only the testing entry exports the header tag for proof bindings.
The plain check bans its use outside the scaffold and src/backend/auth.ts.
The mounted auth handler is absent from the public transport entry.
The plain check permits its use only in the auth route and its own file.
Tests use the testing entry.
App operations use principal or currentUser.
