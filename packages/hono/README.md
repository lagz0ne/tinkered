# @tinker/hono

A Hono server as a **session-level driver** (ADR 0039, 0040): the entrypoint owns the scope,
` tinker(scope)` opens one session per request, routes are declarations that never see a handle.

```ts
// main.ts (the entrypoint owns the scope)
import { Hono } from "hono";
import { createScope } from "@tinker/core";
import { tinker } from "@tinker/hono";
import { routes } from "./routes.ts";

const scope = createScope();
const app = new Hono().use(tinker(scope)).route("/", routes);
export default app;
await scope.close({ graceful: true });
```

```ts
// routes.ts (declarations: input off the request, respond back to it)
import { operation } from "@tinker/core";
import { handle, request } from "@tinker/hono";

const getUser = operation({
  label: "getUser",
  input: parseId,
  depends: { users },
  run: ({ users }, ctx) => users.find(ctx.input),
});

export const routes = new Hono()
  .get("/users/:id", handle(getUser, { input: (c) => c.req.param("id") }))
  .get("/health", handle(health));
```

```ts
// a test is an entrypoint: mount the middleware plus routes, drive via app.request
const scope = createScope({ tags: [tenant("acme")] });
const app = new Hono().use(tinker(scope)).route("/", routes);
const res = await app.request("/users/42");
expect(await res.json()).toEqual({ id: 42 });
```

Each request runs as an inline operation (`"GET /users/:id"`) whose one dependency is the
route's operation — so core's spans, one `http request` log line, clock, and signal come for
free. A client abort force-closes the session; without `tinker` upstream, `handle` raises
`NoSession`.

## Errors

| failure                    | status                                    |
| -------------------------- | ----------------------------------------- |
| op input parse fails       | 400                                       |
| request cancelled (abort)  | 499 (logged, then Hono rejects as before) |
| `MissingTag` / `NoSession` | 500                                       |
| anything else              | rethrown to Hono's `onError`, no log line |

`tinker(scope, { onError: (e, c) => Response | undefined })` answers first; `undefined`
falls through to the table. A mapped failure settles the request span `ok`.
