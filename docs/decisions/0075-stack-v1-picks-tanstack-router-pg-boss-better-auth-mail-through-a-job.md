# 0075 Stack v1 picks: TanStack Router, pg-boss, Better Auth, mail through a job

Date: 2026-09-29. Status: accepted. Builds on: 0041 (the transaction is a session resource), 0051
(drivers are extensions), 0060 (an integration is an extension the scope owns), 0074 (the stack).
Research: `docs/roadmap/stack-v1/RESEARCH.md`, round 2. Versions as checked on npm that day.

> Superseded in part by 0083 (2026-09-29).
> Mail sends through Upyo behind `sendMail`; dev logs mail.

## Context

ADR 0074 named five v1 extras and gave each its own decision. This ADR settles four:
server-side React, jobs, auth, and email. OpenTelemetry needs a core change; ADR 0076 covers it.

**The precedent is Rails 8.** One pick per job, the queue in the app's own database, mail sent
through the queue (`deliver_later`). Ours is simpler: every piece is an extension or a resource in
the root's list, so nothing needs a skip flag.

One fact shapes three of the picks: **PGlite has one connection.** Its `query` and
`transaction` wait on one lock, and ADR 0041 holds the request's transaction for the whole
request. So any call on another handle while that transaction is open waits forever. Real
Postgres has many connections and would not hang, but dev and tests run on PGlite.

## Decision

1. **Server-side React is TanStack Router alone, under one Hono route.**
   - `createRequestHandler` turns the request into a streamed `Response` in a catch-all route
     mounted through the `hono` wiring. Vite runs in middleware mode for dev.
   - Router brings no data model; cells cross from server to browser through its `dehydrate`
     and `hydrate` options. Our operations and cells stay the one data path.
   - The page route holds the request's session until the stream ends, as `stream()` does.
   - Rejected: TanStack Start (a release candidate since 2025-09-22; its server functions and
     middleware repeat our operations and sessions), React Router 8 (loaders compete with
     cells), Vike (`0.x`, own router), and every kit that takes the server
     (`react-router-hono-server`, Start with Nitro, `@vikejs/hono`, `@hono/vite-dev-server`).
   - Risk accepted: Router's SSR functions are marked "experimental until Start reaches stable
     status".
2. **Jobs are pg-boss, and the worker is a driver.**
   - An extension that opens one session per job, as `hono` opens one per request. The job's
     operation runs in it; success commits, failure rolls back and pg-boss retries.
   - A job is added through the request's transaction (`send(…, { db })`), so it exists only if
     the request commits (the outbox pattern, for free).
   - Rejected: graphile-worker (no PGlite path), BullMQ (Redis), Inngest and Trigger.dev (outside
     services).
3. **Auth is Better Auth, pinned to an exact version.**
   - A scope resource built once from the db, the mailer, and a config tag. Its routes mount at
     `/api/auth/*` through the `hono` wiring.
   - Its own routes save on its own db handle, not in our request transaction. Accepted for v1.
   - Pinned: Vercel bought it on 2026-07-07, and minors break (1.7 lists 8 breaking changes).
   - Rejected: our own auth on Lucia's guide (we would own password hashing, resets, and email
     checks), Auth.js (security fixes only), Clerk (a hosted service).
4. **Mail goes out through a job.**
   - A `mailer` resource sends over SMTP with nodemailer. A tag picks the transport: SMTP in
     production, Mailpit in dev, a memory list in tests (Rails `deliveries`, Laravel
     `Mail::fake`).
   - Our code adds a mail job in the request's transaction, so a rolled-back request sends
     nothing. Templates are React Email.
5. **The one-connection rule.** During a request, anything that touches the database goes
   through the request's transaction. The signed-in user is read before that transaction opens.
   A test proves each path does not hang.

## Consequences

- Jobs land before mail; mail lands before auth's email checks and resets.
- In dev, jobs and requests take turns on the one connection.
- Better Auth owns its cookie, session, and table shapes. Its tables go in their own schema so
  a `user` table of ours cannot clash.
- Better Auth's mail hooks run outside our transaction; they add the mail job on its handle.
- If Router's SSR functions change before Start is stable, only the page route moves.
