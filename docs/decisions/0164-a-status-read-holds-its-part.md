# 0164 A status read holds its part

Date: 2026-11-20. Status: accepted (Duke,
2026-11-20, option B).
Amends: ADR 0139 decision 1 ("`undefined` when no
reader holds it").

## What the user said

- 2026-11-20 04:25 UTC: "I do like B ... I just
  want us to have an in depth look to see if
  that's actually fix the issue".
- The in-depth look is the scratch proof,
  `/home/paseo/cuj10/STATUS-HOLDS.md`. Its table
  is the evidence for this decision.

## Context

A keyed part of a `remoteData` board is asked of
the server only while a reader holds it:
`useData(part)`, or a scope `watch` of the part.

`board.status(read)` reads a separate cell, the
board's `states`. So it is not a reader.

Run 10 of the CUJ found the cost. muse-h-4's
`Thread` reads only `useData(board.status(part))`.
It mounts the part's reader only after `ready`.
Nothing holds the part, so `ready` never comes:
the thread says "loading" for ever.

- `app/src/issues/board.tsx:479-512` (`Thread`);
- `:431` (`ThreadBody`, the late reader);
- 2 of 22 hidden journeys fail.

No skill said that a status read is not a reader.
The README hinted at it, in one line.

## Precedent

TanStack Query, the model ADR 0139 follows:

- `useQuery` makes an observer. An observer holds
  its query and fetches it. Its `status` comes
  from the same observer.
- There is no status without an observer. A page
  that shows a query's status has made the
  query's observer, so the query runs.
- A passive look is a separate tool:
  `queryClient.getQueryState(key)` reads the
  state and starts nothing.

Tinker keeps the same split, simpler:

- a watch of `board.status(read)` is an observer;
- `get()` of it is the passive look;
- no caller needs a passive watch, so there is
  none.

## Decision

1. **A status watch holds the part.** A watch of
   `board.status(read)` counts as a reader of
   `read`'s part, as `useData(read)` does.
   - The first holder joins the part and asks.
   - A status watch and a value watch of one part
     share one join and one ask.
   - The part leaves when its last holder leaves,
     status or value.
   - Every rule of a held part stays: a refused
     part waits for a trigger (ADR 0139 4); a
     broken link heals by itself (ADR 0141).
2. **`get()` is a peek.** A `get()` of the status
   holds nothing and starts nothing.
3. **What a status watcher sees.** Before any hold,
   the status is `undefined`. React's first render
   reads it so: the hold starts when React
   subscribes, after that render. A watcher then
   hears `pending`, then `ready` or `fault`.
4. **No new API.** No option, no new name. The
   change is in what a watch of the status means.

```tsx
const part = board.comments.where({ issueId });
const state = useData(board.status(part));
if (state?.status !== "ready") return <Loading />;
return <Comments part={part} />;
```

This page now loads: the status watch asks.

## Amends

ADR 0139 decision 1 gave a part's state as
"`undefined` when no reader holds it". A status
watcher is now one of the readers that hold it.

## Proof

The scratch proof scored nine app trees with
main's Core and with B, by the run 10 scorer:

- muse-h-4: 20/22 on main, 22/22 with B, its code
  unchanged.
- The other eight trees: the same score on both.

## Consequences

- A page that watches a status and never the
  value now asks the server, and keeps the part's
  stream open while it watches.
- A status watch in a parent keeps a part alive
  after a child's value reader leaves.
- In the code read for the proof, every status
  watch sat beside a value read of the same part,
  except muse-h-4's `Thread`. So no new asks.
