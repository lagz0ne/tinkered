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
import { createScope, extension, type Observe } from "@tinker/core";
import { hono } from "@tinker/hono";
import { readExitCode } from "@tinker/stack";
import * as stack from "@tinker/stack";

async function run(stop: AbortSignal) {
  const observe = stack.jsonLines((line) => {
    process.stdout.write(`${line}\n`);
  });
  let log: Observe.Logger | undefined;
  const web = hono([]).extension;
  const scope = createScope({
    extensions: [
      extension({
        label: "app.root",
        hooks: {
          start(event) {
            log = event.log;
            return event.next();
          },
        },
      }),
      stack.server(web, {
        env: process.env,
        clientDir: "./dist/client",
      }),
      web,
    ],
    observe,
    signal: stop,
  });
  const phase = await scope.ready.then(
    () => "shutdown" as const,
    () => "boot" as const,
  );
  return readExitCode(await scope.closed, log, phase);
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
A server piece belongs to one live root at a time.
A second live root raises `PieceInUse` with `{ label: "stack.server" }`.

- `PORT` must be decimal digits from 1 to 65535.
- `HOST` must be an IP address or DNS host name.
- Neither setting has a default.
- `BadListenSettings.payload.keys` lists every bad key.
- The root passes env; the package never reads it.
- Only the dev host binds local defaults.

`createScope({ signal: stop })` owns start and stop.
The root reads `scope.ready` only to name the log line.
It then awaits `scope.closed`, after cleanup ends.
A stop is graceful: in-flight work finishes first.
A failed boot closes before the result is returned.

`readExitCode(result, log, phase)` reads that result.
Keep the root hook logger and pass it after close.
Pass undefined when no failure line is needed.
The logger adds its extension label to the line.
It never creates, borrows, or closes a scope.
The observe config must include a clock function.
Use `"boot"` when ready failed and `"shutdown"` otherwise;
the result itself does not name the phase.
A failed result returns 1 and logs `boot failed` or
`shutdown failed`, with the error's fields.
Its teardown errors join that same line.
Otherwise, teardown errors return 1 and log `shutdown failed`.
Other results return 0 without a failure log;
this includes a cancelled result with no teardown errors.

`jsonLines(write)` returns the scope's observe config.
The root supplies stdout, a file, or a test writer.
Each call writes one JSON object without a newline;
the root adds the newline when it writes to stdout.
`describeError(error)` keeps error fields for the log.

## Traces and logs over OTLP

`traceSink()` defines an extension for a telemetry scope,
which owns the queue, export operations, and timer.
Its `config` tag supplies that scope's settings and local writer.
After `ready`, resolve the extension to get an observe config
that app roots can borrow:

```ts
const tracing = traceSink();
const telemetryStop = new AbortController();
const telemetry = createScope({
  signal: telemetryStop.signal,
  extensions: [tracing],
  tags: tracing.config({
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      OTEL_SERVICE_NAME: "issue-tracker",
    },
    write: (line) => process.stdout.write(`${line}\n`),
  }),
});
await telemetry.ready;

const appStop = new AbortController();
const app = createScope({
  signal: appStop.signal,
  extensions: [web],
  observe: telemetry.resolve(tracing),
});
await app.closed;
telemetryStop.abort();
await telemetry.closed;
```

Reuse the same `tracing` definition in separate telemetry roots.
Each root keeps its own settings, writer, and queue.
Closing one root or failing its setup leaves the others running.
Missing config or bad settings reject `ready` and finish
`closed` as `failed` with the same error.
The exit-code helper logs `boot failed` and answers 1.
Close all apps before telemetry to export their final cleanup spans
and logs.
Leave observation off in the telemetry scope so exports do not
create more records to export.

The legacy `traceSink({ env, write })` form returns `extension`
and `observe` for one observed root.
Make a fresh piece per root and pass both:

```ts
const traces = traceSink({
  env: {
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    OTEL_SERVICE_NAME: "issue-tracker",
  },
  write: (line) => process.stdout.write(`${line}\n`),
});
const scope = createScope({
  extensions: [traces.extension, web],
  observe: traces.observe,
});
```

List the piece before extensions that do work at boot.
Start reads both settings once.
There are no defaults, including in dev.
`BadTraceSettings.payload.keys` names every missing or bad key.
The endpoint must use HTTP or HTTPS, with no credentials,
query, or fragment.
The service name must contain text after trimming spaces.

The sink sends [OTLP/JSON][otlp] by HTTP POST.
It adds `/v1/traces` and `/v1/logs` to the endpoint path,
following the [OTLP endpoint rule][otel-endpoint].
Both carry `service.name` and the scope name `@tinker/stack`.
It adds no outside package dependency.
Core already supplies the ids and finished spans;
using the official exporters would require SDK span objects.
The logs SDK stays out, as ADR 0076 requires.

- Each finished span and log is retained by reference until flush.
  OTLP reads ids and encodes attributes only at flush.
  Local JSON logs still encode at the call site.
- Core span kinds become the `tinker.kind` attribute.
  OTLP kind is INTERNAL (1).
  An ok span leaves status UNSET by omitting it.
  A failed span has code 2 and its error message.
  A thrown value that is not an Error uses `String(value)`.
- Times are epoch nanoseconds written as decimal strings.
- Log levels map as 20→5, 30→9, 40→13, and 50→17.
  Each log keeps its span's trace id and span id.
- String and boolean attributes keep their types.
  Bigint and safe integer attributes use decimal `intValue` strings.
  Other finite numbers use `doubleValue`.
  Other values become JSON text, or `String(value)` for undefined.
  A record that cannot be encoded is dropped.
- A timer flushes once per second after the last batch ends.
  Graceful close joins that batch and flushes queued records,
  including logs from resource cleanup.
  Its one-second deadline starts at close and covers both batches.
- Forced close aborts any send, drops queued records, and sends nothing new.
  It does not wait for the send deadline.
- The queue holds at most 2048 finished span or log references.
  A full queue drops new records without encoding them.
  Flush caps the batch at 1 MiB of encoded record bytes.
  Records that would exceed that cap are dropped.
  A batch in flight has the same count and byte bounds.
- Each send has a one-second deadline.
  Any 2xx response delivers the batch, including 202 and 204.
  Failed batches are dropped with no retry.
  A request never waits for this network work.
- One local JSON warning names a failure burst.
  A full successful batch ends the burst.
  The warning never goes back into the export queue.
- Local JSON logs and failed spans still go to `write`.
  A broken local writer does not stop work or export.

[otlp]: https://github.com/open-telemetry/opentelemetry-proto/blob/main/docs/specification.md
[otel-endpoint]: https://opentelemetry.io/docs/specs/otel/protocol/exporter/#endpoint-urls-for-otlphttp

## Publish after commit

`publishAfterCommit(publishIssues)` runs the app's read
operation at boot and after each committed non-GET request.
The operation reads storage and sets the root's sync cells.
Manual sessions do not trigger it.
One publisher can be shared by several roots.
After commit it reads that root's tags and updates its cells,
even when the request has its own values.
A committed request publishes root state in its own namespace.
Request drafts stay in their session; publication reads committed storage.
A raised error mapped to 4xx rolls back its session,
so it sends no signal (ADR 0084).
A boot read failure rejects ready.
A read failure after commit logs `publish failed` and
keeps the request's answer.

For several server processes, use one subject (channel name) per app:

```ts
const live = liveUpdates(publishIssues, {
  subject: "issues.changed",
  env: process.env,
});
const first = createScope({
  extensions: [web, src, live],
});
const second = createScope({
  extensions: [web, src, live],
});
```

Reuse the same live piece across roots.
Each root owns its publisher and NATS connection.
A failed second boot leaves the first root receiving signals.
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
An incoming live signal refreshes root state in each receiving namespace.
Those reads never send another signal.
The app's read must be safe to repeat; `publishIssues`
keeps equal snapshots unchanged.
NATS closes the subscriptions with their scope.

Core NATS does not keep messages for a disconnected server.
A later commit or a new boot reads the current database.

## Promises

- A server piece restarts after close.
  Each start logs `listening`, and each close releases its port.
- A second live root cannot take or stop the server piece.
  The piece stays owned until the full close chain ends.
- An old root's second close keeps the new server owner.
- A broken listening sink keeps the server ready and frees its port on close.
- The scope level filters the listening line.
- Stop closes the keep-alive socket after the last stream chunk.
- Opens the port only after every other start finishes.
- A stop refuses new requests while it waits for an in-flight request.
  It answers zero after the open requests finish.
  Keep-alive connections close when their last response finishes during stop.
- An already stopped signal closes after boot and
  answers zero.
- Failed boot waits for cleanup before logging and
  answering one.
- A failed boot with teardown errors logs both on one boot failed line.
- A failed close logs shutdown failed and answers one.
- Teardown errors log shutdown failed and answer one.
- A cancelled root without teardown errors answers zero.
- A cancelled root with teardown errors answers one.
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
- A raised error mapped to 4xx rolls back and sends no signal.
- Live updates require NATS_URL at boot.
- Local publishing runs after later starts and before the
  first request.
- A failed boot publish rejects ready with its cause.
- A failed publish after commit keeps the answer and the next
  commit retries.
- A manual session does not publish after boot.
- The graph traces the changed signal and the root re-read.
- An invalid live subject fails boot.

- One request exports one trace with its remote parent, span fields, and service.
- Log lines carry their span ids, mapped severity, time, and attributes.
- The timer exports finished spans while a stream is still open.
- Graceful close exports queued spans, failed status, and cleanup logs.
- Missing or bad OTLP settings stop boot and name every key.
- Telemetry with missing or invalid config finishes cleanup
  and reports one boot failure.
- A bad OTLP endpoint fails boot naming only its key.
- A missing service name fails boot naming only its key.
- A down, slow, or 500 collector keeps requests and close working and logs once per burst.
  A collector that accepts traces but refuses logs still warns once per burst.
- A recovered collector ends a failure burst so a later fault logs again.
- The queue bounds record count and bytes and drops new records with one local warning.
- A broken local writer does not stop export.
- An unencodable record warns locally and leaves later spans exportable.
- Forced close keeps cleanup logs local and warns that their export was dropped.

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
List `migrate(store, migrations)` right after `server`.
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

## Dev host

The separate `@tinker/stack/dev` entry owns the dev process.
The main entry never loads Vite or the local NATS server.
Install the optional `vite-plus` peer to use dev.

```ts
import { runDev } from "@tinker/stack/dev";

await runDev(
  {
    root: process.cwd(),
    entry: "src/server/main.ts",
    env: process.env,
    nats: true,
    report: (event) => {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    },
  },
  stop.signal,
);
```

The entry exports `runServer(env, stop, host)`.
It still owns its scope and returns an exit code after close.
The third argument is `Dev.Wiring`.
It lends `client` (PGlite) and `connection` (NATS).
Pass them to the store and NATS pieces; never close them.
After creating the root, hand over its ready app promise:

```ts
host?.ready(scope.ready.then(() => scope.resolve(web)));
```

When `host` is present, omit the root's `server` row.
The host keeps the port and Vite's client middleware open.
Vite owns client file paths; the app owns its API routes.
An app response keeps its body even when the browser accepts HTML.
A server edit stops the old root, awaits its exit,
and imports the new root through Vite's runner.
Only a ready root receives new requests.
During reload or failed boot, app requests receive 503.
A failed boot's answer includes the error.
An app's HTML 404 page also keeps its body and status.
Client routes get the loading shell only when they accept HTML.
A good edit retries without restarting the process.

Dev defaults are `127.0.0.1`, port `4311`, and
`./data/issues` under `root`.
Set `DATA_PATH` to choose another database folder.
`nats: true` starts the pinned local NATS server and binds
its URL; the NATS piece borrows the host's one connection.
`liveUpdates` also accepts `connection` for that purpose.
Prod gets none of these defaults.

- Dev serves the app and Vite client from one listener.
- Dev binds an explicit IPv6 host and reports its usable URL.
- An imported JSON edit rebuilds the server root.
- An unloaded server file save closes the old root.
- A client edit reaches HMR on the kept port and leaves the root running.
  Stop closes an open HMR socket before returning.
- Three server edits close old roots and keep the same
  database and NATS handles.
  Database writes do not add reloads when DATA_PATH is in the server folder.
  Root cleanup can still use both borrowed handles.
  Stop closes the database, NATS connection, and local server.
- A request in flight during an edit finishes on its old root.
- Back-to-back saves serve each new server value.
- A broken server edit serves 503 until a good edit.

- A broken root entry stays editable on 503.
  The error event preserves a thrown value or exit code.
  A missing callable entry reports `BadDevEntry`.
- Dev answers one for bad listen settings with or without a report.
- Dev without a report still starts, recovers, and stops.
- Dev refuses an occupied port without closing its owner.

- Live updates borrow one connection across roots.

- Stopping during a reload signals the starting root
  before joining it.
- A root teardown failure still closes dev services
  and answers one.
  This also holds when the root rejects on stop.

## Server pages

Import `pages` from `@tinker/stack/pages`.
It starts nothing until the root lists its extension.
Give it the page component, a cell-read operation,
and a renderer that returns a streamed `Response`.
The renderer receives the request, the read values,
and the component inside the request's React provider.
It receives no scope.

Use its `mount` in Hono's wiring after API routes.
The catch-all page leaves `/assets/` to the file routes.
Hono keeps the session until the renderer's body ends.
The last read waits for commit; abort cancels both
the renderer and the request session.

- Pages render the request's cells and keep
  the renderer's status and headers.
- API and built assets keep their routes
  before the catch-all page.
- A page holds its session and waits for commit
  before its final chunk ends.
- A page abort through its reader or request
  cancels the renderer and its session.
- A renderer failure before headers reaches
  Hono's error answer.
- A body failure errors the page and fails its session.
- An empty page commits before answering with
  the renderer's status and headers.
- The page extension leaves ordinary sessions
  free to read their cells.
- Reusing a request after its page ends reads
  the new published value.
- The renderer can read its finished body again
  during request cleanup.
- A page mount without its extension passes
  requests to the next route.

The dev wiring's `load(path)` uses Vite's kept SSR runner.
Its page imports join the server's reload graph.
A page component edit closes the old root
and is visible on reload.

- A page loaded by the dev wiring reloads its root on edit.
