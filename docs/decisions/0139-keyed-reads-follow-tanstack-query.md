# 0139 Keyed reads follow TanStack Query

Date: 2026-11-11. Status: accepted; not built.
Accepted: Duke, 2026-11-11 05:03 UTC (points 2, 3, 4);
point 2 made clear at 05:06 and 05:07.
Settled at 05:18, by the rule he named: decisions 4
and 5, and the defaults in 3. Duke asked for this
round ("refined the issue ... where the final
decision can make"); he reads it on the page and can
change it.
Changes: 0136 ("no order+limit").
The goal and the protocol: ADR 0140.

## What the user said

The issue board thread showed four ways TanStack
Query handles the open problems. Duke answered:

- "2. assume the check for stale can be cheap (for
  example accessing from cache) and it doesn't cause
  a lot of issue, then ttl, or time to revalidate is
  quite reasonable".
- "3. yes".
- "4. yes".
- "so, the commonsense is rely on how known library
  that alreayd solve this problem for very long time
  already".
- 05:06: "not a cheap check, the assumption is
  retrieving again is cheap, just as cheap as a
  refreshing the page and nothing we should do about
  that, build a faster backend".
- 05:07: "if the stale check one to have a version
  check, the cheapest one is using time of last
  retrieval, and server just need to determine and
  return either full (stale) or delta".

- 05:08, the goal over all of it: "the goal is the
  library can be used on each side independently
  (because, well', that's actually will run
  independently) and the protocol must be solid to
  make sure it works as such for long".

## Context

The issue board and Hedl found these gaps on 0.17:

- A refused part is asked again with back-off, up to
  every 5 s, while the tab is open.
- Faults are per key, so one refused part marks every
  reader of the cell.
- `of(key)` gives `undefined` before the first answer
  and when there is no member.
- A board lane needs order. Hedl's Tasks panel needs
  "the newest 50". ADR 0136 had no order and no limit.

## Precedent

TanStack Query, the rule Duke named:

- `queryKey` holds every argument of the read.
- Each key has its own `status` and `error`.
- A query refetches on focus, on reconnect, on
  `invalidateQueries`, and after `staleTime` or on
  `refetchInterval`.
- `retry` has an end (3 by default), then the query
  stays in `error` until a trigger.

## Decisions

1. **State per read (point 3).** A part has its own
   state: not read yet, ready, or a fault. The page
   tells "not read yet" from "nothing there".

   ```ts
   const p = useData(board.tasks.where(part));
   // p.status: "pending" | "ready" | "fault"
   ```

   This closes "faults per part" (Hedl H4) and
   "not read yet" (Hedl H5, issue board).
   The read shape is a design step, not a question.

2. **The read's arguments are the key (point 4).**
   Order and limit are arguments of the read. The
   store sorts and cuts. A change in the window asks
   the window again. This changes ADR 0136.

   ```ts
   board.tasks.where(
     { project },
     { order: "-created", limit: 50 },
   );
   ```

   The shape above is a sketch, not a decision.
   It unblocks the design of k07.

3. **Ask again on a trigger (point 2).** A part in
   use asks again on `invalidate`, and after a time
   when the board sets one. With no time set, there
   is no timer: TanStack's `refetchInterval` is off
   by default.

   ```ts
   issues.board({ read: ws.client, revalidate: 30_000 });
   ```

   The name `revalidate` is a sketch.

   The ask again is a plain ask: the whole part, as a
   page refresh. There is no version and no "same"
   answer, so ADR 0137 stands. A slow ask is the
   backend's to make fast.

   If a check is added later, it is the cheapest one
   (Duke, 05:07): the ask carries the time of the last
   answer, and the server answers the full part or a
   delta. This is HTTP `If-Modified-Since`. The time
   is the server's value, sent back; a delete it
   cannot show gives the full part. Only the backend
   changes, not the client's code.

   Focus and reconnect are not triggers in Core.
   A link that comes back is the backend's fact: its
   `watch` says "all dirty" when it opens again.
   Focus is the browser's fact: an app that wants it
   calls `invalidate`.

4. **A fault that is an answer ends the asking
   (point 1).** `refused` and `invalid` are the
   server's answer: the same ask gives the same
   fault. The part goes to `fault` and waits for a
   trigger (3). Core does not ask again by itself.

   A broken link is not an answer. The backend heals
   it, in its own way (ADR 0140). The part shows
   `link` until then.

   ```ts
   // a page's "Try again"
   run(board.invalidate, { input: { issues: part } });
   ```

   Precedent: TanStack's `retry` reads the error and
   has an end. EventSource connects again on a
   network error and stops on an HTTP error.
   Patch 0001 of the issue board shows it on 0.17:
   3 joins in 400 ms before, 1 after.

5. **A guard reads its part, typed, from the
   board.** One call for every keyed cell of the
   board, because one guard guards the board.

   ```ts
   const teamId = board.part(input)?.teamId;
   ```

   The wire already parses the part. This adds the
   type, from the cell's key, and no second parse.
   It closes the card `core/keyed-guard-part`
   (patch 0002 of the issue board, with its test).
   Precedent: a tRPC middleware gets the parsed
   input.

## Closed with no change to Core

- **A call's write is lost.** `cell.controller`
  writes the call's own layer. To keep the write,
  the op names the root: `cell.atScope.controller`
  (ADR 0126), or the board serves the cell. The
  template README says so. No warning is built.
- **No all-or-nothing across two cells.** The rule:
  check first, write last, with no `await` between
  the writes. With a store, the store's transaction
  does it. TanStack Query has no transaction either:
  it asks the server again. No Core transaction.
- **The cause of `failed` is not in the tab.** By
  design. The fault carries a ref, and the cause is
  in the server's trace under that ref. The issue
  board shows the ref (tinker-app 4bb6416).

## Open

- The execution id: ADR 0140.

## Next, in this order

1. A part's state, and the fault rule (1, 4).
2. `board.part(call)` (5).
3. Order and limit, then k07 (2).
4. The time to ask again (3).
