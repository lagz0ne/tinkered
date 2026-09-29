# Stack — research (2026-09-29)

The ask: one package to start any web app on the
tools we like. The library we reach for on every
web project.

This note has no decision yet. It lists what apps
repeat, what we already have, what others learned,
and the forks to decide.

## What every app repeats today

Evidence: `apps/issue-tracker`, our one full app
(server, browser, CLI, MCP). Every item below has
nothing to do with issues.

- **Server start** — `src/server/main.ts`, 158 lines.
  - Reads `HOST`, `PORT`, `DATA_PATH` by hand.
  - Serves the built client by hand, with content
    types typed out per file ending.
  - Binds the port, waits for SIGINT or SIGTERM,
    closes graceful, turns the close result into an
    exit code, logs a boot failure by hand.
- **Logs** — `src/server/observe.ts`, 51 lines.
  One JSON line per log and per failed span.
- **Errors to HTTP** — `src/server/routes.ts:13-57`.
  Each error kind mapped to a status by hand, plus
  "anything else is 500 and a log line".
- **Database** — `src/server/store.ts:43-68`.
  PGlite plus Drizzle. Migrations are hand SQL:
  `create table if not exists` and
  `alter table … add column if not exists`.
- **Live sync over SSE** — SSE means server-sent
  events: one HTTP response that stays open.
  - Server side: `sseTransport` in
    `src/server/sync.ts`, about 50 lines.
  - Browser side: `src/client/connection.ts`,
    144 lines, with reconnect.
- **Publish after commit** —
  `src/server/publish.ts`, 44 lines.
- **Browser start** — `src/client/main.tsx`,
  94 lines: create the scope, wait for `ready`,
  "Connecting…" and "Could not connect" pages.
- **Dev loop** — `vp dev` for the client and
  `node --experimental-strip-types` for the server.
  Two processes, no server reload.
- **MCP over stdio** — `src/tools/main.ts`.

About 550 of 3,559 source lines are this glue:
1 line in 6. A second app would copy all of it.

`apps/playground` is the other shape: a browser
only app. It adds its own repeats:

- Tailwind 4, Radix, `components/ui` in the shadcn
  style, lucide icons, a `cn()` helper.
- An nginx `Dockerfile` and a Dokploy compose.

## What we already have

Each piece exists as its own package:

- `@tinker/core` — the scope, units, errors, logs.
- `@tinker/react` — the view reads cells, runs ops.
- `@tinker/hono` — routes as rows, one session per
  request.
- `@tinker/drizzle` — the db and the transaction
  as resources.
- `@tinker/sync` — cells shared from server to tab.
- `@tinker/http` — the typed client.
- `@tinker/process` — CLI commands, exit codes.
- `@tinker/mcp` — tools over MCP.

What is missing is the glue that joins them, and
a way to start a new app.

## What others learned

Survey of starter kits, 2026-09-29. There are three
ways to ship one:

- **Template** — copy once, the code is yours.
  - Epic Stack, create-t3-app, Remix Stacks.
  - No upgrades. Epic says: "there is no way to
    update it other than making manual changes."
  - Remix Stacks were archived on 2025-04-28.
- **Framework** — you depend on all of it.
  - RedwoodJS is in maintenance mode since 2025.
  - Blitz forked Next.js, then gave up the fork:
    "nearly killed our feature momentum."
  - Wasp compiles a config file into an app; each
    version has hand steps to move.
- **Both** — logic in a library you upgrade; app
  code written once by a generator.
  - Rails: `rails new`, skip flags such as
    `--skip-kamal`, and `app:update` to move.
  - Laravel: auth logic in Fortify (a library);
    the starter kit's pages copied into the app.
  - These two lasted.

Lessons we keep:

- **Split by who edits it.** Code the app never
  edits goes in the library. Pages and schema go in
  the app.
- **Record the stack version in the app**, so an
  upgrade knows where it starts (Epic's
  `epic-stack` field; Rails `load_defaults`).
- **Every piece can be left out.** Rails has a skip
  flag per piece.
- **One way per job.** A chooser with many options
  (Better-T-Stack) must test every mix.
- **Few services, local first.** Rails 8 keeps its
  queue and cache in the database; Laravel starts
  on SQLite.
- **Never fork or wrap the framework under you.**
- **A stack tied to one host goes stale** when the
  host moves.

Sources: Epic Stack docs `managing-updates.md` and
`decisions/`; create.t3.gg FAQ; better-t-stack.dev
CLI docs; remix-run/blues-stack; Redwood forum
"The future of Redwood"; blitz-js discussion 3075;
rubyonrails.org "Rails 8: No PaaS Required";
laravel.com starter kits.

