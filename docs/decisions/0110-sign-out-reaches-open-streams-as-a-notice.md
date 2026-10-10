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
- Heartbeats read no account. A stream reads its account at open,
  and again only after a notice for that account.
- A sign-in sends no notice. An anonymous stream learns its
  account at its lease.

What sends a notice:

- sign-out;
- a session revoked or deleted;
- a user deleted;
- a user banned: no path yet, the scaffold has no ban field;
- a role change: no path yet, the scaffold has no role field.

The scaffold's auth sends the notice.
Its better-auth config has one hook, `session.delete.after`.
better-auth deletes sessions through that hook for sign-out,
a revoked or deleted session, and a deleted user.
`apps/start-scaffold/tests/revocation.test.ts` closes an open stream
for each of those paths.
A path that adds a ban or a role sends `accountNotice(id)`,
and gets its own test.

## Consequences

- A save costs the same with 10 streams or 10,000.
- Sign-out takes effect at once, also on a quiet app.
- A path that forgets its notice is still caught within 30 s, by the lease.
- A session that expires on time sends no notice. The lease catches it.
  This is the same 30 s window we already accept for a stalled reader.
- The lease costs what it costs today: 1,000 streams ÷ 30 s,
  about 33 opens a second, spread out and not tied to saves.
- A new auth path that ends a session must send the notice.
  The list above, with the paths that have none, is in the Start README.
- A role change keeps the account ID, so the ID check alone would not
  close a stream on a role change. A role path needs its own rule for
  what closes the stream, before it sends its notice.
- The `sync_session_changed` trigger is dropped
  (migration `20261010090000_drop_session_wake`).
  A session change used to wake streams only so they re-read the account.
  The notice does that now.

## Options considered

- **Keep the check at each wake (option A).**
  Simple, and it catches every change with no notice.
  But a save costs one read per open stream.
- **Lease only, no notice.** A save costs no read.
  But sign-out waits up to 30 s on every app.
- **Close every stream of the account on a notice.**
  No re-read, but a sign-out on one device closes the others.
