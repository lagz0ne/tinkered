# 0137 The client asks for a part; `invalidate` marks it dirty

Date: 2026-11-10. Status: accepted in part; not built.
Accepted: Duke, 2026-11-10 UTC: 15:20 (the model),
15:44 ("prepare to roll").
Closes: 0135 open items 1 (the server's first
value) and 3 (reconnect).

## What the user said

- 11:32: "Then we must have a way to check for
  dirtiness / latest?" and "Stale check".
- 14:15: "Do more in depth analysis before we dock
  to the solution".
- 15:20: "What if we simplify this by followng
  tanstack query, using the model of invalidation
  from client side. Delta or not it's all depending
  on protocol".

## Context

A part can come from a store, such as SQLite. Then
the client holds a copy of the store. A copy can be
stale. Six cases make it stale:

1. A write lands during the first load of a part.
2. The op fails after the store commit.
3. A second process writes the store and calls
   nothing.
4. The only reader leaves, a write occurs, the
   reader returns.
5. The server restarts, then the reader returns.
6. Two answers arrive in the wrong order.

A first design kept a version counter in the cell
and sent the missed steps to a reader that returns.
It was stale in all six cases. The cell is a copy,
so its counter is not the truth.

A second design kept the members of each part on
the server and compared them by key. It passed all
six cases. It keeps state on the server that the
model below does not need.

## Precedent

- **TanStack Query.** An invalidated query "is
  marked as stale". A query in use is "refetched
  in the background". A key matches by its prefix.
  A stale query is fetched again on mount, on
  window focus, and on reconnect.
- **TkDodo, WebSockets with React Query.** "I like
  to send events from the backend instead of
  complete data objects." The client invalidates
  on each event.
- **Replicache.** A poke: "zero-length messages
  that serve as a hint from server to clients that
  a space has changed". The client then pulls.
- **The outbox pattern.** A write adds a notice in
  the same transaction. One reader follows the
  notices. Hedl does this today.

Ours is simpler than TanStack Query: no stale
time, no retry rule, no cache time.

## Decision

1. The client's keyed cell is the cache. The server
   answers an ask for a part. It keeps no member of
   a part that comes from a store.
2. `invalidate(part)` on the client marks the part
   dirty and asks again.

   ```ts
   await run(api["tasks.ask"], input);
   await tasks.board.invalidate({ project });
   ```

3. The last ask wins. An answer is dropped when a
   later ask of that part has started.
4. A client that returns asks again. A server that
   restarts loses nothing. There is no version, no
   `since`, and no log of steps.
5. The answer can be all members or only the
   changes. That is the protocol's choice. The
   model does not change.
6. If a version is necessary later, it comes from
   the store, not from the cell.

## Told to Duke, no word yet

The cards use these as drafts.

- The server tells a second client. `invalidate`
  on the server sends a signal with no data to
  each reader of the part. In Hedl, the projector
  calls it after each commit.

  ```ts
  tasks.board.invalidate({ project, id });
  ```

- The first protocol: the signal names a key or a
  part, and the client asks for what it names. A
  full key is one member.
- `load` is the new name of `fill`. A board with
  no `load` serves its cell.
- A cell with no `load` is the truth. An op sets
  its member. The set marks that key dirty for its
  readers.

## Proof

A model in plain JavaScript, in the project files.
It is not Core. The store answers late, as an
awaited read does.

Six cases, for a second client:

- TanStack Query alone: stale in cases 1, 2, 3, 6.
- With the signal from the store: fresh in all six.

One write, five readers of a part of 301 members:

```text
answer        rows read   sent
all members       1,505   101,545 B
one member            5       670 B
server compares       1       435 B
```

"Server compares" is the second design. It keeps
301 members on the server. The two others keep
none.

## Options considered

- **A version in the cell, and `since`.** Stale in
  all six cases. Not chosen.
- **The server keeps the members and compares.**
  Correct. It keeps more state, and the op's answer
  can arrive before the change. Not chosen.
- **TanStack Query alone.** No signal: a second
  client is fresh only on focus or on return. Not
  enough for a live board.
- **The client asks, with a signal.** Chosen.

## Open

1. The key of a member: given at the write (0135),
   or read from the member, as TanStack DB `getKey`.
2. Order, for an "indexed" value (0135 open 2).
3. A protocol that sends only changes after a
   return. It needs keys in the store's log.
4. How long a part stays after its last reader
   leaves.

## Consequences

- The server keeps one table: which session reads
  which part. A signal goes only to a session that
  passed the guard for that part.
- A change takes two messages: the signal, then the
  ask.
- The client that wrote can wait for its own ask.
  So it reads its own write.
- Hedl's projector changes one line: it calls
  `invalidate` where it sends a full board today.