### Our fit

Two things make "both" cheap here:

- `vp create` runs generators kept in the repo
  (`create.templates` in `vite.config.ts`, Bingo
  templates). See
  `node_modules/vite-plus/docs/guide/create.md`.
- Our pieces are already extensions in a list
  (ADR 0060). Leaving one out is deleting one row,
  not a skip flag.

## What we aim to solve

1. **Start fast.** One command makes an app that
   runs, passes its tests, and can deploy.
2. **Glue once.** The 550 lines above live in one
   versioned package. A fix reaches every app.
3. **One way per job.** The stack picks. The app
   does not choose a logger or a migration tool.
4. **Nothing is locked in.** Each piece is one
   extension or tag the app can drop or swap.

## Round 1, decided (ADR 0074)

- **Ships as** a library plus a generator.
- **Apps start** in this repo; npm comes after two
  apps run on the stack.
- **v1 extras:** auth, jobs, email, OpenTelemetry,
  server-side React. Deploy is not in v1.

## Round 2 research (2026-09-29)

Versions checked on npm that day.

### Server-side React

"Hydrate" means the browser takes over the HTML the
server sent.

- **Hono can stay the owner** of the server with
  any of these, used in its bare form: a fetch
  handler, and Vite in middleware mode for dev.
- **Skip the kits that take the server**:
  `react-router-hono-server`, Start with Nitro,
  Vike's `@vikejs/hono`, `@hono/vite-dev-server`.
  Each breaks ADR 0060.
- **TanStack Router alone** (1.170.40)
  - `createRequestHandler` turns a `Request` into a
    streamed `Response`; one catch-all route.
  - No data model of its own to fight our cells;
    cells cross over with `dehydrate`/`hydrate`.
  - Its SSR functions are marked "experimental
    until Start reaches stable status".
- **TanStack Start** (1.168.59)
  - Still a release candidate, a year after
    2025-09-22.
  - Can run under our server through `fetch`.
  - Its server functions and middleware do what our
    operations and sessions already do.
- **Plain React 19** — about 200–300 lines of our
  own, and we still need a client router.
- **React Router 8** — its loaders and actions
  compete with our cells.
- **Vike** — still `0.x`, its own router.
- **Our side:** the page route must hold the
  request's session until the stream ends, as
  `stream()` in `@tinker/hono` does.

### Jobs

- **pg-boss** (12.35.0) runs on PGlite; its CI tests
  it there.
- It adds a job inside our Drizzle transaction.
  With ADR 0041 the job exists only if the request
  commits. That is the outbox pattern (the job is
  saved in the same transaction as the write) for
  free.
- Retries with backoff; cron schedules.
- graphile-worker has no PGlite path.
- **The worker is a driver:** an extension that
  opens one session per job, as `hono` opens one
  per request.

### PGlite has one connection

This one fact shapes jobs, auth, and tests.

- `query` and `transaction` wait on one lock.
- ADR 0041 holds the request's transaction for the
  whole request.
- So a call on the boot handle while that
  transaction is open waits forever:
  - adding a job without passing the transaction;
  - `auth.api.getSession` on Better Auth's handle.
- In dev, jobs and requests take turns.
- Real Postgres has many connections, so it would
  not hang there. Dev and tests would still hang.

### OpenTelemetry

- **A sink in the stack** turns our finished spans
  into OTLP/JSON. Core imports no OTel.
- **Core lacks a trace id.** `export` sees spans
  child first, as they close; a sink cannot know a
  span's trace until its root ends. A long SSE
  session would hold its whole tree in memory.
- The fix is in core: each span gets a trace id
  when it opens, copied from its parent. `hono`
  reads the `traceparent` header; `http` sends it.
- Also missing: a span kind (server, client), links
  for jobs, `service.name`.
- Log level maps to OTel's severity number:
  20→5, 30→9, 40→13, 50→17.
- The OTel logs SDK is still "Development"; skip it.

### Auth: Better Auth

- 1.7.6. Vercel bought it on 2026-07-07; it stays
  MIT. Minor versions break (1.7 lists 8 breaking
  changes), so pin the exact version.
- Works on PGlite with Drizzle (tried in a scratch
  probe outside the repo).
- Mounts on Hono at `/api/auth/*`;
  `getSession({ headers })` reads the user.
- Its own routes commit on its own db handle, not
  our request transaction.
