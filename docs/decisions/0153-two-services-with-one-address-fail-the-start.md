# 0153 Two services with one address fail the start

Date: 2026-11-13. Status: accepted (Duke, 14:50,
picked "A. Fail the start").
Changes: Duke's rule of 2026-11-06 04:21 ("a
duplicate address is allowed, as in Hono").
Keeps: ADR 0130 (a board has no name).

## What the user said

- Duke, 2026-11-06 04:21: a duplicate address is
  allowed, as in Hono. The first wins.
- Duke, 2026-11-07 07:10: "drop `name`; call it
  `remoteData`". So a board's address is its
  cell's name alone.
- Duke, 2026-11-13 14:14, on the open items of
  keyed data (this bug is one): "What should be
  next, address those".

## Context

acountee had two boards with a cell named `flows`.
A test on 0.21.1 shows what that does:

```ts
const approvals = remoteData({ flows: a });
const admin = remoteData({ flows: b });
memory.server({ services: [approvals, admin] });
// both serve the address "flows"
// client: admin.flows holds the approvals rows
```

- The first board won, as the rule says.
- The second board's client got the first
  board's rows. No fault, no error.
- The start warning named the winner
  `remoteData` and the loser `remoteData`.
  Nobody saw it.
- acountee renamed one cell to get past it.

The 6 Nov rule was made for routes, where the
loser is dead code. A board is different: its
loser still has a client that reads the address.

## Precedent

Routers split in two groups.

First match wins, no error:

- Hono, Express: routes are an ordered list.

A duplicate fails when the table is built:

- tRPC `mergeRouters`: throws `Duplicate key`.
- Fastify: `FST_ERR_DUPLICATED_ROUTE`.
- gRPC `addService`: throws "Method handler
  for … already provided".

Our table is a map from address to service, built
once at start. It is not an ordered list. So the
second group is the one we fit.

## Decision

1. **A duplicate address fails the start.** The
   server transport raises `DuplicateAddress`.
   `strict` is `true` by default, in `ws.server`
   and in the memory transport.
2. **The fault names both units.** A board gives
   its cell's label. A cell with no label, and an
   rpc, give the service's label.

```ts
// DuplicateAddress
{
  address: "flows",
  services: ["approvals.flows", "admin.flows"],
}
```

3. **`strict: false` is the old rule.** The first
   in the list wins, and the start logs a warning.
   The warning names the units the same way.

```ts
ws.server({ path: "/rpc", services, strict: false });
```

4. **The fix in an app is a rename.** Each cell
   name is one address on a link, across boards.
5. **No change on the wire.** No new API. A
   `Service` gains one optional field for the
   message, `names(address)`.

## Options not taken

Duke had the three on one card and took A.

- **B. Keep "first wins", name both cells in the
  warning.** Nothing fails. Data still mixes when
  nobody reads the log, as in acountee.
- **C. Name the board.**
  `remoteData("admin", { flows })` serves
  `admin.flows`. No clash by design. It brings
  back the name Duke dropped on 7 Nov, and it
  changes the wire.

## Consequences

- An app with a clash does not start after the
  upgrade. The error says which two units, so the
  fix is one rename.
- Checked on main, 2026-11-13: tinker-app, Hedl
  and the site have no clash.
- Size: 33 B gzip in the entry with rpc.
