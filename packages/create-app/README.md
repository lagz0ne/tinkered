# @tinker/create-app

Make an app in this workspace:

```sh
vp create stack-app \
  --no-interactive --no-agent --no-editor -- my-app
```

The command writes `apps/my-app` once.
The app owns its pages, schema, operations, and tests.
Its stack packages use `workspace:*`.

## What you get

- One notes list with a server page and browser form.
- A static PGlite store and its transaction.
- Migration files for notes, receipts, and auth.
- One notes cell shared over sync.
- NATS signals after saved changes.
- A receipt job and a daily cron row.
- A React Email welcome template and queued auth mail.
- Sign-up, sign-in, verify, and password reset pages.
- A trace sink and local dev host.
- Tests for requests, pages, jobs, mail, auth, and drift.
- Tests of the real dev and prod entries.
- A mobile browser check of the form and live update.
- All prod keys in `.env.example`.

Start the app:

```sh
cd apps/my-app
vp install
vp run -r build
vp run dev
```

The dev host supplies local settings.
It owns the dev database and NATS server.
Mail goes to the dev log.
Prod needs every key in `.env.example`.
See the app's README for the prod commands.

## Drop a piece

The root list is in `src/server/main.ts`.
Remove the piece's row, then its files and imports.
Remove its tests and package dependency too.
Some examples share work: auth sends queued mail.
Remove those callers when dropping their piece.

For example, stop live signals by deleting this row:

```ts
liveUpdates(publishNotes, {
  subject: "my-app.changed",
  env,
  connection: host?.connection,
}),
```

Remove the `liveUpdates` and `publishNotes` imports.
Delete `tests/live.test.ts`.
The sync row can still serve local cell changes.
Remove `nats: true` from `src/dev.ts` too.

Other root rows and files:

- **Server:** `server(web, ...)` and the prod entry test.
- **Store:** the `databaseConfig` tag and `src/server/store.ts`.
  Remove the migration row and store use in notes, jobs,
  and auth when those pieces no longer keep saved data.
- **Migration:** `migrate(database, migrations)`.
  Remove `src/server/migrations.ts` and `drizzle/`.
- **Jobs:** `work.extension` and `src/server/jobs.ts`.
  Drop `post.job` from the job rows to drop queued mail.
  Drop the daily row in `createJobs` to drop cron alone.
- **Mail:** `post.extension` and `src/server/mail.ts`.
  Remove the auth mail caller in `src/server/auth.ts`.
- **Auth:** `identity.extension` and its config tag.
  Remove `identity.wiring` from `createWeb`.
  Delete `src/server/auth.ts` and `auth-schema.ts`.
  Delete `src/client/AuthForm.tsx` and auth page routes.
  Remove the auth exports from `schema.ts`.
  Generate a migration to drop the saved auth tables.
- **Pages:** `page.extension` and `page.mount`.
  Delete `src/server/pages.tsx` and `src/shared/page.tsx`.
  Delete the client files if no browser page remains.
- **Sync:** `published` and `src/server/sync.ts`.
  Remove `/sync` from the routes and client subscription.
- **Traces:** `traces.extension` and `traces.observe`.
  Remove the trace sink declaration.
- **Dev:** the `dev` script and `src/dev.ts`.

## Promises

- `vp create` writes an app that installs, builds, checks,
  and passes its tests.
- Writes app-owned files under apps with the given name.
- Refuses to overwrite an app's files.
- Refuses a name that is not one lowercase app directory.

## Checks

```sh
vp run create-app#test
vp run create-app#size
```

The workspace test creates a temp workspace.
It runs the registered command, builds, checks, and tests.
It removes that workspace when it finishes.