- Rule: read the user **before** the request's
  transaction opens, or PGlite hangs.
- Test helper: the `testUtils()` plugin
  (`createUser`, `login`).
- Lucia is now a guide to copy; Auth.js gets
  security fixes only.

### Email

- **Send** with nodemailer over SMTP: every
  provider takes SMTP (Resend, SES, Postmark).
- **Dev:** Mailpit catches mail on port 1025.
- **Tests:** a memory transport keeps a `sent`
  list to assert on (Rails `deliveries`, Laravel
  `Mail::fake`).
- **Templates:** React Email 6.
- **When:** after the commit. Rails and Laravel
  both warn that mail queued in a transaction can
  go out after a rollback.

## Round 2, decided (ADR 0075, 0076)

- **Server-side React:** TanStack Router alone,
  under one Hono route.
- **OpenTelemetry:** a trace id in core first; the
  OTLP sink lives in the stack.
- **Auth:** Better Auth, pinned to an exact version.
- **Email:** through a job.

## Round 5 research: the dev loop (2026-09-29)

Boot costs, bench queue, one core, median of 10:

- `node -e ""`: 28 ms.
- PGlite in memory, first query: 3,867 ms.
- PGlite from a folder on disk: 749 ms.
- Vite `createServer` in middleware mode, then
  `close`: 1,258 ms.

So a process restart on each server edit costs
about 2 s, before migrations.

- **Vite 8.2 (in Vite+)** has a module runner. On a
  server edit it clears its cache and re-imports
  the entry by itself. It closes nothing the old
  code opened.
- **React Router 8 and TanStack Start** keep one
  process. Each request re-imports the server code
  through the runner.
- **Epic Stack** keeps its database client across
  reloads in a `globalThis` cache (`remember`).
- **Rails** reloads code inside the running process
  and keeps the database pool.
- **`node --watch`** (Node 22) restarts on any
  imported file. It waits for the old process to
  exit before it starts the new one.

## Round 6 research: mail (2026-09-29)

- **Upyo** (`@upyo/*` 0.6.0, 2026-09-09, MIT): one
  `Transport` type with `send(message, { signal })`
  and a `Receipt` that says if a failure can be
  retried. Backends: SMTP, SES, Resend, Mailgun,
  SendGrid, and more; no Postmark. Its mock keeps
  every sent mail for tests. One main maintainer;
  2,758 downloads a week.
- **unemail** (0.7.0, 2026-09-02, MIT): 28 drivers,
  Postmark and Mailpit among them, and a mock
  inbox. 561 downloads a week.
- **Nodemailer** (10.0.12, 2026-09-28): the common
  SMTP library, 25.9M downloads a week. No list of
  sent mail for tests. The Resend and Postmark
  add-ons do not yet accept version 10.
- **SMTP reaches every provider:** Resend,
  Postmark, SES, and Mailgun all take it. Over SMTP
  you lose batch sends and instant errors.
- **Laravel** owns its mail API over Symfony
  Mailer. Its default backend is `log`; tests use a
  list you can read.
- **Rails** owns Action Mailer: `:smtp`, `:file`,
  `:test`. `letter_opener` shows dev mail in the
  browser with no mail server.
- **React Email 6:** `render()` from `react-email`
  gives HTML, or plain text with `plainText: true`.
  It is async.

## Round 3, decided

- **The first app:** the issue tracker moves onto
  the stack first. Its tests prove the move. The
  generator comes after.
- **Where glue lives (ADR 0077):** in its home
  package. The stack keeps only what spans
  packages. `@tinker/sync/sse` ships the SSE
  transport.
- **Migrations (ADR 0079):** Drizzle 1.0 RC,
  pinned. One migrate step at boot and in test
  setup. Better Auth joins our history; pg-boss
  keeps its own. Tests check that all agree.
- **The stack's shape:** pieces the root lists one
  by one, never a wrapper that owns the scope
  (ADR 0060).
- **The generator** writes a full app: every v1
  piece wired, each shown in its common case as an
  operation or a resource. Libraries load on first
  use.
- **Dev services:** `vp run dev` starts
  `nats-server` itself. Mail needs no service: it
  is one API with backends to swap, as Drizzle is
  for databases.
- **NATS carries live updates first:** after a
  commit, one process tells the others. Each
  re-reads from the database, as publish after
  commit does today.
- **A piece is an extension (ADR 0081).** The app
  touches only operations, resources, data, and
  namespaces. The extension's `start` checks
  config, so a missing key stops boot.
