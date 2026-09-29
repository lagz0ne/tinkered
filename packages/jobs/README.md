# @tinker/jobs

A queue row names an operation.
Each job runs in a new session.
The package uses pg-boss 12.35.0.

```ts
const queue = jobs([job("receipt", saveReceipt)], {
  tx: store.tx,
  pglite: store.db,
  env: {},
});

const addReceipt = operation({
  label: "add receipt",
  depends: { send: queue.send },
  run: ({ send }) =>
    send.run({
      input: {
        queue: "receipt",
        data: { value: "paid" },
      },
    }),
});
```

List `queue.extension` after `migrate(store.db, files)`.
Drizzle commits its files before pg-boss starts.
pg-boss installs or upgrades its own `pgboss` schema,
under its own advisory lock.
Keep `schemaFilter: ["public", "auth"]` in Drizzle Kit
when the app has auth tables; use `["public"]` without them.
Do not include `pgboss` or use `drizzle-kit push`.

With PGlite, pass the same store's `db` and `tx`.
The jobs piece borrows its client and never closes it.
For Postgres, omit `pglite` and set `env.JOBS_URL`.
`JOBS_URL` is the queue connection string;
it must point to the same database as `store.tx`.
This name lets the worker use its own pool settings.
It must use the `postgres:` or `postgresql:` scheme.
The piece has no default URL.
Only a dev root or a test binds the database.

`send` is an operation to put in `depends`.
It saves through that session's transaction.
A successful job closes its session before completion.
A throw rolls it back and lets pg-boss retry.
A failed commit also fails the job.
After the last try, the job stays failed and logs one line.
The queue uses pg-boss defaults unless its row sets
`retryLimit`, `retryDelay` (seconds), or `retryBackoff`.
`cron` takes a cron string and sends `{}` as the input.
Operations may use their usual input parser.

Close stops fetching before core closes child sessions.
Graceful close lets a running job finish.
Forced close aborts the operation's signal.
Operations must honor that signal when waiting.

Tests bind `createJobsClock` from `@tinker/jobs/testing`.
Its `binding` goes in the scope's `tags`.
`advance(ms)` moves timers and the database clock together.
Tests poll saved job states after advancing time.
They never sleep or patch globals.

## Promises

- A committed request runs its job once with its data.
- A rolled back request leaves no job.
- A failing job retries then stays failed and logs one line.
- Each job gets its own session cell.
- A cron row creates a job when the test clock reaches its schedule.
- An open request can add jobs while due jobs wait for PGlite.
- Graceful close stops fetching and lets a running job commit.
- Forced close cancels the running job and rolls its session back.
- Bad settings fail boot naming JOBS_URL before serving.
- A piece rejects a second live scope and restarts after close.
- A failed later start stops jobs and leaves the borrowed database open.
- The graph traces sending and running the job operation.
- A failed commit fails the job instead of marking it complete.
- Job input passes through its operation parser.
- An unreachable JOBS_URL fails boot at the given Postgres address.
- Jobs migrate after Drizzle commits and release their own lock.
- A piece stays owned until the whole root close ends.
- Closing stops other queues while a running job drains.
- Worker database faults reach the scope log.
- A failed child operation fails the job with its cause.
