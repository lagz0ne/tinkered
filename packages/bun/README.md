# @tinker/bun

The parts of a Tinker app that run on Bun
(ADR 0130).

- `@tinker/bun`: `serve`, `Bun.serve` as a
  capsule; `run`, the host; and
  `ws.server`, rpc over one WebSocket.
- `@tinker/bun/client`: `ws.client`, the
  browser half of that socket.
- `@tinker/bun/sql`: `bunSql`, Postgres on
  `Bun.SQL`, with a pool.
- `@tinker/bun/sqlite`: `bunSqlite`, SQLite
  on `bun:sqlite`.

## Install

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.17.10
bun add $R/tinker-core-0.17.10.tgz \
  $R/tinker-bun-0.17.10.tgz
```

## Serve and run

`serve` is a capsule: `Bun.serve` for the
life of the scope (ADR 0132). The cmd gives
it its values; it reads no `process.env`.

```ts
const socket = ws.server({
  path: "/rpc",
  services: [api],
});
const table = routes({ table, stop });

export default defineMain(
  ({ env, signal, stdout }) =>
    createScope({
      signal,
      capsules: [
        serve({
          port: Number(env.PORT ?? 4318),
          pages: { "/*": page },
          websocket: socket,
          handlers: [table],
          stdout,
        }),
        api({ implement }),
        socket,
        table,
      ],
    }),
);
```

- `serve` goes first: its start wraps the
  rest, so it listens once all started.
- On close it stops the port first.
- `pages`: static files, Bun's own routes.
  Every path no handler takes gets them.
- `websocket`: the one handler with Bun's
  `websocket` (Bun takes one per server).
- `handlers`: asked in order; the first
  `Response` wins.
- `/api/*`, `/rpc` and `/rpc/*` go to the
  handlers; `paths` adds more.

A handler is a capsule whose start returns
Bun's own shape, `{ fetch, websocket? }`.
`fetch` gives a `Response`, `null` (it
upgraded the request), or `undefined` (not
its own: the next handler gets it).

`run` runs one cmd. It owns the signals and
the exit code.

```ts
import { run } from "@tinker/bun";

import main from "./server";

await run(main);
```

- A config error at start exits 78.
- Any other throw at start exits 1.
- A failed root exits 1.
- A signal exits 128 plus its number.

## The socket

The server is a handler: give it to `serve`
as `websocket`.

```ts
const socket = ws.server({
  path: "/rpc",
  services: [api],
});
```

Its `fetch` upgrades the socket's path, then
takes a bytes POST. Each answer:

- `undefined`: not this path;
- `null`: upgraded, Bun owns the request;
- a `Response`: refused (a foreign origin
  gives 403), or the POST's reply.

A bytes POST is for a key with a
bytes field.

The client:

```ts
import { ws } from "@tinker/bun/client";

const tab = await createScope({
  capsules: [
    ws.client({ url: "wss://host/rpc" }),
    api({ remote: ws.client }),
  ],
}).ready;
```

## Databases

Each gives a Drizzle connection.
`drizzle-orm` is an optional peer.

```ts
import { bunSql } from "@tinker/bun/sql";
import { bunSqlite } from "@tinker/bun/sqlite";

capsules: [
  bunSql({ url: new URL(env.DATABASE_URL) }),
  drizzlePg({ driver: bunSql.connection }),
];
```

- `bunSql`: `url` (secret), `max` (10).
- `bunSqlite`: `file` (`:memory:`).
- The file is in WAL mode, with foreign
  keys on.
- `begin` takes the write lock at once.
- Each closes with the scope.

## Guards

- The Origin check at upgrade.
- A frame over `maxPayload`, or of more than 32
  messages, closes the socket.
- More than `maxWatches` live watches answers 429.
- A socket quiet for 60 s closes.
