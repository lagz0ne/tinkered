# 0132 `serve` is a capsule; `run` is the host

Date: 2026-11-09. Status: accepted.
Accepted: Duke, 2026-11-09 23:48 UTC: "Yes" (the cmd shape).
Names: Duke 23:50 "serve", 23:51 "handlers",
23:54 "B" (the socket has its own key).
Replaces: `serve(main, pages, options)` in `@tinker/bun`.

## What the user said

- 22:14: "the serve of the bun package is not a capsule
  on its own".
- 23:52: "embracing bun".

## Context

`serve(main, pages)` did two jobs:

- the process: signals, exit codes, `process.exit`;
- the port: `Bun.serve`, its routes, its page files.

It read `process.env.PORT` and `NODE_ENV` itself.
That broke the seam rule: only the cmd reads env.
Each app wrote the request glue by hand:
upgrade, then the bytes POST, then the route table.
A cmd that exited during start returned a fake
`{ fetch, closed }`.

## Precedent

- **Effect.** `BunHttpServer.layer({ port })` is a
  layer; `BunRuntime.runMain` owns signals and exit.
- **Go.** `http.Server` vs `main`.
- **Bun.** `Bun.serve({ routes, fetch, websocket })`:
  static routes, a fetch function, one socket handler.
- ADR 0056: the process runs outside any scope.

## Decision

1. `serve` is a capsule in `@tinker/bun`.
   It owns `Bun.serve` for the life of the scope.
2. Its config mirrors `Bun.serve`:
   - `port` (required);
   - `pages`: static files, Bun's own routes;
   - `websocket`: the one handler that brings Bun's
     `websocket` (Bun takes one per server);
   - `handlers`: more handlers, asked in order;
   - `paths`, `development`, `stdout`.
3. A handler is a capsule whose start returns
   `{ fetch, websocket?, maxBody? }`.
   `fetch` answers a `Response`, `null` (upgraded),
   or `undefined` (not its own).
4. `serve` goes first in `capsules`. Its start
   wraps the rest: it listens once all started.
   Its close stops the port first.
5. A handler in `handlers` that brings a `websocket`
   fails start with `MissingConfig { key: "websocket" }`.
6. `run(main)` is the host: signals and exit codes.
   `main` answers its root (`createScope`), or any
   `{ ready?, closed }`.
7. `ws.server`'s start also returns `fetch`.
   `upgrade` and `post` stay.

## Consequences

- A cmd is one `createScope`; no request glue.
- Only the cmd reads env.
- A scope stopped during start never opens the port:
  `next()` rejects after a stop (ADR 0134).
- Breaking: `serve(main, pages)` is gone. The
  template and Hedl move to `serve` and `run`.
