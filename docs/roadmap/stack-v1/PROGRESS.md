# stack-v1 — the default stack for every web app

The design: ADRs 0074–0083. ADR 0078 (an entry runs
only as main) is the root rule it builds on.

Research and the round log: `RESEARCH.md` in this
folder.

Rules for every ticket:

- The tracker moves onto the stack first. The
  generator comes last.
- A stack piece is an extension. The app touches
  only operations, resources, data, and namespaces
  (ADR 0081).
- A new package gets size, test, and mutate lanes.
  The mutation floor is 85.
- A public symbol that changes across packages gets
  an impact block first (ADR 0065).
- A bug fix comes with a test that fails without it.

## Tickets

- **t01 sync ships the SSE transport** -- [ ] blocked by: none
  `@tinker/sync/sse` carries the protocol over SSE
  down and POST up, both halves (ADR 0077). The
  server half takes a plain chunk writer, so sync
  imports no Hono. The tracker and the sync example
  drop their own copies.
  Verify: `vp run sync#test` and
  `vp run @tinker-issue-tracker#test` green; SCIP
  refs show no hand-written SSE transport left.
- **t02 hono answers managed errors** -- [ ] blocked by: none
  A managed error becomes its HTTP answer through
  `@tinker/hono`. An unmapped error is logged and
  answered 500. The tracker's hand mapping goes.
  Verify: `vp run hono#test` covers each answer;
  the tracker's tests pass unchanged.
- **t03 Drizzle 1.0 RC, pinned** -- [ ] blocked by: none
  The repo runs on one exact 1.0 RC of
  `drizzle-orm` and the matching `drizzle-kit`
  (ADR 0079). `@tinker/drizzle` and the tracker
  behave as before.
  Verify: `vp run -r build`, `vp check`,
  `vp run drizzle#test`, and the tracker's tests
  green.
- **t04 core: a span carries a trace id** -- [ ] blocked by: none
  Every span gets a trace id when it opens, from
  its parent or from a seed a driver gives
  (ADR 0076). Hono seeds it from `traceparent`.
  Core imports no OTel.
  Verify: `vp run core#test`, `vp run hono#test`,
  `scripts/ticket.sh`, `pnpm validate`; the impact
  block matches SCIP refs.
  Impact (ADR 0065); the writer adds a row per new
  public symbol:

  ```impact stack/t04
  core Observe/Span# src/index.ts tests/*.test.ts
  ```

- **t05 stack: server start and shutdown** -- [ ] blocked by: none
  `@tinker/stack` exists. Its server stack piece
  opens the port, stops on a signal, answers an
  exit code, writes JSON logs, and serves the built
  client. The tracker's entry uses it; its root
  stays one function (ADR 0078). A bad setting
  stops boot and names every key of that piece
  (ADR 0081).
  Verify: `vp run stack#test` boots, stops, and
  fails boot on a bad `PORT` naming it; the
  tracker's tests pass.
- **t06 the migrate step** -- [ ] blocked by: t03, t05
  The tracker's tables come from migration files.
  At boot and in test setup the migrate step takes
  a Postgres lock, then runs Drizzle's migrations
  (ADR 0079). An old tracker database gets a
  baseline. Tests build one migrated database and
  clone it per test.
  Verify: a test fails when the schema code and the
  files differ; a test opens an old tracker
  database and keeps its rows; drizzle, stack, and
  tracker tests green.
- **t07 nats stack piece** -- [ ] blocked by: none
  `@tinker/nats` checks `NATS_URL` at start and
  connects (ADR 0080). A subscription runs an
  operation in its own session. The `traceparent`
  header waits for the trace id: it is in t13. Tests start a real
  `nats-server`, pinned, checked by checksum, and
  fetched once into a cache.
  Verify: `vp run nats#test` against a real server;
  a missing `NATS_URL` fails boot naming it.
- **t08 jobs stack piece** -- [ ] blocked by: t06
  `@tinker/jobs` runs pg-boss as a driver. Each
  job's operation runs in its own session: success
  commits, failure rolls back and retries
  (ADR 0075). A job added in a request's
  transaction exists only if the request commits.
  Cron works through pg-boss. The migrate step
  starts pg-boss after Drizzle.
  Verify: `vp run jobs#test`: a rolled-back request
  adds no job; a failing job retries; nothing hangs
  on PGlite's one connection.
