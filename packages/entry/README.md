# @tinkered/entry

The backend of a Tinker app. Code only: how to
use it is in the skills.

An app gets this code by version. It is not
copied into the app.

## Entries

Each entry is named by the kind of program that
imports it:

- `@tinkered/entry/cmd`: a command, a program
  with no port.
- `@tinkered/entry/server`: a server, a program
  that listens on a port.

Later, one entry per runtime:

- `@tinkered/entry/bun`: Bun, from
  `@tinkered/bun`.
- `@tinkered/entry/node`: Node.

## What each entry holds

`@tinkered/entry/cmd`:

- `defineMain`: types a command's main.
  It runs nothing.
- `createMainHost`, `runMain`: the host.
  It owns the signals and the exit code.
  A main that answers with no `closed`
  exits 1 with `MainClosedMissing`.
- `observeServerPanics`: an unhandled
  rejection closes the root, then exits 1.
- The types `MainClosed`, `MainContext`,
  `MainStarted`, from `@tinkered/bun`, so a
  command has one place to import from.

`@tinkered/entry/server`:

- `routes`: the route table, one session per
  request.
- `requestStop`: aborts when the request
  ends.
- `backendStop`: aborts when the server
  stops.
- `requestBody`: the request's body reader.
- `http`, `httpRequest`, `httpBackend`:
  outbound HTTP.
- `health`, `baseVersion`: the health route
  and this package's version.
- `Errors`, `isError`: the kinds this
  package raises, `HttpRequestFailed` and
  `MainClosedMissing`, and their payloads.
- `abortReasons`: the shared abort reason
  `closed`.

`zod` is a peer: the server entry needs it.

## A server command

```ts
import { serve } from "@tinkered/bun";
import { createScope } from "@tinkered/core";
import {
  defineMain,
  observeServerPanics,
} from "@tinkered/entry/cmd";
import {
  health,
  routes,
} from "@tinkered/entry/server";

export default defineMain(
  async ({ env, signal, stderr, exit }) => {
    const table = routes({
      stop: signal,
      table: { "GET /api/health": health },
    });
    const app = createScope({
      signal,
      capsules: [
        serve({
          port: Number(env.PORT ?? 4318),
          pages: {},
          handlers: [table],
        }),
        table,
      ],
    });

    const live = await app.ready;
    live.onClose(
      observeServerPanics(
        exit.bind(null, 1),
        app.closed,
        stderr,
      ),
    );
    return app;
  },
);
```

`run` from `@tinkered/bun`, or `runMain`,
starts it.

## State

The code moved in from the template
`lagz0ne/tinker-app` at d13daed. The names
and behavior are the template's.
