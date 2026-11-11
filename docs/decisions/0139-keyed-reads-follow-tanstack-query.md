# 0139 Keyed reads follow TanStack Query

Date: 2026-11-11. Status: accepted in part; not built.
Accepted: Duke, 2026-11-11 05:03 UTC (points 2, 3, 4);
point 2 made clear at 05:06.
Changes: 0136 ("no order+limit").
Leaves open: the retry's end (point 1), and the
execution id (Duke picked "at the protocol level";
its scope is the next question).

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
   The read shape is the next design step.

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
   use asks again on `invalidate` (today), and after
   a time (a TTL). A refused part waits for the next
   trigger: it does not back off and ask again.

   The ask again is a plain ask: the whole part, as a
   page refresh. There is no version and no "same"
   answer, so ADR 0137 stands. A slow ask is the
   backend's to make fast.

## Open

- Point 1: the retry has an end and reads the fault
  kind. Duke gave no answer. TanStack retries 3
  times, then stays in `error`.
- The execution id: what it promises (read your
  write, or also a safe retry).
- The triggers in Core: focus and reconnect are
  browser facts, so they may belong to React.
- The default TTL. TanStack's `staleTime` is 0, and
  it refetches only on a trigger.