- **t09 mail stack piece** -- [ ] blocked by: t08
  `@tinker/mail`: the app calls `sendMail` with a
  React Email template and its props. That adds a
  mail job, which renders and sends through Upyo,
  pinned (ADR 0083). `MAIL_URL` is checked at
  start. Dev logs each mail; tests read Upyo's
  mock.
  Verify: `vp run mail#test`: a committed request
  sends one mail, a rolled-back one sends none; a
  missing `MAIL_URL` fails boot in prod.
- **t10 auth: sign-up and sign-in** -- [ ] blocked by: t06
  `@tinker/auth`: Better Auth, pinned, mounted at
  `/api/auth/*` through the Hono wiring (ADR 0075).
  Its tables live in the `auth` schema and come
  through our migrations. The signed-in user is
  read before the request's transaction opens.
  Verify: `vp run auth#test`: sign up, sign in,
  read the user in an operation, sign out, and no
  request hangs; a test fails when the generated
  auth schema differs from the committed one.
- **t11 auth mails: verify and reset** -- [ ] blocked by: t09, t10
  Sign-up sends a verify mail. A reset request
  sends a reset mail. Both go through `sendMail`.
  Verify: `vp run auth#test` reads both mails from
  the mock and follows their links.
- **t12 live updates across server processes** -- [ ] blocked by: t07
  After a commit, one server tells the others over
  NATS. Each re-reads from the database, and its
  tabs get the snapshot (ADR 0080). The tracker
  uses it.
  Verify: two server scopes on one PGlite and a
  real `nats-server`: a save through one reaches a
  subscriber on the other.
- **t13 the trace sink** -- [ ] blocked by: t04, t05
  The stack sends spans and logs over OTLP to
  `OTEL_EXPORTER_OTLP_ENDPOINT` (ADR 0076). NATS
  messages carry `traceparent` (ADR 0080). A
  missing endpoint stops boot, as for every stack
  piece.
  Verify: `vp run stack#test` against a local OTLP
  receiver: one request gives one trace with all
  its spans.
- **t14 the dev host** -- [ ] blocked by: t06, t07
  `vp run dev` is one process that keeps PGlite,
  `nats-server`, and Vite open (ADR 0082). An edit
  re-imports the app, closes the old scope, and
  starts a new one with the kept handles. Only the
  dev host and the test helper bind defaults. It
  settles how ADR 0078's root takes the kept
  handles and the port.
  Verify: a test edits a server file: the old scope
  closes, the new one serves, nothing leaks;
  `benchctl ab` says a reload beats a restart.
- **t15 server pages** -- [ ] blocked by: t14
  The tracker's list page renders on the server
  with TanStack Router under one Hono route
  (ADR 0075). Its cells cross to the browser
  through the router's dehydrate and hydrate, and
  the browser boots from them. The page route holds
  the request's session until the stream ends.
  Verify: the tracker's browser test sees the list
  in the first HTML and live updates after
  hydrate; the tracker's tests green.
- **t16 the generator** -- [ ] blocked by: t01, t02, t11, t12, t13, t15
  `vp create` writes a full app with every stack
  piece wired, each shown in its common case as an
  operation or a resource (ADR 0074). It is the
  stack's second app. It may split in two when it
  starts: the skeleton, then the other pieces.
  Verify: a freshly generated app passes
  `vp check` and its tests, and boots in dev and
  prod.

## t05 writer notes

Owner: stack/t05 writer. Branch: `stack/t05`.
Writer checks complete. Next: lead review and landing.
Verify: stack and tracker tests, browser proof, gate,
`pnpm validate`, stack mutation at least 85.

### Impact before code

- Add `@tinker/stack`; no existing package API changes.
- Move `jsonLines` and `describeError` from the tracker
  to the stack. Update tracker imports and move their
  tests to the new package's public entry.
- Remove the tracker's `BadPort` error.
  Its callers are `readPort` and the config tests.
  A stack `BadListenSettings` payload lists bad keys.
- Keep `issueServer` and its optional `serve` test seam.
  The root lists the stack listener before it.
- The full root remains `runServer` in `main.ts`.
  The stack takes a borrowed scope only to wait and close;
  it never creates one.
