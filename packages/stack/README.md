# @tinker/stack

Server start, shutdown, client files, and JSON logs.
The app owns its root and hands each piece its inputs.
Importing this package starts nothing.

## The root

Create the Hono extension, then list `server` first.
Its start checks settings before other starts run.
It opens the port after they all finish.

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

## Checks

```sh
vp run stack#test
vp run stack#size
flock /tmp/mutation.lock \
  vp run --no-cache stack#mutate
```

The size cap is 10 kB gzip.
The mutation floor is 85.