- **The dev host (ADR 0082):** one process; an
  edit rebuilds the scope. Only the dev host and
  the test helper bind defaults.
- **Mail (ADR 0083):** the app calls `sendMail`;
  Upyo sits behind it; `MAIL_URL` picks the
  backend.
- **NATS (ADR 0080):** `@tinker/nats` joins the
  stack for pub/sub. pg-boss keeps jobs and cron.
  Uploads wait.

## Round 3 research: migrations (2026-09-29)

Three owners make tables in one database: our
app, Better Auth, and pg-boss.

### Drizzle

- Stable is `drizzle-orm` 0.45 with `drizzle-kit`
  0.31. 1.0 is at `rc.4` (2026-06-27), with no date
  for a stable release.
- The orm and kit versions must match. Kit 1.0
  refuses orm 0.45.
- **0.31 breaks on branches.** Two branches that
  each run `generate` conflict in
  `meta/_journal.json`.
- **0.31 skips in silence.** `migrate()` runs only
  files newer than the last applied one. A merged
  file with an older time never runs. We tested it.
- **1.0 fixes both.** One folder per migration, no
  journal. `migrate()` runs every folder not yet in
  its table. `check` fails when two branches clash
  (the commutativity check).
- Both run all pending files in one transaction.
  Neither takes a lock, and neither notices an
  edited old file.
- On PGlite, a file with two statements needs a
  `--> statement-breakpoint` line between them.
- **`push` in 1.0 reads every schema.** With no
  filter it plans `DROP SCHEMA "pgboss"`. A
  `schemaFilter` stops it.
- A drift check exists: `generate --explain` says
  `no_changes` when code and files agree.
- Four of our files import `drizzle-orm`.

### Better Auth

- `npx auth generate` writes a Drizzle schema file
  into the app. Then `drizzle-kit` makes the SQL.
  Its `migrate` command works only with Kysely.
- `schemaName: "auth"` puts its tables in
  `pgSchema("auth")`. Tested on PGlite.
- It checks our Drizzle schema object at start, not
  the database. A missing plugin table fails every
  auth route with `SCHEMA_MISMATCH`.
- Its Drizzle adapter accepts orm 0.45 and 1.0 RC.

### pg-boss

- It owns the `pgboss` schema and records its
  version in `pgboss.version`.
- By default `start()` installs or upgrades itself
  under an advisory lock (a Postgres lock two
  processes cannot both hold).
- With `migrate: false`, `start()` throws unless
  the version matches exactly.
- It can print its SQL. Each script has its own
  `BEGIN`/`COMMIT`, and some end with
  `CREATE INDEX CONCURRENTLY`, which cannot run
  inside a transaction. So its SQL cannot go into
  a Drizzle migration as is.
- `fromPglite` installs on our PGlite instance.
  Tested.

### Precedents

- **Rails engines and Laravel** copy a library's
  migrations into the app's one folder.
- **Solid Queue** keeps its own schema file, often
  in its own database.
- **Django** keeps one folder per app and one
  history table. Migrations name the ones they
  depend on across apps.

### Test speed

- PGlite has `clone()`: build and migrate once,
  then copy it for each test.

## Round 3 research: NATS (2026-09-29)

- **Client:** `@nats-io/*` 3.4.0 (2026-05-08). The
  old `nats` package is deprecated. The same core
  runs in the browser over WebSocket.
- **Server:** `nats-server` 2.15.0 (2026-09-17),
  Apache-2.0. The 2025 fight over the license ended
  on 2025-05-01: it stays Apache-2.0 under the CNCF.
- **Features by server version:** KV and Object
  Store long ago; message TTL 2.11; delayed
  messages 2.12; cron schedules 2.14.
- **Tests:** no in-process server exists. The binary
  is 18.7 MB and was ready in about 6 ms (median,
  bench queue, JetStream on).
- **Jobs:** JetStream work queues retry, but have no
  dead-letter queue, and by default retry forever.
  A publish cannot join a Postgres transaction. An
  outbox needs code we write: no Node library found.
- **Uploads:** Object Store has no presigned URLs,
  so bytes pass through our server. NATS's own
  advice: keep big files in S3, send a reference.
- **Traces:** the JS client does not carry
  `traceparent`. No OTel plugin for NATS exists
  yet; we would set the header ourselves.
- **Precedents:** NestJS and Moleculer ship NATS to
  carry calls and events between processes.
  Moleculer adds lasting queues on JetStream as a
  separate package.

## Open

Nothing. The tickets: `PROGRESS.md` in this folder.
