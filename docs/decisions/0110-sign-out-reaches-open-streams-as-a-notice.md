# 0110 Sign-out reaches open streams as a notice

Date: 2026-10-09. Status: accepted (user, 2026-10-09: "B: push notice").
Changes how a sync stream checks its account (`packages/start/src/parts/sync/stream.server.ts`).
Keeps the 30 s lease from the stalled-reader fix.

## Context

Today each open stream re-reads its account at every wake.
A wake comes from every saved event.
So one save costs one account read per open stream.

The case study measured it:

- 1,000 open streams: 1,000 account reads per saved event;
- about 1 s of CPU for each save.

The check also runs only when something is saved.
On a quiet app, a signed-out tab stays open until the next save or its lease.

The precedent is the user socket in Phoenix.
Each socket has an ID per user.
On sign-out, the server broadcasts `disconnect` to that ID only.
Rails Action Cable does the same with `remote_connections.where(...).disconnect`.

## Decision

- A stream reads its account once, when it opens. This is as today.
- A wake no longer re-reads the account. A save costs no account read.
- When a session ends or an account changes, the server sends one notice.
  - The notice names the account ID.
  - It goes on the same Postgres channel that carries wakes.
    LISTEN/NOTIFY reaches every server process.
- The one listener gives the notice only to that account's streams.
- Each of those streams re-reads its account.
  - It closes with the `account-change` frame if the account changed.
  - It stays open if its own session is still valid.
    One device's sign-out must not close another device's streams.
- The 30 s lease stays. A stream closes at its lease.
  The client opens it again, and the open reads the account.

What sends a notice:

- sign-out;
- a session revoked or deleted;
- a user deleted or banned;
- a role change.

The auth piece in `@tinker/start` owns these paths.
Each one gets a test that an open stream of that account closes.

## Consequences

- A save costs the same with 10 streams or 10,000.
- Sign-out takes effect at once, also on a quiet app.
- A path that forgets its notice is still caught within 30 s, by the lease.
- A session that expires on time sends no notice. The lease catches it.
  This is the same 30 s window we already accept for a stalled reader.
- The lease costs what it costs today: 1,000 streams ÷ 30 s,
  about 33 opens a second, spread out and not tied to saves.
- A new auth path that ends a session must send the notice.
  The ticket adds the list above to the Start README.

## Options considered

- **Keep the check at each wake (option A).**
  Simple, and it catches every change with no notice.
  But a save costs one read per open stream.
- **Lease only, no notice.** A save costs no read.
  But sign-out waits up to 30 s on every app.
- **Close every stream of the account on a notice.**
  No re-read, but a sign-out on one device closes the others.