- Review: index stack with `scripts/scip.sh index stack`;
  check refs for `jsonLines`, `describeError`, and `server`.
  Check removed tracker names with `git grep BadPort`.

### Choices

- Pass env as an argument: this piece alone reads it,
  once in `start`, before other starts run.
- The tracker keeps `4311` and `127.0.0.1` in its root.
  The stack has no missing-key defaults.
- HOST means an IP address or a DNS host name.
  Empty names, URLs, and spaces are bad settings.

### Core feedback: start logs are dropped

An extension start gets a ctx whose log does not
reach the scope sink.
This public-seam check fails: the actual list is empty.
The stack passes the root's sink into its listener
piece and writes the listen line there.

```ts
const lines: string[] = [];
const scope = createScope({
  observe: { log: (e) => lines.push(e.message) },
  extensions: [
    extension({
      label: "boot-log",
      start: (_scope, ctx) => ctx.log("hello"),
    }),
  ],
});
await scope.ready;
await scope.close();
expect(lines).toEqual(["hello"]);
```

### Review notes

- Env is an argument because only this piece reads it.
- The root supplies the clock for stop logs.
  The package does not read ambient time.
- The tracker still uses `@hono/node-server` in test
  fixtures, so it stays as a pinned dev dependency.
- Workspaces already include `packages/*`.
  The root has no package tsconfig references to add.
- Added stack test, size, and mutation lanes and the
  driver entry in `scripts/two-hands.sh`.
- `main..HEAD` also included the upstream entry fixes.
  Their existing Jev labels remain in the bank.
  The sync tour's local resource captures its local
  memory wire; that code was not changed by t05.
- Jev found a missing README error name for a non-text
  draft prompt; the README now states `BadDraftInput`.

### t05 proof

Rebased on `origin/main` at `de72d42`.
No push. The board card is in Review for the lead.

The gate:

```sh
vp run -r build && vp check \
  && vp run stack#test \
  && vp run @tinker-issue-tracker#test
```

```text
Build: passed
Check: 0 errors, 29 warnings
Stack: 38 tests passed
Tracker: 69 tests passed
EXIT 0
```

The main check also printed 0 errors and 29 warnings.
It ran in a separate clean worktree, now removed.

- `vp run --no-cache -r test`: all 16 tasks passed.
- Browser proof and 7 browser helper tests: passed
  again after the first rebase, with caches off.
- `pnpm validate`: all 46 lanes passed, exit 0.
- Stack size: passed the 10 kB gzip cap.
- Prose lint: 0 hits.
- Style census: OK, including touched tracker files.
- SCIP: `BadPort` has no tracker refs.
  The new helpers have refs in the tracker's root
  and server pieces; stack has its own index.
- No S27 or S28 row in stack or tracker.
  `plain.mjs` exports the checks; the runnable lint
  is `lint.mjs` with the token file disabled:

```sh
JEV_TOKEN_FILE=/dev/null node tools/jev/lint.mjs \
  packages/stack/src apps/issue-tracker/src
```

Mutation ran once, at the end, in the foreground:

```sh
flock /tmp/mutation.lock \
  vp run --no-cache stack#mutate
```

```text
All files: 87.68
Killed: 176
Timeout: 2
Survived: 25
No coverage: 0
Errors: 0
Floor: 85
EXIT 0
```

Jev pre-flight, stack tests and promises, and the
changed tracker test files were reviewed.
The stack had no test flags or missing promises.
The tracker README now also says a finished draft
saves nothing until Post draft.
New labels saved in `tools/jev/cases.jsonl`:

- `leakedInternal false`: tracker `src/index.ts`.
  This private app entry is its public test seam.
- `leakedInternal false`: tracker `src/server/draft.ts`.
  These are authoring units used by the root and tests.
- `effectWithoutDefer false`: stack `server.ts#listen`.
  Its caller registers cleanup before the bind wait
  and closes a late listener if close already ran.

These matching labels were already in the bank:
`inputDefaultMasks false` for `readPrompt`, and
`stateOutsideCell false` and `stopOnlyInDefer false`
for the upstream sync example's `posts` resource.
The upstream MCP entry flags also had saved labels.
The lead runs calibration when landing these labels.
