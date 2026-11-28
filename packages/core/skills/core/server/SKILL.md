---
name: server
description: >
  Use when an app serves HTTP: a long-running
  server, its routes from each feature, and
  middleware such as a body limit or a header
  check.
metadata:
  purpose: >
    Front controller and chain of responsibility
    as capsules: serve owns the port, routes
    takes tables and guards in list slots.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.34.20'
requires:
  - core
  - capsule
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
  - 'lagz0ne/tinkered:packages/bun/src/serve.ts'
---

# Server

A long-running server is three capsules. The
cmd joins them.

## Setup

`serve` from `@tinkered/bun` owns the port: it
listens once every handler started, and stops
the port first at close. A `routes` capsule is
its handler. Each feature gives a table to a
list slot. Each guard is an op in a list slot;
a Response stops the chain.

```ts no-check
// src/http/routes.server.ts
type Table = Readonly<
  Record<string, Operation.Handle<unknown, unknown>>
>;
type Guard = Operation.Handle<
  Promise<Response | undefined>,
  Request
>;

const table = tag<Table>({ label: "routes.table" });
const guard = tag<Guard>({ label: "routes.guard" });

export const routes = capsule({
  label: "routes",
  config: { table: table.all, guards: guard.all },
  hooks: {
    async start({ config, next }): Promise<Handler> {
      await next();
      const rows = new Map(
        config.table.flatMap((t) => Object.entries(t)),
      );

      return {
        fetch: async (request, scope) => {
          const path = new URL(request.url).pathname;
          const op = rows.get(`${request.method} ${path}`);
          if (!op) return undefined;

          for (const each of config.guards) {
            const stop = await scope.run(each, {
              input: request,
            });
            if (stop) return stop;
          }

          const rawInput =
            request.method === "POST"
              ? await request.json()
              : undefined;
          return Response.json(
            await scope.run(op, { rawInput }),
          );
        },
      };
    },
  },
});

// src/todo/routes.server.ts
export const todoRoutes: Table = {
  "POST /api/todos": add,
  "GET /api/todos": list,
};

// cmds/server.ts
capsules: [
  serve({ port, handlers: [routes] }),
  limits({ maxBytes: 64 * 1024 }),
  routes({
    table: [todoRoutes, issueRoutes],
    guards: [limits.bodySize, limits.jsonOnly],
  }),
],
```

- A guard is an op, so it has a span, its own
  deps, and a graph line. `limits.bodySize`
  answers 413 past `maxBytes`.
- A feature owns its rows. The cmd lists the
  tables, as it lists capsules.
- `serve` asks `/api/*`, `/rpc` and `/rpc/*`.
  More paths go in its `paths` key.

## Common mistakes

### HIGH: middleware as a plain function

A function that takes a request and calls
`next` has no span and no deps. The graph shows
nothing.

Right: write each check as an operation with
`input: z.instanceof(Request)`, and list it in
the `guards` slot. It answers a Response to
stop, or undefined to go on.

## Completion

- Each pattern's state is a cell that a test
  reads.
- Time comes from `ctx.clock`; tests use
  `makeTestClock()`.
- The graph shows `calls{slot:…}` for each
  slot.
- `tinker check` prints OK.
