# Start scaffold: graph before code

Date: 2026-10-02.
Status: module split accepted; runnable proof built.
Full native inspection remains a draft.
The graph and rationale come before app code.
The [state sync and result rules](STATE-SYNC.md) are accepted.
The runtime now includes a public counter and protected profile and todo pages.
Both page kinds use the same execution and sync rules.
The current transport is native SSE, woken by Postgres after commit.
Core traces and Pino logs export to a local Victoria stack.
The [registry split](REGISTRY.md) keeps fixed setup updates away from feature files.

[Current feature code and graph](https://p-32fb45e2fd6a.preview.tini.works).
[Edit the sync graph](https://tldraw.tini.works/r/314eb38f07b44c469c2007bef0c558ea).
[Edit the storage graph](https://tldraw.tini.works/r/6da0f43503124591b21cba7b73233f8d).
The original [scope bridge sketch](https://diashort.tini.works/d/6bb9fd78)
records the first design below.
Current fixed files live in `src/scaffold/`; the runnable app README names them.

![Scaffold graph](https://diashort.tini.works/e/6bb9fd78)

## Aim

Build one small TanStack Start app.
Use only `@tinker/core` and `@tinker/react` from Tinker.
Use Start, Better Auth, Drizzle, Postgres, SMTP, and Pino directly.
Use shadcn for view components and Tailwind for style.
Keep the domain graph testable without starting Start.

The first useful flow is sign in, read your profile, and save your name.
Email checks and password resets exercise mail sending.
A devtool shows backend and frontend scope facts.

The user chose separate modules inside one Start app.
The [runnable proof](../../../apps/start-scaffold/README.md) tests that split.
The full inspection design is still open.

## Precedent

The model is a composition root, request middleware, and a database transaction.
The entry owns the root and stop signal.
Middleware owns each request's lifetime.
A write answers only after its transaction commits.

This follows the repo's [authoring guide](../../best-practices.md),
[two hands rule](../../decisions/0051-drivers-are-extensions-the-scope-has-two-hands-wiring-is-flat-rows.md),
and [root lifetime rule](../../decisions/0085-a-root-owns-its-lifetime-a-stop-signal-closed-and-ready-after-cleanup.md).

## Split the code by where it runs

App path: `apps/start-scaffold`.

```text
src/
  backend/
    index.ts
    database.ts
    auth.ts
    mail.ts
    profile.ts
  frontend/
    index.ts
    state.ts
    actions.ts
    App.tsx
    ui/
  contracts/
    profile.ts
  transport/
    profile.functions.ts
    start.ts
    entry.server.ts
    body.server.ts
  telemetry/
    index.ts
  routes/
    __root.tsx
    index.tsx
    api.auth.$.ts
  errors.ts
  start.ts
  server.ts
  client.tsx
  router.tsx
```

- **Backend** declares resources and operations.
  Its public entry has no Start import.
  Tests import that entry and use Core roots.
- **Frontend** declares cells and actions and uses Tinker React hooks.
  Its graph holds no database, secrets, or server imports.
- **Contracts** hold input schemas and public response types.
  They carry no live client or scope.
- **Transport** owns the Start boundary.
  Server functions import backend units only inside server implementations.
- **Telemetry** owns logs and inspection state.
  A resource owns native Pino and its flush.
  Pino's package exports choose Node or browser code.

Start's import rules must reject `backend/**` from the browser build.
They must also reject `pg`, server-side Better Auth, and SMTP imports there.
Keep the default `*.server.*` and `*.client.*` rules when adding directory rules.
Make violations fail in dev and build.
Do not use a barrel that exports backend and frontend code together.
These rules use Start's [import protection](https://tanstack.com/start/latest/docs/framework/react/guide/import-protection).

Frontend graph code may run during server rendering.
Only browser APIs belong in `*.client.ts` files.
Routes and loaders use server functions to reach backend actions.
Start documents this [execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model).

## Units and owners

The database resource belongs to backend userland.
The app owns its driver, settings, schema, and migrations.
The Start bridge controls scope lifetime and resolves the app's declared units.
It does not own the app's database choice.

Service libraries load inside the resource factory or action that uses them.
Type imports stay at module level and add no runtime load.
Each database branch loads only its chosen driver and migrator.
Record mail loads no SMTP client.
Query actions load their table modules and Drizzle operators when they run.
This keeps a static action import from loading those libraries through its schema.
The entries await the Pino resource before binding the observer.
JavaScript shares the imported module; the app adds no import cache or helper.

- **Tags: fixed facts.**
  Bind `databaseSettings`, `authSettings`, and `mailSettings`.
  A request binds a fixed copy of its headers.
  Each binding stays fixed for its owner.
  Changing frontend state belongs in cells.
- **Scope resources: shared connections.**
  `pool` opens Postgres and owns its close.
  `database` builds Drizzle on that pool.
  `mail` opens the mail sender and owns its close.
- **Session resources: request facts and writes.**
  `auth` builds Better Auth using the shared database.
  `principal` reads the user from the request cookie.
  `currentUser` requires that user and refuses a signed-out request.
  `transaction` holds one write session's database transaction.
- **Operations: actions.**
  `handleAuth`, `readProfile`, `saveProfile`,
  `writeProfile`, `migrate`, and `sendMail` name real work.
  `writeProfile` is the storage action inside `saveProfile`.
  It runs after `currentUser` resolves so a refused call opens no write transaction.
- **Data: mutable view and tool state.**
  Frontend cells hold `profile`, `nameDraft`, `pending`, and `notice`.
  Telemetry cells hold bounded span history.
  Backend rows stay in Postgres.
- **Extensions: automatic work around the graph.**
  The app-local Start extension connects middleware to Core lifetime.
  Observation follows Core units and events.
  The app borrows observer callbacks from the separate telemetry graph.

These declarations are static.
Importing them opens no connection and starts no scope.
Factories own live clients; `defer` releases them.
App actions declare `depends`; they do not receive a scope or context bag.

## Request lifetime

The Node entry creates the backend root and its stop signal.
Its Start extension binds request middleware during `start`.
Only the entry and that extension hold the root.

Global Start request middleware opens one request session.
It covers server functions, server routes, and server rendering.
Keep Start's CSRF middleware explicit in `src/start.ts`.
CSRF means rejecting calls made by a different site.
Start describes these rules in its [middleware guide](https://tanstack.com/start/latest/docs/framework/react/guide/middleware).

```text
request middleware
  open request session
  bind headers and cancellation
  run next inside the request binding
    server function
      run saveProfile in an owned action session
        resolve currentUser
        writeProfile
          resolve transaction
          write row
        commit and await cleanup
      return the saved profile
  finish the response body
  close the request session
```

Each write call owns a child action session.
Its transaction ends before its result crosses the Start boundary.
An auth failure, raised error, or cancelled action rolls the write back.
A commit failure becomes a failed call, never a success response.
Handled action failures must not stop the server root or another request.

Use `settle` at the host boundary where an error becomes an HTTP result.
Use `run` for subflows where failure must fail their action.
Do not catch and erase a failed write.
Do not infer a transaction outcome from the final HTTP status.

A response can carry a stream.
Returning `Response` is not proof that the stream ended.
Keep the request session alive through body end, stream error, or cancel.
The host owns that response adapter and tracks its cleanup.
After headers leave, a stream failure can stop the stream and record the error;
it cannot change those headers to a new status.
Start's [server entry](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point)
uses a Fetch-style request and response boundary.

A process stop first stops accepting requests, then lets owned work finish.
A request or action signal cancels only that caller's work.
Core's root `signal` requests graceful shutdown; it does not cancel active work.
Await `closed` and its teardown result.
Never close the root again after failed `ready`.

## The native Start bridge

The user chose Start's native context on 2026-10-02.
The middleware belongs to the `startRequests` Core extension.
The server entry installs that extension and awaits root startup.
It resolves the extension's binding and supplies it to Start's fetch context.

The middleware reads that trusted scope binding.
If it is absent, it raises `StartScopeMissing` before opening a session.
It never starts the backend on its own.
It opens one request session and passes it through native middleware context.
Only server functions and server routes use that session to run Core actions.
Domain operations use declared dependencies and subflows.
Views still use Core hooks without receiving a scope or context bag.
The session is never sent through client `sendContext`.

One native middleware object is shared by reference.
Register it globally and reuse it on server functions and route-level middleware.
Start skips a request middleware reference that already ran.
Handler-specific route middleware has a different path in the installed version.
Use route-level middleware for this shared lifetime rule.

Keep middleware declarations in their own module.
A module that also declares server functions can be split by the Start compiler.
That split can create two middleware identities and defeat deduplication.
The built-Start proof must cover the actual module split and direct SSR calls.

Response stream code remains beside the host boundary.
It closes the request after body end or cancel and tracks cleanup.
No app AsyncLocalStorage or current-session module store is part of this design.

The skills already ship with the installed Start packages.
The app's `AGENTS.md` loads them through TanStack Intent.
Shadcn owns visual components; Core still owns actions and mutable app state.

## Auth, permission checks, and the database

Use Better Auth's browser client for sign in and sign out.
Frontend operations call that client so the actions remain observed.
The auth catch-all route runs `handleAuth` inside the request session.
Keep `tanstackStartCookies()` last in Better Auth's plugin list.
This follows [Better Auth's Start integration](https://better-auth.com/docs/integrations/tanstack).

The `auth` resource targets the session.
Its mail callbacks capture request-bound `sendMail` subflows.
A shared root auth object must not capture the first caller's request session.
The database pool remains shared across requests.

Auth tables and app tables use the same Postgres database and migration history.
Use Better Auth's [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
with `provider: "pg"` and an explicit schema.
Use Drizzle's [node-postgres driver](https://orm.drizzle.team/docs/get-started-postgresql).
Generate and review auth tables, then apply Drizzle migrations.

The first permission rule is: a user may read and change their own profile.
The `currentUser` resource derives that user from the server session.
Each action reads its ID from that resource.
The public save input contains a name, not a caller-chosen user ID.
Each private action depends on it even when the route already checked sign in.
Auth writes use Better Auth's transaction rules.
Do not claim that its writes and app writes share one transaction merely
because they share a database.

## Mail

`sendMail` depends on the reusable SMTP resource.
Auth callbacks await that operation.
Tests replace the mail resource with a recording sender through Core presets.
They do not patch Better Auth or a global mail function.

The first contract is SMTP acceptance, not proof of inbox delivery.
No automatic retry or job queue is implied.
App mail runs after a successful app commit.
A failed send must not claim to undo an already committed row.
Durable retries would need a separate design for an outbox,
a database table of mail still waiting to be sent.

## Frontend lifetime and server rendering

Create one view root per browser tab and one per server-rendered request.
Reuse declarations, never a live frontend scope, across users.
Use the same public initial values for server output and the first browser render.
Only public data crosses that boundary.

Use the entry-owned form of `ScopeProvider` for server rendering.
Its `create` form starts in an effect and renders nothing on the server.
Likewise, do not put server-rendered content behind `SessionProvider`,
whose session also starts in an effect.
The source proves this at [ScopeProvider](../../../packages/react/src/index.ts)
and its session provider.

The framework-called entries own this setup.
Core's native provider binding is the one place the entry supplies its scope
to React; app views use hooks and never pass the scope to other views or helpers.
The tab entry owns stop and hot-reload cleanup.
The server view root ends with its response stream.
Verify first HTML and browser hydration before choosing the exact router wiring.

## Observation and devtool

Core already supplies operation and resource spans, log callbacks,
trace IDs, and bounded completed span history.
App code uses `ctx.log`; the observer sends the records to Pino.
Use one declared Pino resource for each telemetry root.
Its package exports select the right Node or browser code.
Node Pino writes synchronously to its local destination.
A separate bounded queue flushes storage on the owner's close.
Browser records use a same-origin Start ingest route.
Core's original host and request stop signals cancel stalled reads.
VictoriaTraces receives OTLP JSON; VictoriaLogs receives Pino JSON lines.
Pino's [browser API](https://github.com/pinojs/pino/blob/main/docs/browser.md)
supports structured objects and a custom writer.
Do not import Node Pino transports into the browser.

The telemetry root is separate from the observed app root.
It owns Pino, bounded tool state, and export operations.
Keep its own observation off to avoid observing its own log delivery forever.
Close app work first, then flush and close telemetry.

Core does not currently expose the full required live scope view.
`useSpans` is a snapshot of completed history, not a live subscription.
The resolve hook misses dependency reads and session reads.
An app extension cannot truthfully reconstruct every resolved node with that hook.

The full requirement needs a native Core inspection surface.
Proposed names, pending a separate API review:

```text
scope.inspect()
  scope: id, parentId, state
  nodes: id, kind, label, ownerId, state
  edges: fromId, toId, mode
  work: id, unitId, state, start, end

observe.event(event)
  kind: "resource.ready"
  scopeId: "request-7"
  unitId: "database"
  ownerId: "server"
```

Core must emit these facts where the actual work happens.
Include cache reuse, dependency resolution, writes, active work, and cleanup.
Data writes name the cell and owner; values are hidden by default.
Do not copy tokens, cookies, mail bodies, or connection settings into the tool.
Use IDs to distinguish units or namespaces with the same label.
Observer failures must not change app results.

Metrics derive from these events: calls, failures, time, active work,
resource builds and reuse, writes, and teardown errors.
The devtool reads tool cells through `useData`.
Backend snapshots and events travel through a dev-only endpoint;
frontend events stay local to the tab's telemetry root.
Keep the devtool out of production builds.

Trace propagation belongs to the Start boundary.
The browser sends a trace parent, not its scope or observer object.
The backend joins that trace after validating it.
Use operation cancellation at the same boundary.
Check the pinned Start version's native call and fetch options first.

Automatic coverage means all Core units and owned work on both sides.
Core cannot see individual calls inside an opaque SDK on its own.
Use native SDK callbacks where deeper facts are needed.
React mount and hook activity also need native React adapter events
if those facts are part of the requested devtool.
Do not call either gap complete by adding wrapper helpers in the app.

## Proof before code lands

- **Domain seam:** a small Core root can read and save a profile.
  A refused user writes nothing.
  A failed write rolls back; a failed commit never returns success.
- **Auth seam:** real Better Auth and a test Postgres database support
  sign up, sign in, sign out, email checks, and password resets.
  The recording mail sender proves the sent links.
- **State seam:** frontend actions update the right cells through Core.
  Cancelling an action leaves the tab root usable.
- **Host boundary:** concurrent requests keep users apart.
  An ended or cancelled body closes its request exactly once.
  A slow streamed response keeps its scope until the body ends.
- **Build boundary:** the browser output contains no backend modules,
  database driver, SMTP client, or server secrets.
  Server and browser builds each select Pino's native code.
- **Rendering:** first HTML contains the page.
  Hydration preserves it without losing or sharing view state.
- **Devtool:** a dependency built inside a session appears with its real owner.
  Live work and metrics update without hand-instrumenting each app operation.
  A broken observer does not break the action.

Most tests use public operations through a small scope.
Only boundary tests boot Start or a browser.
No helper tests, global patches, or copied implementation checks.
Use a real isolated Postgres database for Postgres-specific promises.

The landing checks are build, `vp check`, each package's tests, and prose.
Core changes also need the Core ticket gate and the existing size checks.
No timing claim is part of this design.

## Chosen split

- **One Start app, separate modules.**
  Hard build rules keep backend code out of the browser.
  Direct server calls and one origin keep the boundary small.
  This is the proposed graph.
  The user chose this split on 2026-10-02 and asked for proof code.
  The proof tests the host boundary before any Core inspection API change.
  Record the lasting decisions after those checks, then split the remaining work.
