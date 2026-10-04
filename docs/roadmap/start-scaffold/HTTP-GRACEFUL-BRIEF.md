# HTTP graceful close brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read ADR 0028, 0085, 0100, and 0102.

## Goal

A graceful root or session close never hangs on an outgoing HTTP request.

## Found by

The `trial/services-http` reviewer's probe (`/tmp/sh-review/probe.mts`):
`httpRequest` to a backend that never answers, then a graceful root
or session close. After 2 s, neither the close nor the request had settled,
with a fake backend and with a real slow server.
Forced closes settle as `cancelled`.

Cause: Core waits for running operations before it runs resource
`ctx.defer`, so the abort in `src/scaffold/backend/http.ts:31-34`
never runs during a graceful close.
`http.ts:24` claims it works "including on graceful close"; it does not.

## Precedent

The trial services fixed the same gap
(`tools/flight-trial/services/payment/index.ts:476-479`):
a close hook aborts requests in flight, then calls `event.next()`
in the same tick, so no new send slips in.
POSIX graceful shutdown (ADR 0028) lets work finish, but an outgoing
network wait with no end is not work the app can finish.

## Do

1. When a root or session that owns `http` starts closing gracefully,
   abort its requests in flight before Core waits for running work.
   Use the scaffold's existing extension hooks; no Core change.
   The aborted request ends as a managed `HttpRequestFailed`
   (or `cancelled` if the caller's own signal fired), never a hang.
2. Keep graceful behavior for other work.
3. Fix the comment at `http.ts:24`.
4. Tests (red on today's code, green after): graceful root close and
   graceful session close each settle within a bound while a request waits
   on a never-answering `httpBackend` fake; a request started after closing
   begins fails at once; forced close still settles as before.
5. Rebuild the registry.

## Proof, all by exit code

Red then green per test; `check:plain --prove`; seam; registry;
app tests; build; `vp check`; prose.

## Limits

- Change only `apps/start-scaffold/` and `docs/roadmap/start-scaffold/`.
- Do not change Core. Note any Core gap in PROGRESS.md.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
