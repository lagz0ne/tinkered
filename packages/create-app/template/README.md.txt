# __APP_NAME__

A notes list with an app-owned store, pages, and operations.

## Dev

From this app's folder:

```sh
vp run -r build
vp run dev
```

Open `http://127.0.0.1:4311`.
The host owns local PGlite and NATS.
Mail goes to its log.
The dev secret is for local use only.
Set `PORT` to use a different port.

## Prod

Fill every key from `.env.example` in `.env`.
Use a new auth secret with at least 32 characters.
Start NATS, SMTP, and an OTLP collector at those URLs.
The data path must be writable and kept across starts.

```sh
vp run -r build
vp run start
```

The entry reads `.env` and checks each required key.
A missing key fails boot and names that key.
SIGTERM closes the server and its pieces with exit 0.

## Checks

```sh
vp exec playwright install chromium
vp run test
vp run auth:check
```

Tests clone a migrated test database.
They use real NATS, a test clock, and the mail mock.
The schema checks compare code with migration files
and auth CLI output.
The entry tests run the built prod server and dev host.
The browser test saves a note and waits for its live update.

## Change the app

- Notes schema: `src/server/schema.ts`.
- Request operations: `src/server/notes.ts`.
- Published cell: `src/shared/notes.ts`.
- Pages: `src/shared/page.tsx` and `src/client/App.tsx`.
- Root rows: `src/server/main.ts`.
- Job and cron rows: `src/server/jobs.ts`.
- Mail templates: `src/server/mail.ts`.
- Auth routes and mail: `src/server/auth.ts`.

After changing the schema:

```sh
vp run db:generate
vp run test
```

The next boot applies the saved migration files.
Do not edit a migration already used in prod.

To drop a piece, delete its root row and files.
Remove its callers, imports, tests, and package entry too.
For example, drop the daily cron row from `createJobs`
and delete its test in `tests/jobs.test.ts`.
The receipt job can stay.
See `packages/create-app/README.md` at the workspace root
for the full list.
