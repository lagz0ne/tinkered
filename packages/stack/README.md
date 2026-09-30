# @tinker/stack

Server start, shutdown, client files, and JSON logs.
The app owns its root and hands each piece its inputs.
Importing this package starts nothing.

## The root

List `server` first; its start checks settings before other starts run.
When the app has a database, list `migrate` right after `server`.
It finishes before the port opens.

List the Hono extension after both.
The server opens the port after all later starts finish.

```ts
import { createScope } from "@tinker/core";
import { hono } from "@tinker/hono";
import { jsonLines, runUntilStop, server } from "@tinker/stack";

async function run(stop: AbortSignal) {
  const observe = {
    ...jsonLines((line) => {
      process.stdout.write(`${line}\n`);
    }),
    clock: Date.now,
  };
  const web = hono([]).extension;
  const scope = createScope({
    extensions: [
      server(web, {
        env: process.env,
        clientDir: "./dist/client",
        observe,
      }),
      web,
    ],
    observe,
  });
  return runUntilStop(scope, stop, observe);
}

if (import.meta.main) {
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.exitCode = await run(stop.signal);
}
```

`server(web, { env, clientDir })` borrows the Hono
extension and env object.
`start` reads env once.
The scope owns the port and closes it.

- `PORT` must be decimal digits from 1 to 65535.
- `HOST` must be an IP address or DNS host name.
- Neither setting has a default.
- `BadListenSettings.payload.keys` lists every bad key.
- The root passes env; the package never reads it.
- Dev defaults belong in the app's root.

`runUntilStop(scope, stop, observe)` borrows the scope.
It never creates or returns a scope.
The observe config must include a clock function.
It waits for ready and then the stop signal.
Close is graceful: in-flight work finishes first.
A failed ready is closed and awaited before returning 1.
A failed close or teardown error also returns 1.
A clean close returns 0.

`jsonLines(write)` returns the scope's observe config.
The root supplies stdout, a file, or a test writer.
Each call writes one JSON object without a newline;
the root adds the newline when it writes to stdout.
`describeError(error)` keeps error fields for the log.

## Publish after commit

`publishAfterCommit(publishIssues)` runs the app's read
operation at boot and after each committed non-GET request.
The operation reads storage and sets the root's sync cells.
Manual sessions do not trigger it.
One publisher can be shared by several roots.
After commit it reads that root's tags and updates its cells,
even when the request has its own values.
A handled error answer (4xx) still commits its session,
so it republishes and signals.
A boot read failure rejects ready.
A read failure after commit logs `publish failed` and
keeps the request's answer.

For several server processes, use one subject (channel name) per app:

```ts
extensions: [
  web,
  src,
  liveUpdates(publishIssues, {
    subject: "issues.changed",
    env: process.env,
  }),
];
```

Make a fresh live piece for each root.
A rejected second boot leaves the first root receiving signals.
The nested row holds the publisher and its NATS extension.
NATS checks `NATS_URL` at start.
A subject must have nonempty parts split by dots,
with no space or wildcard (`*` or `>`).
A bad subject raises `BadLiveSubject` with `{ subject }`.

Each successful read after commit sends one empty message.
One app subject fits one operation that reads all published
cells; a subject per cell would repeat that same read.
The signal carries no saved data.
Every process reads the database again, including the sender.
Those reads never send another signal.
The app's read must be safe to repeat; `publishIssues`
keeps equal snapshots unchanged.
NATS closes the subscriptions with their scope.

Core NATS does not keep messages for a disconnected server.
A later commit or a new boot reads the current database.

## Promises

- Opens the port only after every other start finishes.
- A stop waits for an in-flight request and answers zero.
- An already stopped signal closes after boot and
  answers zero.
- Failed boot waits for cleanup before logging and
  answering one.
- A failed close logs shutdown failed and answers one.
- Teardown errors log shutdown failed and answer one.
- A port already in use fails boot without closing
  its owner.
- A bad PORT fails ready and names PORT.
- Valid listen limits let the next start run.
- A bad HOST fails before its free port opens.
- One error names every missing or bad listen key.
- Serves the built index and assets with their
  content types.
- Missing client files and unsafe asset names keep
  their HTTP answers: 503 for an unbuilt client,
  404 for a missing asset, 400 for a bad name.
- File read errors reach the app error handler.
- Error logs retain registry fields, stack, nested
  causes, and non-errors.
- JSON lines carry scope logs and failed spans with
  their fields; successful spans are left out.
- A JSON writer failure does not stop scope work.
- A committed save reaches the other server's sync subscriber
  in both directions.
- One empty signal per commit re-reads on the sender without
  another snapshot or signal.
- GET and a rolled-back save send no signal.
- A failed database commit sends no signal.
- Closing one server removes its NATS subscription while the
  other keeps publishing.
- A different app subject leaves its published cells alone.
- A handled 4xx answer still commits and signals.
- Live updates require NATS_URL at boot.
- Local publishing runs after later starts and before the
  first request.
- A failed boot publish rejects ready with its cause.
- A failed publish after commit keeps the answer and the next
  commit retries.
- A manual session does not publish after boot.
- The graph traces the changed signal and the root re-read.
- An invalid live subject fails boot.

## Checks

```sh
vp run stack#test
vp run stack#size
flock /tmp/mutation.lock \
  vp run --no-cache stack#mutate
```

The size cap is 10 kB gzip.
The mutation floor is 85.

## Migrate before serving

List `server` first so it checks settings before any database work.
List `migrate(store.db, migrations)` right after `server`.
Migrations finish before the port opens.

`migrations` holds the app's `migrationsFolder` path
and an optional `baseline(db)` for its old tables.
The baseline uses only the transaction passed to it.

The start takes a Postgres advisory lock, a lock shared
by all starts using the same database.
One transaction pins its connection, runs the baseline
and Drizzle files, then commits and releases the lock.
A failure rolls back and stops boot before serving.
PGlite's one connection runs these transactions in turn.
A future pg-boss start belongs after this commit.

`createTestDatabase(migrations)` runs that same step
on one in-memory PGlite and returns `clone()` and `close()`.
Create one per test file, clone it for each test,
then close each clone and the template.
Each clone starts with the migrated tables and its own rows.
The helper creates no lasting scope.
PGlite's clone return type omits its class;
the helper keeps that type fix at the library boundary.

- Two starts on one database migrate once under a lock
  released before the next start.
- A failed migration stops the port opening and rolls
  back its tables and history.
- A bad PORT fails boot naming PORT and runs no migration.
- The test helper migrates once and gives each clone
  its own rows.
- The test helper rejects a migration failure.
