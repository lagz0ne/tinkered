# hono v1 — build progress

The first driver on `@tinker/core`: Hono stays at the **session level** — the entrypoint owns the
scope, `tinker(scope)` opens a session per request, routes are declarations (`handle(op, …)`)
that never see a handle (ADR 0039). New package `packages/hono` (`@tinker/hono`), `hono` peer
dependency, size cap 10 kB gzip, no core change.

- **Decision:** `docs/decisions/0039-hono-is-a-session-level-driver.md`.
- **Glossary:** `docs/glossary.md` → "Hono driver" (`driver`, `request session`, `handle`, `request` tag).
- **Gate + tag:** `scripts/ticket.sh hono <NN> "<title>"` → tag `hono/t<NN>`; `pnpm validate` gains hono lanes at t02.
- **Precedent:** React adapter ownership (ADR 0030/0031: provider owns/receives the scope, hooks never
  see it); Effect `HttpServer` (a request runs in its own fiber with request context).

## Surface (v1)

```ts
export const request: Tag.Handle<Request>;
export function tinker(
  scope: Scope.Handle,
  options?: { tags?: (c: Context) => readonly Tag.Binding<unknown>[] },
): MiddlewareHandler;
export function handle<T, I>(
  op: Operation.Handle<T, I>,
  route?: {
    input?: (c: Context) => unknown;
    respond?: (value: Awaited<T>, c: Context) => Response | Promise<Response>;
  },
): Handler;
// errors.ts: NoSession { label }
```

## Order & status

| tag      | ticket                                                                                 | blockers | status |
| -------- | -------------------------------------------------------------------------------------- | -------- | ------ |
| hono/t01 | Package + `tinker` middleware + `handle` + `request` tag; abort → cancelled; NoSession | —        | [ ]    |
| hono/t02 | Validation milestone: size, mutation, README + cast-free example, validate lanes; SHIP | 01       | [ ]    |

### Verify

- **t01** — with `createScope({ tags: [tenant("acme")] })`, `new Hono().use(tinker(scope, { tags: (c) => [tenant(c.req.header("x-tenant") ?? "public")] })).route("/", routes)`: `GET /users/42` (route = `handle(getUser, { input: (c) => c.req.param("id") })`, `getUser` depends on `tenant` and `request`, parses `"42"` → 42) answers `200 {"id":42,"tenant":"acme"}` when the header is `acme`, and `public` without it; the op saw `request.url` ending in `/users/42`. A void op with `handle(health)` answers `c.json` of its value; `respond` overriding returns `c.text(...)`. `app.request(path, { signal })` aborted while the op is parked on `ctx.signal` → the op's `defer` sees `cancelled` and the response promise rejects/aborts (state which, per Hono). `handle(op)` on a Hono without `tinker` → `NoSession` (through `app.onError`, assert the error kind). `scope.close({ graceful: true })` while a request is in flight resolves `success` after the response resolved; a forced close resolves `cancelled` and the in-flight op settles `cancelled`. Every test through `app.request`; no server; no mocks.
- **t02** — `vp run hono#size` ≤ 10240; `vp run hono#mutate` alone ≥ 60; README (main/routes/test shape from ADR 0039) + cast-free `examples/basic.ts`; `pnpm validate` gains hono lanes (tests, size, cast-free, pure bundle — `hono` import allowed, no `node:`); lead review SHIP; TODO archive entry.

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention shape rules, tests one promise each,
gate re-run, SCIP refs before/after for public symbols), then cherry-picks, runs the mutation lane
alone, tags.

## Reset

- Undo unlanded work: `git reset --hard hono/t<last>`; inspect: `git switch --detach hono/t01`.
