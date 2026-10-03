# Services routing brief

Owner: lead (Claude, Start scaffold session); Sol routing writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0098 to 0101 and `tools/flight-trial/README.md`.

## Goal

The trial services route through Hono, not through Tinker.
Each handler reads only its params and calls `.run` on one operation.
HTTP behavior stays exactly the same.

## Precedent

The Start scaffold already works this way.
See `apps/start-scaffold/src/scaffold/start.ts`:
an extension's `start` hook hands over the scope,
middleware opens a session per request,
and each route handler runs one operation.
Copy that shape; Hono's `c.var` plays the role of Start's `context`.

## Today

- `services/supplier/index.ts` and `services/payment/index.ts`
  each have `dispatch`, `action`, `lookup`, `supplierControl`
  or `paymentControl`, and `route` operations.
  They take a whole `requestSchema` request and pick work by route name.
- `services/http.ts` has `control` and `decodeBody`, also by route name.
- The listener resource builds a Node server by hand.

## Do

1. Add `hono` and `@hono/node-server` from the workspace catalog
   (add catalog rows if missing).
2. One Hono app per service, routes written with Hono:
   `app.post("/air/offer_requests", ...)`, `app.get("/air/offers/:id", ...)`.
   A handler reads its params (path param, JSON body, one header),
   then returns `c.json(await scope.run(op, { rawInput: params }))`.
3. Cross-cutting parts become Hono middleware, each running one operation:
   - the call log (record, then set the status after `next()`);
   - the control token check on `/control/*`;
   - route rules: delay, injected failure, saved replay.
4. Form bodies (payment): Hono's `c.req.parseBody({ all: true, dot: true })`
   or a small middleware; drop `decodeBody` if Hono covers it.
   Keep the `__proto__` guard and the `true`/`false` rule.
5. The Node listener stays owned by a resource (ADR 0100).
   It serves the Hono app; middleware puts the scope in `c.var`.
   No `createScope` outside `main.ts`.
6. Delete every operation that takes a whole request or reads `route`.
   Delete `requestSchema` if nothing uses it.
7. Shared parts (rules, calls, token, clock) live in one place
   for both services, not copied.
8. Update `tools/flight-trial/services/PLAIN.md`;
   the plain-function count must not grow.

## Proof, all by exit code

1. No operation input has `route`, `path`, or a whole request
   (`grep -n "requestSchema\|route ===\|startsWith(\"/" services` finds none).
2. All existing tests pass unchanged, except tests that called
   the removed dispatch operations; those now go through HTTP.
3. The four-process proof from the services card passes.
4. Mutation for `tools/flight-trial` is 85 or more, run alone under
   `flock /tmp/mutation.lock`. Nothing new excluded.
5. Workspace build, `vp check`, all tests, and prose pass.

## Limits

- Work only in your worktree; commit per step.
- Change only `tools/flight-trial/services/`, `tools/flight-trial/tests/`,
  `tools/flight-trial/package.json`, `docs/roadmap/flight-trial/`,
  `pnpm-workspace.yaml` (catalog only), and the lockfile.
- Do not change the wire contract: paths, bodies, status codes, headers.
  The rounds and harness depend on it.
- Do not change Core, React, `apps/`, or `tools/writer-trial/`.
- Do not use `git stash`.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
