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

## t06 writer — 2026-09-29

- Owner: stack/t06 writer.
- State: Review.
- Next: lead review and landing; the writer has not pushed.
- Verify: build, check, drizzle, stack, tracker, browser,
  validation, and both mutation lanes at or above 85.
- Assumption: the tracker's schema stays `public`.
  Its Kit config filters only `public`.
- Assumption: a transaction holds the advisory lock.
  All Drizzle work uses that transaction's connection.
  Commit or rollback releases the lock before serving.
  A later pg-boss start can follow it under its own lock.

### Impact written before code

- Precedent: Rails boot migrations and Postgres transaction locks.
- Add `migrateDatabase`, `checkDrift`, and `Migrations`
  at `@tinker/drizzle/migrations`.
  The main Drizzle entry keeps its current imports.
- Add `migrate`, `Migrate`, and `createTestDatabase`
  and `TestDatabase` at `@tinker/stack`.
- The tracker adds `migrations` and `migrateIssues`.
  `store.config` also accepts a borrowed PGlite handle.
  The store opens the db; the migrate piece makes tables.
- Callers: tracker server root and every test that opens
  its store; operations keep the same table imports.
- Move table declarations to the tracker's schema file.
  Store re-exports keep those imports working.
- SCIP review: index drizzle, stack, and tracker.
  Check refs for `migrateDatabase`, `checkDrift`,
  `migrate`, `createTestDatabase`, and `migrateIssues`.
  No public symbol is removed.

### t06 implementation checks

- First package gate: 18 Drizzle tests and 42 stack tests pass.
  The changed files have no lint or type warnings.
- Kit generated `20260929165528_tracker` from the schema.
  The drift test passes on that folder and rejects a temp copy
  with an extra column, without changing migration files.
- The old-db tests cover all eight hand-SQL states.
  They keep every existing value and compare columns and indexes.
- Test roots borrow clones; disk restart checks still use files.
  A store closes only a client it opened itself.
- PGlite types its clone as an interface that Drizzle rejects.
  The test helper narrows that known PGlite clone in one place.
- Boot now logs migration queries before listener validation.
  The PORT tests read the boot result and await child exit.
- Test setup hit Vitest's 10-second hook limit under host load.
  The tracker now uses two workers and a 30-second hook limit,
  matching its existing per-test limit.
- Jev's package test checks have no flags.
  The tracker keeps three old helper-count notes.
  No plain helper-count judge exists in the label tool.
- One missing browser-test promise gained a README line:
  posting a draft saves one comment and one activity.
- SCIP refs name the planned package and tracker callers.
- Core feedback: none; no Core workaround was needed.

### t06 final gate and review

- Fetched and rebased on `origin/main` at `cfaeae71`.
  Both required base tickets are ancestors of that commit.
- The gate passed with `EXIT 0`:

```bash
vp run -r build && vp check \
  && vp run --no-cache drizzle#test \
  && vp run --no-cache stack#test \
  && vp run --no-cache @tinker-issue-tracker#test
```

```text
check: 0 errors, 29 warnings (same as the base)
drizzle: 18 passed
stack: 42 passed
tracker: 79 passed
EXIT 0
```

- The failure test also checks that no listening event is sent.
  The 42 stack tests passed again after this stronger check.
- The uncached browser proof passed, including all 7 helper tests.
- `vp run --no-cache -r test`: all 16 tasks passed, `EXIT 0`.
  There is one unchanged skipped test in the tinkerer suite.
- Strict style census: OK.
  TSDoc: 0 S26 rows in the checked files.
  Prose lint: 0 hits.
- Jev promises: no gaps in 18 Drizzle, 16 stack,
  and 78 tracker titles.
- Jev preflight: one model flag, labelled false.
  The app entry exports settings and its migrate piece for roots
  and public tests; `baselineIssues` stays private.

```text
leakedInternal false
apps/issue-tracker/src/index.ts
e8edd103cf81
```

- The local test resource captures that call's PGlite.
  It cannot move to module scope; the plain-code flag needs no label.
- The `~wrapsCallersStep` note is noisy and needs no label.
  `migrate` builds the extension that owns the boot order.
- `pnpm validate`: all 46 lanes passed, `EXIT 0`.
  The job held `/tmp/mutation.lock`.
  `allowBuilds.esbuild` was already true;
  `pnpm-workspace.yaml` was restored after validation.
- Both mutation lanes ran under the same lock.
  Both used two workers and a 60-second limit from the start,
  following the user's load warning.

### t06 mutation proof

- Drizzle: 87.16, above the floor of 85, `EXIT 0`.
  95 killed, 0 timed out, 14 survived, 0 uncovered, 0 errors.
  One full run, two workers, `--timeoutMS 60000`.
  The new migration file scored 86.00 on its own.
- The seven new survivors cover the empty-folder guard
  and checks on Kit's JSON shape.
  Real matching and changed schemas both passed the tests.
- Source files are unchanged after the run.
- Stack: 87.05, above the floor of 85, `EXIT 0`.
  193 killed, 2 timed out, 29 survived, 0 uncovered, 0 errors.
  One full run, two workers, `--timeoutMS 60000`.
- The two timeout rows are in `src/migrate.ts`, lines 27 and 28:
  a required baseline call and an empty migration-options object.
  Kills alone are 193 of 224, or 86.16 percent, still above 85.
  Two of 224 timed out with the longer limit; no rerun was needed.
- One outer `flock /tmp/mutation.lock` held the lock through
  validation and both mutation commands:

```bash
vp run --no-cache drizzle#mutate \
  --timeoutMS 60000 --concurrency 2
vp run --no-cache stack#mutate \
  --timeoutMS 60000 --concurrency 2
```

- Final source diff after Stryker: empty.
  No work remains for the writer; the card is in Review.
  Nothing was pushed.

### t06 review fix round 1

- Owner: stack/t06 writer.
- State: Review; all four requests are fixed.
- Next: lead review and landing.
- Verify: the requested gate passed with `EXIT 0`.
- The rename test failed before the fix with `EXIT 1`.
  It called real Kit and got the bare command failure.
  It now gets `SchemaDrift` with `missing_hints`.
- Kit failures with JSON output keep that result in the error.
  Failures without JSON keep the original error.
- The shared migration lock has a name and a TSDoc contract.
  Other app locks and pg-boss must use another key.
- Restored the Store database TSDoc.
  Moved the draft promise beside the other draft promises.
- Gate proof:

```text
build: passed
check: 0 errors, 29 warnings (unchanged)
drizzle: 19 passed
stack: 42 passed
tracker: 79 passed
EXIT=0
prose-lint: 0 hits
```

- Jev preflight and test checks: no flags.
  Promises: no gaps; one old title was marked unsure.
  No new labels were needed.
- Strict style census: OK; TSDoc: 0 S26 rows.
- Scope: no rebase or mutation rerun, as the reviewer asked.
- Core feedback: none; no Core workaround was needed.
- Nothing was pushed.

### t06 review fix round 2

- Owner: stack/t06 writer.
- State: Review; the boot-order fix passed the gate.
- Next: lead review and landing.
- Verify: build, check, Drizzle, stack, tracker, and prose passed.
- The reviewer reproduced a bad-PORT test timeout at 30 seconds.
  A bad PORT also created and migrated a disk database.
- Decision: list `server` first, then `migrateIssues`.
  The server checks settings before calling the next start.
  It opens the port only after the later starts finish.
- A bad PORT must not open or migrate the database.
  A failed migration must still stop boot before the port opens.
- This order replaces the brief's instruction to list migrate first.
  It follows ADR 0081: checking config needs no library.
- Callers: the tracker root and the draft, issues, tools,
  browser-helper, and server test roots.
- The new disk-folder assertion failed on the old root order.
  `runServer` answered 1 but created the database folder.
  The focused regression check returned `EXIT 1`.
- After the fix, server and browser-helper passed all 10 tests.
  The bad-PORT test now leaves its disk folder absent.
  The focused check returned `EXIT 0`.
- Strict style census: OK; TSDoc: 0 S26 rows.
- Jev found no source or test-behavior flags and no promise gaps.
  The three old helper-count notes remain in issues, tools,
  and browser-helper; their helpers only changed start order.
  No new labels were needed.
- Gate on `b446e49e`: one run, alone under `/tmp/mutation.lock`.
  It passed with `EXIT 0`.
  The PORT tests passed with their existing 30-second limit.

```text
build: passed
check: 0 errors, 29 warnings (unchanged)
drizzle: 19 passed
stack: 43 passed
tracker: 79 passed
EXIT=0
prose-lint: 0 hits
```

- Core feedback: none; no Core workaround was needed.
- Scope: no rebase, mutation run, or push.

### t06 mutation follow-up

- Owner: stack/t06 writer.
- Base: `50b31bab`, including the lander's rebase and fixes.
- State: Review; all requested checks passed.
- Next: lead review and landing.
- Verify: each named range, Drizzle at least 85, and the gate.
- Assumption: keep the lander's head; do not rebase this follow-up.
- Node's promisified `execFile` adds stdout to every rejection.
  This call uses its default UTF-8 encoding, so stdout is a string.
  Invalid arguments throw before that promise exists.
  Remove the unreachable caught-error shape guard.
- Use real Kit with temporary config files; add no runner or mock.
- Config code that prints text and exits 7 keeps the command error.
  Its code, stdout, and stderr reach the caller.
- Config code that exits 0 with `null`, `{}`, or `false`
  raises `SchemaDrift` with that exact result.
- A NUL in the config path keeps `ERR_INVALID_ARG_VALUE`.
- The missing-baseline test now uses a nonempty migrations folder.
  The line 29 survivor was the call without a baseline on an
  empty folder; that case now proves an empty applied-file list.
- First green step: build and check passed; 25 Drizzle tests passed.
  Check has 0 errors and the same 29 warnings.
- Strict style census: OK; TSDoc: 0 S26 rows.
  Jev has no flags or promise gaps; no new labels are needed.
- Focused mutation proof, with the new line numbers:
  - `[Killed]` lines 29–30: 9 killed, 0 timeout, 0 survived.
    This includes the empty-folder condition at line 29.
  - `[Killed]` lines 45–53: 5 killed, 0 timeout, 0 survived.
    The old line 55 catch is now at lines 49–51.
  - `[Killed]` lines 56–61: 19 killed, 0 timeout, 0 survived.
    These include the old lines 62–63 shape checks.
- Each range scored 100 with `EXIT 0` and no uncovered or error rows.
  The old lines 46–49 error-shape guard was removed as unreachable.
- All three checks ran under one `/tmp/mutation.lock` lock.
  Each used `--timeoutMS 60000 --concurrency 2`.
  The clear-text reporter used `--logLevel debug` to print each kill.

```bash
npx --no-install stryker run \
  --mutate "src/migrations.ts:29-30" \
  --reporters clear-text --logLevel debug \
  --timeoutMS 60000 --concurrency 2
```

- Repeated that command for `45-53` and `56-61`.
- Full Drizzle lane: `EXIT 0`, score 93.86, above the floor of 85.
  Counts: 107 killed, 0 timeout, 7 survived, 0 uncovered, 0 errors.
  `migrations.ts`: 100, with all 55 mutants killed.
  All 7 survivors are in the unchanged `src/index.ts`.
- The full lane ran once under `/tmp/mutation.lock`, after removing
  this package's `.stryker-tmp`, with 60,000 ms and 2 workers.
  Its first run passed all 25 tests.
  Stryker recovered from one worker's `SIGILL` exit;
  the final report has no error rows and matches the current source.
- Final gate ran once under `/tmp/mutation.lock`: `EXIT 0`.
  Build passed; check found 0 errors and 29 warnings.
  Drizzle passed 25 tests, stack 63, and the tracker 79.
  The Drizzle gate result was cached; validation then reran it
  with `--no-cache` and passed.
- `pnpm validate` ran under the same lock: all 48 lanes passed,
  `EXIT 0`; `pnpm-workspace.yaml` was restored afterward.
- Prose passed with 0 hits; no new Jev labels or Core feedback.
- Keep the lander's base; no rebase, reset, or push in this follow-up.

## Tickets

- **t01 sync ships the SSE transport** -- [x] landed `fd5a6a8`
  `@tinker/sync/sse` carries the protocol over SSE
  down and POST up, both halves (ADR 0077). The
  server half takes a plain chunk writer, so sync
  imports no Hono. The tracker and the sync example
  drop their own copies.
  Verify: `vp run sync#test` and
  `vp run @tinker-issue-tracker#test` green; SCIP
  refs show no hand-written SSE transport left.
- **t02 hono answers managed errors** -- [x] landed `fe5b591`
  A managed error becomes its HTTP answer through
  `@tinker/hono`. An unmapped error is logged and
  answered 500. The tracker's hand mapping goes.
  Verify: `vp run hono#test` covers each answer;
  the tracker's tests pass unchanged.
- **t03 Drizzle 1.0 RC, pinned** -- [x] landed `4a720d6`
  The repo runs on one exact 1.0 RC of
  `drizzle-orm` and the matching `drizzle-kit`
  (ADR 0079). `@tinker/drizzle` and the tracker
  behave as before.
  Verify: `vp run -r build`, `vp check`,
  `vp run drizzle#test`, and the tracker's tests
  green.
- **t04 core: a span carries a trace id** -- [x] landed `3b18c86`
  Writer: `stack/t04`, in `/home/paseo/next/tinkered-stack-t04`.
  Next: lead review, N=61 landing screen, and label calibration; F1/F4 and the N=31 bar pass.
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
  blueprint Observe/Span# tests/span-tree.test.ts
  core Observe/Span# src/index.ts tests/body-tools.test.ts tests/caught-subflow.test.ts tests/clock.test.ts tests/index.test.ts tests/instance-release.test.ts tests/observation.test.ts tests/operations.test.ts tests/run-result.test.ts tests/step-log.test.ts tests/trace.test.ts
  harness Observe/Span# src/index.ts tests/approvals.test.ts tests/codex.test.ts tests/harness.test.ts tests/namespaces.test.ts tests/span-tree.test.ts tests/tools.test.ts
  hono Observe/Span# src/index.ts tests/errors.test.ts tests/hono.test.ts tests/routes.test.ts tests/stream.test.ts tests/trace.test.ts
  http Observe/Span# src/client.ts tests/observe.test.ts tests/retry.test.ts tests/span-tree.test.ts tests/trace.test.ts
  mcp Observe/Span# tests/mcp.test.ts
  process Observe/Span# tests/span-tree.test.ts
  react Observe/Span# src/index.ts tests/use-spans.test.tsx
  stack Observe/Span# src/observe.ts tests/live.test.ts tests/observe.test.ts tests/span-tree.test.ts
  tinkerer Observe/Span# tests/span-tree.test.ts
  core Observe/Trace# src/index.ts tests/trace.test.ts
  core Scope/Options#typeLiteral206:trace src/index.ts
  core Observe/Span#typeLiteral37:traceId src/index.ts tests/trace.test.ts
  core Observe/Span#typeLiteral37:spanId src/index.ts tests/trace.test.ts
  core Observe/Span#typeLiteral37:parentSpanId src/index.ts tests/trace.test.ts
  core Observe/Span#typeLiteral37:sampled src/index.ts tests/trace.test.ts
  core Observe/Trace#typeLiteral36:traceId src/index.ts tests/trace.test.ts
  core Observe/Trace#typeLiteral36:parentSpanId src/index.ts tests/trace.test.ts
  core Observe/Trace#typeLiteral36:sampled src/index.ts tests/trace.test.ts
  hono Observe/Trace# src/index.ts
  hono Observe/Span#typeLiteral248:traceId tests/trace.test.ts
  hono Observe/Span#typeLiteral248:spanId tests/trace.test.ts
  hono Observe/Span#typeLiteral248:parentSpanId tests/trace.test.ts
  http Observe/Span#typeLiteral148:traceId src/client.ts tests/trace.test.ts
  http Observe/Span#typeLiteral148:spanId src/client.ts tests/trace.test.ts
  http Observe/Span#typeLiteral148:sampled src/client.ts
  ```

- **t05 stack: server start and shutdown** -- [x] landed `fdfa93f`
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
- **t06 the migrate step** -- [x] landed `53db559`
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
- **t07 nats stack piece** -- [x] landed `214e246`
  `@tinker/nats` checks `NATS_URL` at start and
  connects (ADR 0080). A subscription runs an
  operation in its own session. The `traceparent`
  header waits for the trace id: it is in t13. Tests start a real
  `nats-server`, pinned, checked by checksum, and
  fetched once into a cache.
  Verify: `vp run nats#test` against a real server;
  a missing `NATS_URL` fails boot naming it.
  nats patches core's `scope.close` on its handle
  until core/close-hook-scope lands.
- **t08 jobs stack piece** -- [x] landed 2ac4a246 (blocked by: t06)
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
- **t09 mail stack piece** -- [x] landed (blocked by: t08)
  `@tinker/mail`: the app calls `sendMail` with a
  React Email template and its props. That adds a
  mail job, which renders and sends through Upyo,
  pinned (ADR 0083). `MAIL_URL` is checked at
  start. Dev logs each mail; tests read Upyo's
  mock.
  Verify: `vp run mail#test`: a committed request
  sends one mail, a rolled-back one sends none; a
  missing `MAIL_URL` fails boot in prod.
- **t10 auth: sign-up and sign-in** -- [x] landed 54296a9b (blocked by: t06)
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
- **t12 live updates across server processes** -- [x] landed `c0cc81c`
  After a commit, one server tells the others over
  NATS. Each re-reads from the database, and its
  tabs get the snapshot (ADR 0080). The tracker
  uses it.
  Verify: two server scopes on one PGlite and a
  real `nats-server`: a save through one reaches a
  subscriber on the other.
- **t13 the trace sink** -- [x] landed `547e060`
  The stack sends spans and logs over OTLP to
  `OTEL_EXPORTER_OTLP_ENDPOINT` (ADR 0076). NATS
  messages carry `traceparent` (ADR 0080). A
  missing endpoint stops boot, as for every stack
  piece.
  Verify: `vp run stack#test` against a local OTLP
  receiver: one request gives one trace with all
  its spans.
  Open (low): a failed span with no error message exports the text `undefined` (otlp.ts); the span queue caps by count (2048), bytes only per batch.
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

- **t17 hono answers a failed commit** -- [x] landed 223e7c24 (blocked by: none)
  Found by the t12 review. A request's session
  closes before its answer leaves; a failed commit
  answers 500 (today: 200 with nothing saved). Any
  error the route's operation raised rolls the
  request back, even when answered 4xx (ADR 0084).
  Verify: a test per rule that fails on today's
  main; `vp run hono#test`, tracker tests, browser
  proof, `pnpm validate`.

- **t18 the stack's roots on the stop signal** -- [x] landed 18af8441 (blocked by: none)
  core/root-lifetime landed (ADR 0085). The stack
  drops `runUntilStop` for an exit-code helper over
  a plain `Result`; the tracker's server root passes
  its stop signal to `createScope` and awaits
  `scope.closed`. Session tinkered-04 moves the rest.
  Verify: no `runUntilStop` left; SIGTERM exits 0;
  stack and tracker tests; `pnpm validate`.

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

## t01 writer

- Owner: stack/t01 writer; branch `stack/t01`.
- Base: `origin/main` at `bd3f270`.
- Status: Review. Next: lead reviews the saved branch.
- Verify: build, check, sync and tracker tests, example check,
  four direct browser runs on each tree, all validation lanes,
  and one final sync mutation run at or above 85.
- Assumption: the app keeps its URL and health cell choices.
  The package owns frame parsing, listeners, stream states,
  and retry handling.
- Assumption: POST remains an HTTP route choice.
  The server's `deliver` accepts the route's checked register.

### Impact written before code

- Precedent: MCP's transport plug (ADRs 0048 and 0077).
  `Sync.Message` and `Sync.Transport` stay the same.
- Add `createSseServer`, `createSseClient`, and `Sse`
  at `@tinker/sync/sse`.
- Remove the tracker's `sseTransport` and the example's
  `frame` and hand-written transport.
- The tracker keeps `wire`, `openSource`, `retry`, and
  `Wire.Source`; the source type names the package's shape.
- Callers: tracker `src/server/routes.ts`,
  `src/client/connection.ts`, and `examples/sync/hono.ts`.
- Tests: sync's public SSE entry, its Hono example test,
  and the tracker's existing client and browser proofs.
- SCIP review: index sync, tracker, and examples.
  Old `sseTransport` and sync example `frame` refs must be empty.
  New `createSseServer` refs must name both servers;
  `createSseClient` refs must name the tracker client.
- Baseline check: exit 0, 29 warnings.

### t01 checks

- Rebased on `origin/main` at `1a06fda` before the final gate.
  The `entries/follow-suit` example root and test changes stayed.
- Both consumers use `@tinker/sync/sse`.
  The tracker keeps URL keys, its retry intent, and health mapping.
  The example keeps its POST route and client map.
- The built SSE entry exports both functions and writes the expected frame.
- The final gate passed with `EXIT 0`:

```bash
vp run -r build && vp check \
  && vp run --no-cache sync#test \
  && vp run --no-cache @tinker-issue-tracker#test \
  && vp run @tinker/examples#check
```

```text
check: 0 errors, 29 warnings
sync: 69 tests passed
tracker: 72 tests passed
examples: no warnings, lint errors, or type errors
EXIT 0
```

- The 29 warnings match the base warning list exactly.
- Base browser proof: four uncached passes at `bd3f270`.
  Tracker, core, and sync source did not change between that
  base and `1a06fda`; the later changes were roots, tests, and docs.
- Final SCIP indexes: sync, tracker, and examples.
  Old `sseTransport` and the example's `frame` refs print `(none)`.
  `createSseServer` refs name both servers.
  `createSseClient` refs name the tracker connection.
- Style census: OK.
- TSDoc check: no S26 rows in the seven checked files.
- Jev tests: no flags in 64 read titles.
- Jev promises: no gaps in 64 read titles.
- Jev preflight: no file flags.
  Five new false labels record the wire's owned state and close path.
  The other model flags already have labels in the bank.
  The upstream `tour` resource cannot move to module scope:
  it captures that call's fresh memory transport.
- Changes beyond moving the wire: the size lane counts both entries.
  The example's existing missing-tab error now has a registry.
  Its config allows `.ts` imports for that registry.
  Five existing test promises gained README lines.
- Core feedback: none; no core change or workaround was needed.

- Branch browser proof: four uncached passes, each with seven helper tests.
  Command: `vp run --no-cache @tinker-issue-tracker#test:browser`.
- `pnpm validate`: all 44 lanes PASS, `EXIT 0`.
  The workspace file was restored after validation.
- Size: 5,766 bytes gzip across both entries; cap 10,240.
- Mutation: 86.81 overall; SSE entry 87.59; floor 85, `EXIT 0`.
  One full run, in the foreground, under `/tmp/mutation.lock`.
  403 killed, 5 timed out, 60 survived, 2 with no test coverage.
  Stryker restored the source files; `git diff --exit-code` passed.

```bash
flock /tmp/mutation.lock \
  vp run --no-cache sync#mutate
```

- All writer checks are complete. The card is in Review.
  Nothing was pushed.

## t03 writer — 2026-09-29

- Owner: stack/t03 writer.
- State: Review.
- Next: lead review and landing; the writer has not pushed.
- Verify: build, check, drizzle and tracker tests, browser proof,
  all validation lanes, and drizzle mutation score at least 85.
- Assumption: this ticket's catalog pin requires a committed change to
  `pnpm-workspace.yaml`; discard only unrelated install edits.

### Changes

- `npm view` found both requested `1.0.0-rc.4` packages.
  Used `npm --prefix /tmp view` because the repo requires pnpm.
- The catalog and lockfile pin both packages to `1.0.0-rc.4`.
- The tracker has Kit as a dev dependency.
- RC.4 removed the positional PGlite client argument.
  The first RC check failed with 11 `TS2345` errors.
  The tracker, example, README, and test setup now pass `{ client, logger }`.
- No existing test title or assertion changed.
- The package still accepts `^0.45.2` as well as `^1.0.0-rc.4`.
  All 12 original tests passed on 0.45.2 before the upgrade.
  Its types also accept the new client object form.
- No migration files were added.
- Install reports one optional peer warning: RC.4's Effect driver needs
  Effect 4, while `bench/core-vs-effect.mjs` uses Effect 3.
  No source imports the Drizzle Effect driver.
  Kept that separate benchmark dependency as it was.

### Final gate

- Rebased on `origin/main` at `de72d42` before the final gate.
  Kept main's board moves when fixing an earlier board conflict.
- `pnpm why drizzle-orm`: one version, `1.0.0-rc.4`.
- `vp exec drizzle-kit --version` in the tracker prints ORM and Kit RC.4.
- Gate: `vp run -r build`, `vp check`, `vp run drizzle#test`, then
  `vp run @tinker-issue-tracker#test`: `EXIT 0`.
- Check: 0 errors, 29 warnings, the same warning count as the starting tree.
- Drizzle: 13 tests pass. Tracker: 72 tests pass.
- `vp run -r test`: 1,466 pass, one existing skip.
  A full run with caching off also passed before the added commit-error test.
- `vp run @tinker-issue-tracker#test:browser`: `EXIT 0`, no cache hits.
  The two-tab proof and all 7 browser helper tests pass.
- `pnpm validate`: all 44 lanes pass, `EXIT 0`.
  Ran under `/tmp/mutation.lock` after a rebuild.
  The committed `allowBuilds.esbuild` was already true.
- Strict style census on the three changed TypeScript files: OK.
- Prose lint: 0 hits.

### Mutation proof and the added test

- The first full run failed: 84.75, below 85; `EXIT 1`.
  It reported 47 killed, 3 timed out, 9 survived, and no report errors.
- A worker hit a Node WebAssembly `SIGILL`; Stryker recovered and finished.
- Two surviving changes hide a commit failure from the caller.
  The README already promises that a failed commit rejects the session.
  Added a PGlite test with a unique constraint checked only at commit.
  The session rejects with core's `TeardownFailed`;
  its `payload.causes` holds the database error.
- Re-ran the final gate, all tests, browser proof, and validation after adding it.
- The second full run printed 100.00, `EXIT 0`.
  It reported 39 killed, 20 timed out, no survivors, and no report errors.
  Seven of its 20 timeouts were untargeted run-1 survivors in `src/index.ts`:
  `59:12`, `65:13`, `71:12`, `113:53`, `115:3`, `151:59`, `152:3`.
  These are load timeouts, not kills; a changed label string cannot hang a test.
  The printed score is not a real result.
- Expected honest score: about 88 (52/59).
  Run 1 had 47 killed plus 3 timeouts; the new test adds 2 kills.
  The lander should rerun the full lane alone to confirm it.
- Both full runs used `flock /tmp/mutation.lock`.
  The second run departs from the brief's one-run limit because the first was red.
- The first focused range, `src/index.ts:144-145`, killed all four expression changes.
  It did not include the full function body, which ends on line 146.
- The final focused range, `src/index.ts:144-147`, killed all five changes.
  One worker, a 30-second timeout, no timeouts or errors; `EXIT 0`.
  The new test killed both previously surviving commit-error changes:
  `[Killed] BlockStatement` at `src/index.ts:144` and
  `[Killed] ConditionalExpression` (`false`) at `src/index.ts:145`.
- All mutation runs, including the focused checks, held `/tmp/mutation.lock`.

### Jev and Core feedback

- Jev on the ticket's source diff: 0 flags.
- Test review: 0 of 13 flags. README promises: 0 of 13 gaps.
  One low-confidence note asks about a root read after commit.
  The outcome rule already promises commit when the session succeeds.
- `main..HEAD` includes work already on `origin/main`.
  Its five model hits already have false labels in `tools/jev/cases.jsonl`:
  `inputDefaultMasks` on `readTextPart` and `readFirstText`,
  `effectWithoutDefer` on `serveMcp`, and `stateOutsideCell` plus
  `stopOnlyInDefer` on `posts`.
  The plain `unitCouldBeModuleLevel` hit captures the tour's local wire;
  that resource cannot move to module scope as written.
  No new labels are needed for t03.
- Core feedback: none; no Core workaround was needed.

## t02 writer — stack/t02

- Owner: stack/t02 writer.
- Next: add `errorResponses` and the default Hono error reply.
- Verify: Hono and tracker tests pass;
  tracker assertions stay unchanged.
  Build, check, validate, mutation at least 85.
- Assumption: a status alone sends an empty body.
  A body builder returns text or a JSON value.
  The existing `onError` hook can use the table.
- The tracker takes its log sink only from the scope.
  Test setup drops the unused server `observe` option;
  assertions stay unchanged.
- Core feedback to check: an extension's `ctx.log`
  is off, so a resource must read the scope's logger.

### t02 impact

- Add `errorResponses` and `HonoScope.ErrorResponses`.
  No existing Hono signature changes.
- Change Hono's default last error handler: log
  `request failed`, then answer `internal`, status 500.
  Keep `HTTPException` and client-abort behavior.
- Callers: `apps/issue-tracker/src/server/routes.ts`
  and its `main.ts` comment and server options.
  Hono's other callers need no source change.
- Remove the tracker's `onError`, `readIssueError`,
  `readStreamError`, and `reportUnmapped` functions.
- Check old and new symbols with SCIP before review.

### t02 first green step

- Build, check, Hono 68 tests, tracker 72 tests: exit 0.
- Check: 0 errors, 29 warnings, same as the starting tree.
- Tracker tests and the existing 499 test are unchanged.
- Prose lint and strict style census: exit 0.
- SCIP: the four old tracker functions have no refs.
  `errorResponses` is used by the tracker routes and
  the new Hono request tests.
- Jev found 12 older README gaps; added promise lines.
  Its three helper-size notes are in unchanged test files.
  Those plain notes have no judge id to label.

### t02 Core feedback proof

This extension logs no line (`logs` stays empty):

```ts
const logs = [];
const piece = extension({
  label: "log-probe",
  start: (_scope, { log }) => log.error("boot failed"),
});
const scope = createScope({
  extensions: [piece],
  observe: { log: (entry) => logs.push(entry) },
});
await scope.ready;
console.log(logs); // []
await scope.close();
```

Hono reads its logger from a resource instead.
No core code changed.

### t02 final gate

- Rebased onto `origin/main` at `1a06fda`.
  Kept the lead's board card when resolving the
  board-only conflict.
- Build, check, Hono 68 tests, tracker 72 tests: exit 0.
  Check has 0 errors and 29 warnings.
- Full repo test run with cache off: all 15 tasks passed.
- `pnpm validate`, under the shared lock: all 44 lanes
  passed, exit 0.
- Jev promises: 0 of 68 titles lack a README line.
- Strict style census and TSDoc check: exit 0.
- Two new Jev labels, both `effectWithoutDefer false`:
  `main.ts#servePort` returns its close to Hono,
  which registers it with `defer`;
  Hono's `stream` owns its sessions and closes them
  on body end or cancel.
- Five flags in files already on `origin/main` have
  matching labels in the bank; no source edits.
  The plain note on the sync tour's `pipe` is not a
  defect: its factory keeps that tour's local `right`.
- Promise gaps and helper-size notes are plain output
  with no judge id accepted by `label.mjs`.
  The gaps were fixed; the three helper notes concern
  unchanged tests.
- One full Hono mutation run, under `/tmp/mutation.lock`:
  score 85.27, floor 85, exit 0.
  249 killed, 41 survived, 2 without coverage.
- Card moved to Review; the lead still owns landing.
  No push.
- Assumptions kept: status-only rows have an empty body;
  strings are text, other JSON values are JSON.
  The scope supplies the sink; the tracker's unused
  `observe` option was removed in review round 1.
- Tracker assertions and the existing 499 test are
  unchanged from the base.

### t02 review round 1

- Removed the unused `IssueServer.Options.observe`.
  Only four test setup calls changed; each scope
  still receives its existing sink.
- Exported `Errors.Payloads` and used it directly
  in the tracker's error response table.
- Gate: build, check, Hono 68 tests, tracker 72 tests;
  `EXIT=0`. Check: 0 errors, 29 existing warnings.
- Prose lint and strict style census: exit 0.
- No rebase or mutation run in this round.

## t07 first report — mutation gate failed

- Owner: writer (Codex), branch `stack/t07`.
- Next: add proof for server-helper shutdown and
  drain faults, then pass the mutation floor.
- Verify: build, check, nats tests, all validate
  lanes, and mutation score at least 85.
- The ticket brief moves `traceparent` to t13.
- Assumption: message input is plain data with a
  subject and byte payload; app code sees no client.
- The workspace glob already includes new packages.
  Root TypeScript config has no package references.

### t07 checks seen

- Rebased onto `origin/main` at `1a06fda`.
- Gate: build, check, and 13 nats tests; `EXIT 0`.
- Check: 0 errors, 29 warnings.
  A fresh main worktree also has 29 warnings.
- `pnpm validate`: all 46 lanes pass, `EXIT 0`.
- Jev tests: 0 of 13 flagged.
- Jev promises: all 13 have README lines.
- Jev preflight: 0 file flags.
  The two test-helper flags are labeled false.
  The caller owns the process and closes it; the
  helper closes it itself if boot fails.
- Strict style census: OK.
- Full repo tests: `vp run -r test`, `EXIT 0` on rerun.
  The first run failed the unchanged issue tracker
  `tests/config.test.ts:43` on `PORT=70000`.
  The file passed alone on both main and this
  branch; the full command then passed too.
- Mutation: one full run, under `/tmp/mutation.lock`.
  Score 67.08; required 85; `EXIT 1`.
  136 killed, 27 timed out, 71 survived,
  9 had no coverage, and 2 had errors.
  `index.ts`: 81.52; `testing.ts`: 58.45;
  `errors.ts`: 55.56.
- The ticket is saved in Review, not ready to land.
  The brief said to run the full mutation lane
  once. No second run was made.

### t07 mutation gaps

The report is kept in the worktree at
`packages/nats/reports/mutation/mutation.json`.
The full log is in the user's cache at
`~/.cache/tinkered-briefs/stack-t07-mutation.log`.

- `src/testing.ts:106–112`: removing `close`,
  the kill, the exit wait, or store removal survives.
  Call start and close inside a public-seam test,
  then assert the server is gone and its store is removed.
  Current server start and close calls sit in test hooks.
- `src/testing.ts:87–100`: several server arguments
  and readiness changes survive too.
  The same public lifecycle test should check the
  server's reported address and a real connection.
- `src/index.ts:128–140`: drain changes survive.
  Add an external peer with messages still queued
  at close, and assert that the full batch arrives.
- `src/errors.ts:23`: a guard that accepts every
  error survives. Reject the wrong named error in
  the existing config and checksum tests.
- Some survivors change only a label or a host
  branch not used on Linux. Read each before adding
  a test; no tests just to raise the score.

Next full check, after those tests pass:

```bash
flock /tmp/mutation.lock \
  vp run --no-cache nats#mutate
```

### t07 core feedback

`start` has a log method, but the sink sees no line.
This probe printed `actual: 0` with `expected: 1`.
NATS logs inside its message operation instead.

```ts
const logs = [];
const scope = createScope({
  observe: { log: (line) => logs.push(line) },
  extensions: [
    extension({
      label: "probe",
      start: (_scope, ctx) => ctx.log.error("lost"),
    }),
  ],
});
await scope.ready;
console.log({ expected: 1, actual: logs.length });
await scope.close();
```

### t07 assumptions and small additions

- Each message is `{ subject, payload }`.
  Payload is an owned copy of the received bytes.
- Make one NATS piece per root; the close hook
  has no scope argument to select per-root state.
- A row can load its operation at boot.
  This lets that operation depend on the piece's
  publish operation without a declaration cycle.
- The helper exposes a loopback monitor URL.
  Tests use the real server's connection count
  to prove that scope close closes its connection.
- No existing public symbol changes, so this
  ticket has no cross-package impact block.

## t07 mutation lift — review

- Lead asked to continue on `stack/t07`.
- Rank the old survivors, then cover visible faults
  and remove code with no visible effect.
- Verify every lifted range with a focused kill
  check, then one full mutation lane at least 85.
- Keep all source files in mutation and keep the floor.
- Finish with the gate and all validate lanes.
- Check whether NATS ports or processes could affect
  the issue tracker's earlier `PORT` test failure.

### t07 PORT check

- Package: `@tinker-issue-tracker`.
- Test: `a PORT with trailing junk or out of range fails the boot too`.
- File: `apps/issue-tracker/tests/config.test.ts:41`.
- The earlier failure was the `70000` payload at line 43.
- The server checks the value before it opens a port or store.
  NATS uses free ports, so these paths cannot clash on port 70000.
- This branch does not change the tracker, its environment,
  or its `issues-port-` store folders.
- The child helper hides stderr and can return an empty result.
  The old failure does not give enough proof to name its cause.
- Extra process load could affect child startup on this shared host.
  The dropped stderr prevents a firm cause for the earlier failure.
- Fresh `vp test tests/config.test.ts` from the tracker:
  five tests passed, exit 0, with no code change.
- The rebase onto `ba39695` brought in stack/t05.
  Its port checks now live in `packages/stack/tests/settings.test.ts`.
  This NATS branch did not move them.

### t07 lift choices and checks before the full lane

- Keep 17 tests at the public package entries.
- Check real server shutdown inside a test, not only in hooks.
  A peer closes; both ports can be bound again; the store is gone.
- Invalid server config proves failed-start cleanup.
  Read the exact store path and require the file system's `ENOENT`.
- Check the cache's saved files, unchanged file times,
  and repair after deleting the extracted binary.
- Keep checksum refusal and reject the wrong managed error
  in the existing checksum and missing-key tests.
- Check denied subscriptions with owned and borrowed connections.
  The scope closes only a connection it owns.
- Check boot failure before and after connect.
  Keep the first cause and add no cleanup error.
- Remove duplicate checksum and close paths,
  the extra tar member selector, unused process options,
  and the extra ready-log check after both listeners open.
- The client drain closes on success.
  Explicit close is kept for a failed drain.
- Share delivery cleanup for resolved and rejected promises.
- Assumption: the test-only helper may accept raw server config.
  Tests use it for subject permissions and rejected startup.
- Assumption: the helper may expose its owned store path.
  Tests use that path to prove removal.
- Windows and other CPU mappings remain part of the host promise.
  This Linux x64 run does not patch the host to cover them.
- Ranked all old survivors with `survivors.mjs nats`.
  Labeled all 28 flags with a reason in `cases.jsonl`.
- Final Jev test and promise checks: 0 of 17 flagged.
  Preflight: 0 file flags; the helper ownership flags are false.
  Its caller owns the returned server and calls close.
- Strict style census: OK.
- Fresh `origin/main` at `ba39695`: build and check exit 0.
  Check reports 29 warnings and no errors.

### t07 focused kill proof

Run from `packages/nats`, under the shared mutation lock:

```bash
npx stryker run --mutate "src/<file>:L-L" \
  --reporters clear-text --logLevel debug
```

Stryker 10 prints killed cases at the debug log level.
Each row below has printed `[Killed]` cases.
The counts keep timeouts separate.

- `src/errors.ts:21-23`: `[Killed]` 6; score 100.00; exit 0.
- `src/index.ts:35-147`: `[Killed]` 71; 8 timeouts;
  1 survivor; score 98.75; exit 0.
- `src/testing.ts:13-78`: `[Killed]` 58;
  6 survivors and 3 not covered on this host;
  score 86.57; exit 0.
- `src/testing.ts:83-131`: `[Killed]` 30; 16 timeouts;
  3 survivors and 2 invalid mutants;
  score 93.88; exit 0.

The dropped delivery at `src/index.ts:88` is `[Killed]`
by the queued-message and reply test.
Logs are in `/home/paseo/.cache/tinkered-briefs/`,
with the `stack-t07-kill-` prefix.
No source file was excluded and the floor stays 85.

### t07 full mutation lift

- One full lane, alone under `/tmp/mutation.lock`, in the foreground.
- Command: `flock /tmp/mutation.lock vp run --no-cache nats#mutate`.
- Removed the old `.stryker-tmp` first.
  The command guard rejected `rm -rf`; plain `rm -r` worked.
- Total score: **93.95**, up from **67.08**; exit 0.
- `errors.ts`: 100.00; `index.ts`: 98.88; `testing.ts`: 89.83.
- 175 killed, 27 timed out, 10 survived,
  3 not covered on this host, and 2 invalid mutants.
- Full JSON: `packages/nats/reports/mutation/mutation.json`.
- Full log: `stack-t07-lift-mutation-full.log`
  in `/home/paseo/.cache/tinkered-briefs/`.
- Before the lane, the worktree had no NATS process left.
- Fresh fetch and rebase before this run: still `ba39695`.

### t07 final lift checks

- Gate after mutation: `vp run -r build && vp check && vp run nats#test`.
  Exit 0; 17 NATS tests pass.
- Check: no errors and 29 warnings in 452 files.
  Fresh main had the same 29 warnings, in 445 files.
- `pnpm validate`: all 48 lanes pass, exit 0.
  `pnpm-workspace.yaml` has no branch change.
- `vp run -r test`: every package passes, exit 0.
  The tracker has 69 passing tests after stack/t05.
- Process scan after all checks: no NATS server owned by this worktree.
  The normal helper test also proved both ports and the store were freed.
- Branch stays local; nothing pushed.
- Next: lead review and landing.

### t07 review fix round 1

- Owner: writer (Codex), branch `stack/t07`.
- Next: fix the shared-piece guard and closed-subscription drain.
- Verify: real-server tests fail before the fixes, then pass;
  build, check, NATS tests, prose, and strict style census.
- The lead asks the lander to run mutation this round.
- Assumption: no test title was supplied for F1.
  Use “a piece rejects a second live scope and can restart after close”.
- Rebased onto `origin/main` at `a5aa0e7e` before the fixes.
  Kept both t01 and t07 proof and both sets of Jev labels.
- F3: removed all 172 `/tmp/tinker-nats-*` stores.
  No server process was live before removal.
- F3: removed `~/.cache/nats-server/2.15.0` too.
  Our mutation that dropped the `tinkered` path part made it.
  The saved mutant and file times match the earlier run.
  Kept `~/.cache/tinkered/nats-server/2.15.0`.

- F1: one live scope owns the piece; a second start raises
  `PieceInUse` with `{ label: "nats" }`.
  Close waits for the whole close chain before freeing the piece.
- Core has no scope argument in its close hook.
  Bind cleanup to the public scope handle supplied to `start`.
  A rejected scope or an old handle cannot drain the live scope.
  Added stack/t07 as the second asker on the close-state row.
- F2: skip closed subscriptions and wait for every drain to settle,
  then wait for pending deliveries.
  Owned and borrowed denied subscriptions close with just success.
- Kept the connection-drain catch: NATS 3.4.0's final flush
  can reject on disconnect before its call to close.
  The catch closes our client and keeps the first error.
- Regression proof on the old code: two failed, 16 passed; exit 1.
  The new guard test's second scope started instead of failing.
  The denied-subscription test returned a teardown error.
- Gate after both fixes: build, check, 18 NATS tests; exit 0.
  Check has no errors and 29 warnings.
- Prose: no hits; strict style census: OK; TSDoc: no findings.

- Fresh main at `a5aa0e7e`: build and check exit 0;
  the same 29 warnings, in 448 files rather than our 455.
- `pnpm validate`: all 48 lanes pass, exit 0.
- Jev preflight: no file flags.
  New label: `stateOutsideCell false` for
  `packages/nats/src/index.ts#stopSubscriptions`.
  It holds connection cleanup state, not application data.
  The helper's `effectWithoutDefer false` and
  `stateOutsideCell false` labels remain in the bank.
- Jev tests and README promises: no flags in 18 tests.
- Core failing shape before F1, with one shared piece:

```ts
const a = createScope({ extensions: [bus.extension] });
await a.ready;
const b = createScope({ extensions: [bus.extension] });
await b.ready;
await a.close({ graceful: true });
b.run(bus.publish, { input: message });
```

The receive operation never runs: A closed B's subscriptions.
The new test rejects B at boot and proves A still receives.
It also closes old handles after a fresh start.

- `vp run -r test`: all package tasks pass, exit 0.
  The tracker has 69 passing tests; 15 of 17 tasks used cache.
- No mutation command was run in this fix round.
  The earlier 93.95 score belongs to the code before these fixes.
  The lander will measure the new score.
- Status: Review. Next: lead review and lander mutation.
  Nothing pushed.

### t07 download status fix

- Owner: writer (Codex), branch `stack/t07`.
- Next: restore the HTTP failure check and prove it at the helper entry.
- Verify: gate exit 0; focused kill check; one full mutation lane
  at least 85 under the lock; all validation lanes; no leftovers.
- Fresh fetch and rebase: still `origin/main` at `a5aa0e7e`.
- Assumption: keep the existing cache-directory argument.
  Add `{ downloadBase }` as a second, test-only helper option.
  The official GitHub release stays the only default.
- Callers: `startNatsServer` in `packages/nats/src/testing.ts`
  and `packages/nats/tests/testing.test.ts`.
  Existing calls keep their shape.

- Added `DownloadFailed` with `{ url, status }` for non-2xx replies.
- The local HTTP test serves 404 and 429 for both the checksum file
  and the archive, then 200 with bad archive bytes.
  The last case still raises `ChecksumMismatch`.
- Before the status check: the new test failed with `ChecksumMismatch`
  on a 404; four helper tests passed; exit 1.
- After the check: build, check, and all 19 NATS tests pass; exit 0.
  Check: no errors, 29 warnings, matching the checked main base.
- Jev tests and README promises: no flags in 19 tests.
- Label `memoKeyIgnoresInput false` for the helper file:
  the cache names the pinned release and host archive;
  the download base is only read on a cache miss.
- Existing helper labels still apply:
  `effectWithoutDefer false` and `stateOutsideCell false`.

- Focused kill check under `/tmp/mutation.lock`:
  `src/testing.ts:79-83`: `[Killed]` 6; score 100.00; exit 0.
  No survivors, timeouts, or uncovered mutants.
  The new local HTTP test kills the removed status check,
  wrong error kind, and empty error payload.
- Log: `stack-t07-download-kill.log` in
  `/home/paseo/.cache/tinkered-briefs/`.

- One full NATS mutation lane, alone under `/tmp/mutation.lock`:
  score **91.43**, floor 85, exit 0.
  `errors.ts`: 100.00; `index.ts`: 92.04; `testing.ts`: 90.32.
  193 killed, 31 timed out, 15 survived, 6 not covered,
  and 2 invalid mutants.
- The full report also marks all six download-check mutants `[Killed]`.
- Log: `stack-t07-download-mutation-full.log` in
  `/home/paseo/.cache/tinkered-briefs/`.
  JSON: `packages/nats/reports/mutation/mutation.json`.
- No source exclusions or mutation floor changes.
- Before the lane: no NATS processes or temp stores.
  After the lane: no NATS processes, but 46 mutant-made stores.
  Removed all 46 stores and the mutant-made wrong cache at
  `~/.cache/nats-server/2.15.0`.
  No helper test-cache folders remained.

- After mutation, `pnpm validate`: all 48 lanes pass; exit 0.
  `pnpm-workspace.yaml` has no branch change.
- Final scan after validation: zero `/tmp/tinker-nats-*` folders
  and zero `nats-server` processes, including stopped processes.
  The wrong cache is gone; the correct home cache remains.
- Prose: no hits. Strict style census: OK.
  TSDoc: no findings. No new core feedback from this helper fix.
- Status: Review. Next: lead reviews this last fix and lands.
  All jobs finished in this turn. Nothing pushed.

- Main advanced while the mutation jobs waited for the lock.
  Rebased onto `cfaeae71` after the lane, keeping both tracks' proof.
- Saved file hashes show no change to NATS source, tests, configs,
  or core inputs across that rebase.
  The one full mutation result, 91.43, covers the same NATS code.
- Fresh install and gate on the new base: exit 0.
  All 19 NATS tests pass; check has no errors and 29 warnings.
- `pnpm validate` on the new base: all 48 lanes pass; exit 0.
- Final scan after those checks: zero temp NATS stores
  and zero `nats-server` processes.
- Final logs use the `stack-t07-download-rebased-` prefix in
  `/home/paseo/.cache/tinkered-briefs/`.

## t12 writer work

- Owner: stack/t12 writer, branch `stack/t12`.
- Status: Review; all writer checks passed.
- Next: lead review and landing.
- Verify: two scopes, one PGlite, real NATS;
  both directions, no GET or rollback signal, close cleanup.
- Base: fresh `origin/main` at `5121bb9d`.
- No existing package API is removed or changed.
  New stack exports are `publishAfterCommit` and `liveUpdates`.
  The tracker keeps its public `publish()` shape.
- Assumption: one subject, `issues.changed`, per app.
  The app has one operation that reads every published cell.
- The sender re-reads too; equal rows keep the snapshot.
  Re-reads do not emit a signal, so there is no loop.
- Assumption: a root row may hold nested extensions,
  as core's `Many` already allows.
  The piece keeps NATS's own extension and cleanup.
- With no `NATS_URL`, the tracker lists local publishing.
  A listed live piece checks config during start.
- The existing tracker tests and store are unchanged.
  The shared database test borrows one PGlite in both stores.
- The brief's “Round 5, decided” heading is absent.
  Read Round 3 decisions and Round 5 research instead.

### t12 first green step

- Gate: build, check, stack 56, NATS 19, tracker 69;
  `EXIT 0`.
- Check has 0 errors and 29 warnings.
  Fresh main at `edb51742` has the same 29 warnings.
- Removed the NATS row for one test run.
  The other server kept `[]`, so the save test failed.
  Restored the row; all 56 stack tests passed.
- Jev tests: 0 of 23 titles flagged.
  Promises: all 23 have a README line.
- Jev preflight: no file flags.
  The plain `unitCouldBeModuleLevel` note names the
  receive operation; it closes over this piece's root read.
  A module-level operation would lose that owner.
  The two `~wrapsCallersStep` notes need no label.
- Prose, TSDoc, strict style census: exit 0.
- Rebased onto `edb51742` and installed again.

### t12 commit failure fix

- A real duplicate-title rule, checked only at commit,
  made the second insert fail after the operation returned.
- Before the fix: two signals for one saved row;
  the new test failed, exit 1.
- Core can return `success` with `teardownErrors`.
  Skip publishing when that list has an error.
  This keeps a failed commit silent too.

### t12 final checks before mutation

- Fresh fetch and rebase: `origin/main` is `edb51742`.
- Gate: build, check, stack 57, NATS 19, tracker 69;
  `EXIT 0`.
- Check: 0 errors, 29 warnings, matching main.
- Full repo tests: all 17 tasks passed, exit 0.
- Browser proof, with cache off: script and all seven
  browser helper tests passed, exit 0.
- Tracker assertions and store have no diff from main.
- SCIP finds both new exports in the tracker:
  `main.ts` uses `liveUpdates`;
  `publish.ts` uses `publishAfterCommit`.
  No old symbol was removed.
- Jev tests: 0 of 24 titles flagged.
  Promises: all 24 have README lines.
  The plain and `~` notes are the same as above.
  No model flag needs a label; none were added.
- Final strict style census: OK.

### t12 Core feedback

Owner: `@tinker/hono`.
Its `serveRequests` awaits `session.close({ graceful: true })`
but ignores the result, so a failed commit still answers 200.
This is a pre-existing HTTP bug; core, Hono, and Drizzle
have no branch change.

Core's `{ status: "success", teardownErrors: [...] }`
is the documented result shape from ADR 0027.
Core's `scope.session()` already rejects this case with
`TeardownFailed`, as the Drizzle failed-commit test proves.

The review probe used a route on one real PGlite.
Its duplicate-title rule was checked only at commit:

```ts
const save = operation({
  label: "save",
  depends: { tx: store.tx },
  run: async ({ tx }) => {
    await tx.exec("insert into issues values ('C'), ('C')");
    return "ok";
  },
});
```

Observed: HTTP 200 with `"ok"`, but zero saved rows.
The tracker's old `publish` checked status alone too;
its extra local read after a failed commit was harmless.
Stack now checks both `status` and `teardownErrors`
before it republishes or signals.
The Hono response bug remains with its owner.

### t12 validation and mutation proof

- `pnpm validate`: all 48 lanes passed, `EXIT 0`.
  Ran in the foreground under `/tmp/mutation.lock`.
  `pnpm-workspace.yaml` has no branch change.
- First full stack mutation lane under the same lock:
  **90.23**, 229 killed, 11 timed out, 26 survived;
  zero without coverage or errors, `EXIT 0`.
- The busy-host rerun used `--timeoutMS 60000`
  and `--concurrency 2`, as the user asked.
  **89.47**, 238 killed, 0 timed out, 28 survived;
  zero without coverage or errors, `EXIT 0`.
- The new `publish.ts` scored 95.24 on that rerun.
  All stack source stays included; the floor stays 85.
- Both full logs and JSON reports are saved in
  `/home/paseo/.cache/tinkered-briefs/`:
  `stack-t12-mutation-default` and `stack-t12-mutation-60s`.
- No NATS server process remained after the runs.
  Removed the nine new temp stores left by timed-out tests.
  Stores present before the run were left alone.
- Last fetch and rebase: still `edb51742`.
  The migrate ticket had not landed on `origin/main`.
- Status: Review.
  Next: lead reviews and lands `stack/t12`.
  All long jobs finished in this turn; nothing pushed.

### t12 review round 1

- Added a third server on `issues.changed` as a control.
  The subject-isolation test waits for that server's save,
  drains `other`, then checks its last watched cell value.
- Wrong-subject proof: made `other` listen on `issues.changed`.
  The test failed with `["A"]` instead of `[]`, exit 1.
  Restored `other.changed` before the gate.
- Added “a handled 4xx answer still commits and signals”.
  It proves HTTP 409, the saved row, and one empty signal.
  The README now states that promise and commit behavior.
- Corrected the feedback owner to `@tinker/hono`.
  Core's close result follows ADR 0027;
  Hono ignores that result and can answer 200 on a failed commit.
- Gate: build, check, stack 58, NATS 19, tracker 69;
  `EXIT=0`.
  Check: 0 errors, 29 warnings.
- Jev tests: 0 of 25 titles flagged.
  Promises: all 25 have README lines.
- Prose and strict style census passed.
- Only tests and docs changed.
  No mutation rerun, rebase, or push in this round.
- Next: lead review of the fix commit.

## t04 writer proof — 2026-09-29

- Branch: `stack/t04`.
- Base: `origin/main` at `de72d42`.
- Worktree: `/home/paseo/next/tinkered-stack-t04`.
- Shape: W3C trace ids are 16 bytes; span ids are 8 bytes.
- Both are lowercase hex from the ambient random source.
- Numeric ids still order local span trees.
- The seed carries the remote parent and sampled flag.
- `trace: null` clears an inherited seed.
- A resource uses its caller's trace even when the root owns it.
- No new kind hint, links, `tracestate`, or OTel import.
- The sink supplies `service.name` from its own config.

### Checks seen

```bash
vp run -r build && vp check &&
vp run core#test && vp run hono#test &&
vp run http#test && vp run -r test
```

- Gate: `EXIT 0` after the final fetch and rebase.
- Core: 725 tests; Hono: 65; HTTP: 86.
- The full repo test run passed.
- Check: 0 errors, 29 warnings on both branch and base.
- `pnpm validate`: all 44 lanes PASS.
- All printed span-tree tests passed without edits.
- Two regressions failed before their fixes, then passed.
- They cover clearing a root seed and a direct resource build.
- Hono -> HTTP -> Hono: six spans shared one trace in a public API probe.
- SCIP rebuilt every package and printed refs for all nine new symbols.
- Jev: all source flags labeled; 69 new rows, all false.
- All 16 new test titles have README promise lines.
- Old test notes and README gaps remain outside this change.
- Strict style scan: one old S14 false hit, on both branch and base.
- That hit reads `panics[0]` from an array, not a tuple.
- Core mutation: 86.01, `EXIT 0`, one full run under the lock.
- Hono mutation: 88.57, `EXIT 0`.
- HTTP mutation: 89.70, `EXIT 0`.
- Each package ran one full mutation lane, alone under the lock.
- Writer work is saved in Review; no landing or push was done.
- Hot slots: 253 names, last slot 255, no headroom.

### Timing

Each screen used 31 A/B pairs through `bench/queued.sh`.
Both held `/tmp/mutation.lock` and ended with exit 0.
Each case used batch mode in 31/31 runs on both sides.
The first screen found an off-path slowdown.
A small off check fixed it; the second screen timed `f36bfac`.

- **op:** b is faster, 69.9 to 66.2 ns.
- **opsink:** b is faster, 68.1 to 63.6 ns.
- **oplog:** b is faster, 282.0 to 274.4 ns.
- **opobs:** b is slower, 184.1 to 1241.8 ns.
- **tagged:** no difference we can see.
- **session:** no difference we can see.
- **cold:** no difference we can see.

Observed root spans now make and format two ids.
The extra cost is about 1.06 microseconds per call.
The six checked paths with observation off show no slowdown.
The lander still needs 61 pairs.

The [learning note](../../../research/learnings/2026-09-29-span-off-check.md) holds the full numbers.
Raw logs, label lines, SCIP output, and the report are in the writer worktree's `.bench/stack-t04-proof/`.

### Writer choices

The named gate and three mutation lanes replace `scripts/ticket.sh`.
That script stages every path, runs every package's mutation lane, and force-writes a core tag.
The writer brief requires path-only commits and these three lanes.
No branch was pushed.

## t04 fix round — cheap observed spans

The lead accepted the public shape and asked to cut the observed-call cost.
The previous 184.1 to 1241.8 ns result is a blocker.
Bits come from `random.next()` at open.
Hex text is built on first read and cached.
The trace text is shared across children.
No extra core module name may be added.
The base stays `de72d42`.
Verify: N=31 for all observation cases and the seven named cases; no other row b is slower.
Then the full gate, all budget lanes, and one full core mutation run under the lock.

### Fix-round timing proof

- Three layouts were screened through the queue, each with N=31.
- All used base `de72d42` and batch mode for every pair.
- Every screen exited 0.
- The final layout stores trace bits as 52 + 52 + 24 bits.
- It stores span bits as 32 + 32 bits.
- A fresh root takes five draws; a child or seeded root takes two.
- The final part cannot be zero, so the whole ID cannot be zero.
- Getters keep the public string reads and cache text on first use.
- Each trace shares one text cache across its children.
- `SpanImpl` replaces `createSpan`: no extra module-level name.
- Hot slots: 253 names, last slot 255, zero spare slots.
- Two new seam tests cover delayed reads and valid random draws.

Final medians in ns, base then branch:

- **opobs:** 187.1 to 246.9; slower 29/31; b is slower.
- **op:** 67.4 to 63.5; slower 3/31; b is faster.
- **opsink:** 66.9 to 62.9; slower 1/31; b is faster.
- **oplog:** 282.3 to 278.3; slower 10/31; no difference we can see.
- **tagged:** 182.5 to 179.0; slower 16/31; no difference we can see.
- **session:** 621.7 to 626.7; slower 20/31; no difference we can see.
- **cold:** 724.4 to 714.9; slower 15/31; no difference we can see.

`opobs` is still above its target; no other row is slower.
Its best measured result pays for the draws and saved numeric state.
The three trials do not prove a hard lower bound.
The lead takes the remaining 59.8 ns gap to the user.
Full trial and V8 notes are in the [learning note](../../../research/learnings/2026-09-29-span-off-check.md).

### Fix-round gate proof

- Rebased onto `origin/main` at `cfaeae71` before the final gate.
- The rebase changed no core or timing-harness source.
- `vp install` passed; install edits to the workspace file were restored.
- The full build, check, core, Hono, HTTP, and repo-test chain exited 0.
- Core: 727 tests; Hono: 65; HTTP: 86.
- Check: zero errors and 29 warnings, the same count as the base.
- The first gate attempt stopped on progress-note formatting; fixed.
- `pnpm validate`: 46 lanes PASS, exit 0.
- All span-tree tests still pass without changed expected trees.
- TSDoc check: exit 0.
- The strict style scan has only the old S14 array-read false hit.
- SCIP rebuilt all 13 package indexes.
- Core mutation: 85.63, exit 0, one full run under `/tmp/mutation.lock`.
- Mutation counts: 2675 killed, 30 timeout, 424 survived, 30 no coverage, 6 errors.
- The floor is 85; no second mutation run was needed.
- Hono and HTTP mutation did not rerun, per the lead's fix-round brief.
- Their first-round scores remain 88.57 and 89.70.
- Final Jev preflight: 61 source flags reviewed false, each with a saved reason.
- The 12 core trace promises all match; no new trace test is flagged.
- All nine public-symbol ref checks ran after the final rebase.
- The card is in Review; the observed-call timing target is still missed.
- No job is left running; nothing was pushed.
- Raw proof and the full report are in `.bench/stack-t04-fix-proof/`.

## t04 reviewer fix round 1

The reviewer found missing public fields and leaked private state in span JSON.
Add a prototype `toJSON` method and a public regression test.
Use exact SCIP member names and file lists in the impact block.
Verify: the JSON test fails before the fix, the full gate exits 0, and the impact check finds zero gaps.
No rebase or random-draw change is part of this round.

### Reviewer fix proof

- The final JSON test fails without `toJSON`: exit 1, one failure.
- With the method restored: 728 core tests pass; step exit 0.
- The test checks success and failure spans, including their error field.
- JSON contains the public fields only, including ids, attributes, and events.
- The README names that promise and explains why spread and `structuredClone` do not copy the full public span.
- The slot check passes: 253 hot names, last slot 255, zero spare slots.
- The random draws and their order are unchanged.
- Impact rows now use exact member names and explicit file lists.
- They include every package that reads `Observe.Span`, plus the new trace members used by Hono and HTTP.
- The impact tool refreshed the listed packages before checking them.

```text
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Trace#: as planned
  ✓ Scope/Options#typeLiteral206:trace: as planned
  ✓ Observe/Span#typeLiteral37:traceId: as planned
  ✓ Observe/Span#typeLiteral37:spanId: as planned
  ✓ Observe/Span#typeLiteral37:parentSpanId: as planned
  ✓ Observe/Span#typeLiteral37:sampled: as planned
  ✓ Observe/Trace#typeLiteral36:traceId: as planned
  ✓ Observe/Trace#typeLiteral36:parentSpanId: as planned
  ✓ Observe/Trace#typeLiteral36:sampled: as planned
  ✓ Observe/Trace#: as planned
  ✓ Observe/Span#typeLiteral212:traceId: as planned
  ✓ Observe/Span#typeLiteral212:spanId: as planned
  ✓ Observe/Span#typeLiteral212:parentSpanId: as planned
  ✓ Observe/Span#typeLiteral148:traceId: as planned
  ✓ Observe/Span#typeLiteral148:spanId: as planned
  ✓ Observe/Span#typeLiteral148:sampled: as planned
impact stack/t04: as planned (0 discrepancies). Advisory — never a gate.
```

### Reviewer gate proof

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
vp run -r build && vp check && vp run -r test
echo EXIT=$?
vp run prose
```

```text
EXIT=0
core: 728 passed
hono: 65 passed
http: 86 passed
check: 0 errors, 29 warnings
PROSE_EXIT=0
```

- No rebase was done.
- Core source differs from the prior tip only by the `toJSON` method.
- The strict style scan retains only the old S14 array-read false hit.
- TSDoc has zero findings.
- The source review has 62 non-noisy flags, each labeled false with a reason.
- One new label records existing core close bookkeeping; no source rule changed.
- Raw logs are in `.bench/stack-t04-review1-proof/`.

- The JSON regression is clear in the plain test review.
- All 13 trace test titles match their README promises.
- The package-wide review still lists old plain-test notes and 41 old README gaps; none names a trace test.
- The card is back in Review, and all jobs have finished.
- Nothing was pushed.

## t04 fix round 2 — private ID stream

- Owner: stack/t04 writer; lead request after review `43da66df`.
- F1: observation must leave the public random stream unchanged.
- F4: every ID digit must come from generator bits.
- Plan: keep a second seeded generator in a module-private WeakMap.
- The system and custom sources use one core-owned generator seeded once from crypto.
- Keep numeric bits at open and cached hex text on read.
- Reuse the existing no-op function to free one hot-name slot.
- Verify: failing public tests first, then gate, slots, validate, N=31, and core mutation.
- Timing base stays `de72d420`; no rebase, as the prior fix request requires.
- This round replaces the old rule that IDs draw from the user's ambient stream.

- Regression proof before the fix: 3 failed, 12 passed in `trace.test.ts`.
- Both stream tests and the full-width test fail on `c181077f`.
- Source: xorshift128 from [Marsaglia's paper](https://www.jstatsoft.org/article/view/v008i14).
- The user's mulberry32 code stays unchanged; the private generator uses full 32-bit words.

- First green step: build, check, core 730, Hono 65, HTTP 86, slots, prose; `STEP_EXIT=0`.
- Slot proof: 252 hot names, last slot 254; one spare name.
- The lead's probe now matches the fixed base with observation on and off: four draws.
- `own` is `0.06195825757458806`; all numbers and UUIDs match the base.
- Raw regression and probe logs: `.bench/stack-t04-round2-proof/`.

### Kept design and timing

- Kept source: `33583fb6`; fixed base: `de72d420`.
- A local root draws four integer words; its last two words also form its span ID.
- A child or remotely seeded root draws two words.
- Unread roots keep their bits on the span; a child or reader creates the shared trace record.
- Hex text, attributes, and events stay lazy; the JSON promise remains intact.
- All eight N=31 rows pass the budget bar; none is b is slower.

- opobs: 184.2 -> 187.1 ns; slower 25/31; no difference we can see
- op: 67.3 -> 63.0 ns; slower 1/31; b is faster
- opsink: 67.1 -> 62.9 ns; slower 2/31; b is faster
- oplog: 282.7 -> 273.2 ns; slower 4/31; b is faster
- opres: 253.3 -> 254.4 ns; slower 18/31; no difference we can see
- tagged: 173.6 -> 170.4 ns; slower 15/31; no difference we can see
- session: 587.7 -> 582.6 ns; slower 12/31; no difference we can see
- cold: 691.2 -> 697.3 ns; slower 16/31; no difference we can see

- Every case used batch mode in 31/31 pairs per tree.
- Both queue commands ended with `BENCH_EXIT=0`.
- All four layouts and the V8 proof are in the [learning note](../../../research/learnings/2026-09-29-span-off-check.md).
- Final source review: 61 non-noisy flags, each explained and labeled false.
- All 15 trace tests pass the test review and match README promises.
- The package-wide scan has seven old plain-test notes, one old timer note, and 42 old README gaps.
- None of those notes names a changed trace test; broad test and README cleanup is outside this fix.
- The strict style scan keeps only the known S14 array-read false hit; TSDoc has no findings.
- Impact was checked again after the final source change:

```text
✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Span#: as planned
  ✓ Observe/Trace#: as planned
  ✓ Scope/Options#typeLiteral206:trace: as planned
  ✓ Observe/Span#typeLiteral37:traceId: as planned
  ✓ Observe/Span#typeLiteral37:spanId: as planned
  ✓ Observe/Span#typeLiteral37:parentSpanId: as planned
  ✓ Observe/Span#typeLiteral37:sampled: as planned
  ✓ Observe/Trace#typeLiteral36:traceId: as planned
  ✓ Observe/Trace#typeLiteral36:parentSpanId: as planned
  ✓ Observe/Trace#typeLiteral36:sampled: as planned
  ✓ Observe/Trace#: as planned
  ✓ Observe/Span#typeLiteral212:traceId: as planned
  ✓ Observe/Span#typeLiteral212:spanId: as planned
  ✓ Observe/Span#typeLiteral212:parentSpanId: as planned
  ✓ Observe/Span#typeLiteral148:traceId: as planned
  ✓ Observe/Span#typeLiteral148:spanId: as planned
  ✓ Observe/Span#typeLiteral148:sampled: as planned
impact stack/t04: as planned (0 discrepancies). Advisory — never a gate.
```

### Final gate before mutation

- Full requested chain: build, check, core, Hono, HTTP, and every package test; `EXIT=0`.
- Core: 730 tests; Hono: 65; HTTP: 86.
- Check: zero errors, 29 warnings, unchanged from the prior fix round.
- Mutation will use `--timeoutMS 60000 --concurrency 2` under `/tmp/mutation.lock`.
- Those settings address the prior run's 30 timeouts without spending a second full run first.

- `pnpm validate`: all 46 lanes pass; `VALIDATE_EXIT=0`.
- Slots: 252 hot names, last slot 254; one spare name; `SLOTS_EXIT=0`.
- Prose: zero hits; `PROSE_EXIT=0`.
- The final lead probe still matches the fixed base's numbers, UUIDs, and four user draws.
- New label lines this round: `stateOutsideCell false` for `layerRecord`; `noOpRejected false` for `writeCellNs`.
- The other final source labels were already in the bank; each command and reason is saved in the raw proof.

### Final mutation and handoff

- One full core mutation run under `/tmp/mutation.lock`; `MUTATION_EXIT=0`.
- Flags: `--timeoutMS 60000 --concurrency 2` from the start, due to the prior run's 30 timeouts.
- The first command had an extra `--`; the CLI rejected it before any mutation work started.
- The corrected command tested all 3186 changes and finished in 42 minutes, 34 seconds.
- Score: 85.38, above the 85 floor; `index.ts` alone scores 85.20.
- Counts: 2686 killed, 29 timeout, 437 survived, 28 no coverage, 6 errors.
- The longer timeout settings were already in use; no second full mutation run was needed.
- Hono and HTTP mutation were not repeated, as this round asks for core only.
- All requested checks are complete; the card is in Review.
- The fixed timing base and prior no-rebase rule were kept.
- New labels await calibration by the lead at landing.
- No new core feedback beyond the fixed F1/F4 bugs.
- No job remains running; nothing was pushed.
- Full logs, raw rows, label commands, and mutation JSON: `.bench/stack-t04-round2-proof/`.

## t04 reviewer F5 — import draws no random values

- Request: keep the accepted private stream; fix import under a Worker random-value guard.
- System ID state now seeds on the first observed span and stays cached on `SpanImpl`.
- No new module-level name; the stream algorithm, draw order, and lazy hex text stay unchanged.
- Added a real child-process test and the matching README promise.
- The child blocks crypto during import, unobserved work, and scope creation.
- It allows the first observed span, then blocks crypto again while the next span opens.
- Both spans have valid nonzero IDs.
- Before the source fix: the new test failed on import; 15 passed, one failed; `RED_EXIT=1`.
- After the source fix: all 16 trace tests pass.
- `global.mjs` prints `import ok`.
- `stream2.mjs` gives identical test and custom values with observation off and on.
- The custom source still has four calls in each case; `STREAM_EXIT=0`.
- Slots: 252 hot names, last slot 254; one spare name; `SLOTS_EXIT=0`.
- Full requested gate: build, check, and all workspace tests; `EXIT=0`.
- Core: 731 tests; Hono: 65; HTTP: 86; check has zero errors and the same 29 warnings.
- SCIP impact check: zero discrepancies.
- Jev: all 16 trace tests pass and have README promises, including the new import test.
- All 61 source flags match existing false labels; no new label was added.
- The package scan also lists seven old test notes, an old timer note, and 41 old README gaps.
- None names the new test; those old gaps are outside F5.
- Strict style: only the known S14 false hit on the `panics[0]` array read; TSDoc has no findings.
- The requested child-process crypto guard is the only test patch; core is not mocked.
- Timing and mutation were not repeated for this import-only fix; the prior round's numbers stay tied to `33583fb6`.
- No rebase or push; no new core feedback.
- `pnpm validate`: all 46 lanes pass; `VALIDATE_EXIT=0`.
- Prose: zero hits; `PROSE_EXIT=0`.
- Source commit: `2cb01a4f`; the card returns to Review.
- Raw proof: `.bench/stack-t04-f5-proof/`.

## t13 writer plan

- Base: `f8bc981b`, from `origin/main` after t04 and t05.
- Next: add the OTLP/JSON piece and NATS trace headers.
- Verify: stack, NATS, and tracker tests; full gate;
  `pnpm validate`; both mutation lanes at least 85.
- Assumption: a fresh trace sink belongs to each root.
- Use a small OTLP/JSON writer, with no OTel dependency.
  Core already supplies ids, times, and finished spans.
  The official exporters would need SDK-shaped spans and
  the logs SDK excluded by ADR 0076.
- Queue copies encoded records, never the span tree.
  Cap records and bytes; one batch at a time;
  a deadline bounds each HTTP send.
- Impact: add `traceSink` and `TraceSink` to stack.
  Existing callers need no change.
  NATS publish and subscribe call forms stay the same;
  publish and subscription now carry trace context.
  Check stack and the issue tracker as consumers.

### t13 first green step

- Stack: 77 tests passed; NATS: 23 tests passed.
- `vp check`: 0 errors, 29 warnings.
  The clean base at `f8bc981b` also has 29 warnings.
- `vp run prose`: 0 hits.
- Jev tests: 0 flags for stack and NATS.
  README promises: 0 gaps for both.
- Jev preflight: no file flags.
  The driver cleanup set is owned by NATS, not app data.
  Its `stateOutsideCell=false` label is already in the bank.
  The HTTP test receiver owns its packets and socket;
  both fixture flags are labeled false.
  The fixture now has short `listen` and `close` methods.
- The OTLP writer adds zero dependencies.
  Stack built install files: 11,513 → 18,555 bytes.
  Added built files: 7,042 bytes; added gzip code: 2,077.
  `npm pack --dry-run --ignore-scripts --json` also counts
  the README: installed size 18,639 → 29,103 bytes.
  Added installed size: 10,464 bytes; archive: 6,619 → 10,101.
- Cost probe, through `flock /tmp/mutation.lock` and
  `benchctl exec -- node bench/trace-sink.mjs`:
  61 measured batches of 1024 fresh spans with no user fields.
  Minimum 2,726 ns/span; median 3,057; p95 6,809.
  The cost includes lazy id reads and queue encoding.
  It excludes HTTP, scope setup, and batch envelopes.
  All 72,704 spans arrived, including warmup batches.
  This is a cost measure, not a before/after speed claim.
- Assumptions: one sink per root; fixed queue and timer limits;
  HTTP/JSON only; failed sends are dropped without retry.
  These keep the sink small and put a bound on shutdown.
- No public operation call form changed, so no old SCIP
  symbol must disappear.

### t13 core feedback

`start` still drops logs (`core/start-log` already tracks it).
The sink writes failure lines through local `jsonLines`
instead of the start context.
This public probe printed expected 1, actual 0:

```ts
const lines = [];
const scope = createScope({
  observe: { log: (line) => lines.push(line) },
  extensions: [
    extension({
      label: "boot-log",
      start: (_scope, ctx) => {
        ctx.log.warn("boot warning");
      },
    }),
  ],
});
await scope.ready;
await scope.close({ graceful: true });
// Expected: 1. Actual: 0.
console.log(lines.length);
```

### t13 final proof — 2026-09-30

- Ready for lead review; no push.
- Final base: `origin/main` at `46bf018d`.
  The last fetch brought a board-only change; rebase kept it.
  Build, check, the gate tests, all package tests, and all 48
  validation lanes passed again after that rebase.
- Mutation source and tests stayed byte-for-byte unchanged:
  `git diff --exit-code 551b0571 HEAD -- packages/stack`
  and the same check for `packages/nats` both passed.
  The required full lanes were not repeated.
- Final gate, one chain by exit code:

```sh
vp run -r build && vp check \
  && vp run stack#test && vp run nats#test \
  && vp run @tinker-issue-tracker#test
# EXIT 0
```

- Build passed.
- Check: 0 errors, 29 warnings; base also has 29.
- Stack: 78 tests; NATS: 23; tracker: 69; all passed.
- All package tests: `vp run -r test`, exit 0.
- `pnpm validate`: all 48 lanes passed, exit 0.
  `pnpm-workspace.yaml` was restored and is not in the diff.
- Each full mutation lane ran once, at the end, alone
  under `flock /tmp/mutation.lock`, with its 60 s timeout.
  Stack: 87.61; killed 407, timeout 3, survived 58,
  no coverage 0, errors 0; exit 0.
  NATS: 92.66; killed 164, timeout 0, survived 10,
  no coverage 3, errors 0; exit 0.
- Jev test and README checks have no flags or gaps.
  The final source check has one explained driver-state flag;
  `wrapsCallersStep` is a noisy note.
- Labels:
  `stateOutsideCell=false`, NATS `stopSubscriptions`:
  already in the bank as `ab70cbe9e7ba`.
  `effectWithoutDefer=false`, old receiver fixture:
  `64193ad59b5f`.
  `stateOutsideCell=false`, old receiver fixture:
  `049e8ad8bd5c`.
- `node tools/jev/calibrate.mjs` completed, exit 0.
  Its saved JSON is included with the labels.
- Both package style censuses: OK.
- Raw gate logs, mutation JSON, and cost results:
  `.bench/stack-t13-proof/` in the writer worktree.
- No target was dropped.
  The HTTP/JSON choice, fixed limits, one piece per root,
  and dropping failed batches are the noted assumptions.

### t13 reviewer fix round 1 — 2026-09-30

- User asked for all six fixes, with no rebase and no push.
- Queue retains finished span and log references.
  Flush reads ids and encodes them, in arrival order.
  Count is capped before enqueue; bytes are capped at flush.
  A full queue never encodes the rejected record.
- Bigint and safe integer attributes use decimal strings.
  Other finite numbers keep their double value.
- Forced close aborts the send and drops queued records.
  Graceful close has one shared second for network work.
  Assumption: that window starts when the close hook starts.
  It uses the scope clock; tests advance the test clock.
- Ok spans omit status; failed spans carry code 2 and a message.
- Every 2xx reply counts as delivered; tests use 202 and 204.
- NATS builds headers only when a calling span exists.
  The new test checks a raw subscriber and sent byte counts.
  Both checks also pass on the old code with this installed client:
  its empty headers encode to zero bytes, but still select HPUB.
  Kept the branch change small, as the review permits.
- Eleven stack checks fail against the old implementation.
  The forced-close pair was rerun after fixing its expected
  core result: forced close returns cancelled, not success.
  Both fail because the old sink sends a new request at close.
- First green step: build; check 0 errors and 29 warnings;
  stack 87 tests; NATS 24 tests; prose 0 hits.
- Core feedback is unchanged from the first round.
  No span-kind, traceparent-parser, or core-clock change.

#### Round 1 fresh gate after an outside worktree change

- First fix commit: `9c964de1`.
- While validation ran, another process rebased this worktree.
  The reflog records it at 02:44 UTC on 2026-09-30.
  The writer ran no rebase command.
  The new base is `2700a440`, which adds t06.
  The fix commit is now `54922a9b`.
  Kept those incoming changes and ran `vp install` and build.
- The mixed-tree validation failed two lanes and is not proof.
  Its check and stack tests ran while t06 files changed.
- Fresh gate: EXIT 0; stack 92, NATS 24, tracker 79 tests.
  Check: 0 errors, 29 warnings, unchanged from the old base.
- Jev: no file flags, test flags, or README gaps.
  The NATS cleanup-state flag keeps its existing false label,
  `ab70cbe9e7ba`; no new labels were added.
  The `wrapsCallersStep` hit remains a noisy note.
  Style census: OK for both packages.
- Callback cost at `9c964de1`: minimum 47 ns/span,
  median 93, p95 197; all 72,704 spans reached the collector.
  Trace source and tests did not change in the outside rebase.
  [Cost notes](../../../research/learnings/2026-09-30-trace-sink-flush.md).

## t17 writer notes

Owner: stack/t17 writer. Branch: `stack/t17`.
Status: Review.
Next: lead reviews and lands `stack/t17`.
Verify: Hono, Drizzle, stack, tracker, browser proof,
`vp check`, `pnpm validate`, Hono mutation at least 85.

The request and stream close behavior changes.
Callers: the issue tracker, stack tests, Hono tests,
and the Hono, Drizzle, and sync examples.
No existing symbol is renamed or removed.
`RequestCloseFailed` is a new Hono error kind.
The successful-save case is a guard and stays green on main.

First green step: Hono 73 tests pass.
`vp check`: 0 errors, 29 warnings.
`vp run prose`: 0 hits.

Before the fix, at `8df4b19b` (fetched origin/main):

```text
failed commit: expected 500, received 201
mapped 409: expected [], received [{title: 'A'}]
unmapped error: expected [], received [{title: 'A'}]
stream commit: reader resolved done instead of rejecting
Tests: 4 failed, 1 passed
```

The successful-save guard passed before and after.
The unmapped managed error also kept writes before the fix.
Hono now gives the request a session body.
The body rethrows the route error after Hono builds its answer.
This makes both mapped and unmapped errors roll back.
The close waits for teardown and session hooks before the answer leaves.
A stream waits for close before it ends cleanly.

### Stream and tracker checks

- Hono: 78 tests pass.
- Stack: 38 tests pass.
- Tracker: 69 tests pass.
- Browser proof and its 7 helper tests pass.
- Main at `8df4b19b`: `vp check` has 29 warnings,
  the same count as this branch.
- Main keeps `success` for both mapped panic and raised-error tests.
  The new expected outcome, `failed`, fails there.
- Main returns 200 when a session hook reports failure.
  It returns 409 when cleanup fails after a mapped error.
  Both now return 500 and log once.
- A synchronous stream error keeps the old 500 body,
  and its request closes before that answer leaves.
- Late requests after scope close and a final chunk during
  forced shutdown are guards for the old behavior.

The tracker needed one extra fix in `packages/stack/src/server.ts`.
Waiting for stream close exposed an HTTP stop gap:
an old keep-alive connection could ask the closed scope for `/sync`.
Its 500 stopped the browser from reconnecting after restart.
The listener now stops accepting requests before the scope drains.
It also closes idle connections when their last response finishes.
The public stop test fails on main: a late fetch returns 500
instead of refusing the connection.
The browser proof failed without the idle-connection fix.
No tracker source or browser test was changed.

Tracker route audit:

- `createIssue` writes an issue and activity in one transaction.
  A later database error now rolls them both back.
- `editIssue` calls `checkFresh` before `writeIssue` or activity.
  A stale 409 never relied on keeping a write.
- `addComment` calls `loadSaved` before writing.
  A missing issue never relied on keeping a comment.
- Input checks run before those operations write.
- Detail, list, draft, and sync routes do not save through `store.tx`.
- The browser proof compares the full saved detail before
  and after a stale 409; the issue and activity stay unchanged.

Core behavior: a driver that maps a raised error must keep
a session body to carry that failure.
A bare session plus `settle` recovers the error by design:

```ts
const s = scope.createSession();
await s.settle(saveThenRaise);
const ended = await s.close({ graceful: true });
expect(ended.status).toBe("failed");
// Gets success; the write commits.
```

Hono uses `scope.session` and rethrows the original error
in its body after building the mapped answer.
No core change is needed for this fix.
This is by design, not a Core feedback issue.

### t17 rebase

Rebased onto `6330012c`, which includes t12.
Kept all t12 source and track notes.
Its new mapped-error test expected a 409 to commit and signal.
Updated that test and its README line for ADR 0084:
a raised error keeps its 409, rolls back, and sends no signal.
Only the two appended track-note blocks conflicted.
The five PGlite tests use a 30-second limit:
three hit the old five-second limit on the busy host.
Their checks are unchanged.

The updated live test fails on main at `6330012c`:
it finds the saved `Taken` row instead of no rows.
The final close tests fail there too: hook failure answers 200,
teardown after a mapped error answers 409, and a synchronous
stream error leaves its request cleanup pending.
The late-request and forced-final-chunk guards both pass there.

Jev: 0 of 78 Hono titles and 0 of 25 stack titles flagged.
No README promise gaps; nine Hono and one stack matches unsure.
The three old Hono helper-size/count notes are unchanged.
They are plain checks, with no model judge to label.
The new tests add no helpers.
Labels: `effectWithoutDefer=false` for `stream` and `listen`;
`stateOutsideCell=false` for `listen`.
Stream completion owns the request close.
The server defer joins the listener stop promise.
The listener's close flag is private stop bookkeeping.
The noisy `wrapsCallersStep` note owes no label.

Gate on `6330012c`: build, check, Hono 78, Drizzle 13,
stack 58, tracker 69, prose; `EXIT 0`.
Check: 0 errors and 29 warnings, matching main.
Strict style census: OK.

The browser proof and its 7 helper tests pass on the new base,
`BROWSER_EXIT 0`.
It checks stale edits, saved rows after restart,
and live sync reconnect after a server stop.
Assumption: a raised error causes rollback;
a normal returned 4xx response does not by itself mean failure.

All 17 package test tasks passed through their own configs,
`ALL_TESTS_EXIT 0`; four used cached green results.
Used `vp run -r --concurrency-limit 1 test` after the build.
The final fetch still points to `6330012c`.
The migrate ticket has not landed yet.

`pnpm validate`: all 48 checks passed, `VALIDATE_EXIT 0`.
Ran in the foreground under `/tmp/mutation.lock`.
Restored `pnpm-workspace.yaml`; it has no branch change.

### t17 mutation checks

First full Hono run: 92.76, 273 killed, 73 timed out,
25 survived, 2 without coverage, 0 errors; `EXIT 0`.
The busy-host rerun used `--timeoutMS 60000 --concurrency 2`.
It got 84.45, 315 killed, 0 timed out, 56 survived,
2 without coverage, 0 errors; `EXIT 1`.
The first score hid gaps behind timeouts.
One earlier launch passed an extra `--` to Stryker;
it rejected those flags before running any tests.

Added two public checks for real cleanup failures:
reader cancellation logs the cleanup failure once;
a failed writer keeps its reader error and logs cleanup once.
Both fail on main at `6330012c`: the failure log is empty.
Both pass on this branch, with no further source change.
Hono now has 80 passing tests.
Jev: 0 of 80 titles flagged, no README gaps, eight unsure.
Check: 0 errors, 29 warnings; prose and strict census pass.
Rebased onto `be6a9526`; its only change is the board.

Final gate after the new tests and rebase: build, check,
Hono 80, Drizzle 13, stack 58, tracker 69; `EXIT 0`.
Check: 0 errors, 29 warnings.
All 17 package test tasks passed again from cached results.
The browser proof ran again without cache; all 7 helpers passed.
`ALL_BROWSER_EXIT 0`.

### t17 final proof

Final full Hono run, with the two cleanup tests:
86.06, 321 killed, 0 timed out, 50 survived,
2 without coverage, 0 errors; `MUTATION_FINAL_EXIT 0`.
Used `--timeoutMS 60000 --concurrency 2` under the lock.
Both source files and all 373 mutations stay included.
The floor stays 85.

Six former survivors now report `Killed`:

- `src/index.ts:338` and `339`: closing once.
- `src/index.ts:383`: two ways to skip the writer cleanup log.
- `src/index.ts:390`: two ways to skip the cancel cleanup log.

The last `pnpm validate` passed all 48 checks, `VALIDATE_EXIT 0`.
`pnpm-workspace.yaml` has no branch change.
The last fetch and rebase still point to `be6a9526`.
The migrate ticket has not landed on `origin/main`.
The source and tests are the ones checked by the final gate.

Proof logs are in `/home/paseo/.cache/tinkered-briefs/`.
Mutation logs and JSON files use these names:

- `stack-t17-mutation-default`
- `stack-t17-mutation-60s`
- `stack-t17-mutation-final`

The gate is in `stack-t17-final-gate.log`.
The last browser run is in `stack-t17-final-all-browser.log`.
The two cleanup failures on main are in `stack-t17-cleanup-main-red.log`.
The final validator output is in `stack-t17-final-validate.log`.
All long jobs finished in this turn.
Nothing was pushed.

### t17 review round 1

Status: Review. Owner: stack/t17.
Next: lead reviews the three fixes and lands the branch.
Verify: new tests fail before the fixes, then pass.
Run the requested build, check, Hono, Drizzle, stack, and tracker gate,
plus prose, Jev, and the strict style census.
Keep this branch's base; do not rebase or push.
Hono source changed only for F2; mutation was not repeated.

Choice: reject a second live root with `PieceInUse`, as NATS does.
Bind close to its root because the extension close hook has no scope.
Each start owns its listener state; close releases the piece for reuse.
The callers are the tracker's server root and stack's server,
client, and settings tests.
No caller needs to change.

Before the fixes, all three new tests failed on this branch:

- Restart: the second closed root still answered 500.
- A second live root: ready raised the port-in-use error,
  not `PieceInUse`.
- Failed commit: both response builders kept `sid=abc`
  and `/x/1` in their cookie and location headers.

The tests now pass, including both header-building paths.
F2 clears the built answer before setting a fresh 500 Response.
F3 documents the built status in the request log and span.
The log still runs where it did before this review.

Gate: build, check, Hono 81, Drizzle 13, stack 60,
tracker 69; `EXIT 0`.
Check: 0 errors and 29 warnings, unchanged.
Prose: 0 hits. Strict style census: OK.
Jev: 0 of 81 Hono titles and 0 of 27 stack titles flagged.
No README promise gaps; nine Hono and one stack matches unsure.
The three existing helper-size/count notes are unchanged;
the new tests add no helpers.
The three labels are already in the bank and remain false:
`effectWithoutDefer` for `stream` and `listen`,
and `stateOutsideCell` for `listen`.
No new source flag or Core feedback issue.

Logs are in `/home/paseo/.cache/tinkered-briefs/`:
`stack-t17-review1-red-stack.log`, `stack-t17-review1-red-hono.log`,
`stack-t17-review1-green.log`, and `stack-t17-review1-jev.log`.
All jobs finished in this turn; no rebase or push.

### t17 server mutation lift

Status: Review. Owner: stack/t17.
Base: `dd8a1f18`, checked before editing; no rebase or reset.
Next: lead reviews and lands the tested branch.
Verify: rank survivors, run the line kill check under the lock,
then one full stack lane at 60 seconds with killed share at least 85%.
Run the full requested gate, uncached browser proof, and validator.
Keep t04's traceparent read and t06's migrate step unchanged.

Ranked all 48 survivors; 25 are in `server.ts`.
The survivor judge is marked noisy, so its rows are advice only.
Added real-socket checks for an old root closing again,
failed-start cleanup and reuse, and the last stream chunk at stop.
The live-owner test now holds a close hook after draining and
checks that a new root still gets `PieceInUse` until close ends.
The existing in-flight request and restart tests stay in the gate.
No source or mutation setting changed.

First green step: build, check, stack 68, prose; `EXIT 0`.
Check has 0 errors and 29 warnings.
Jev: 0 of 35 titles flagged; no README gaps, one unsure.
No changed source to judge and no new label owed.
Strict style census: OK.

Line kill check, `src/server.ts:35-125`, under `/tmp/mutation.lock`:
`[Killed] 91`, `[Timeout] 0`, `[Survived] 7`; `EXIT 0`.
Killed share: 92.86%; no errors or uncovered mutants.
Eighteen of the 25 old server survivors were killed.
All idle-socket and release survivors were killed.
The remaining seven are the late-bind stop flag and branch,
optional logging, the clock choice, and three input-check changes.
The late-bind guard still handles close racing with listen;
no code was judged safe to remove merely because its mutant survived.
The line log is `stack-t17-lift-lines.log` in the briefs cache.

Full stack lane, once and alone under the lock, at 60 seconds:
282 killed, 3 timed out, 30 survived; `FULL_MUTATION_EXIT 0`.
Killed share is `282 / (282 + 3 + 30) = 89.52%`, above 85%.
Stryker's score, which includes timeouts, is 90.48%.
All three timeouts are in `migrate.ts`.
Server: 103 killed, 0 timed out, 7 survived.
All 315 mutants remain included, with no uncovered mutants or errors.
The new tests killed the same 18 old server survivors in the full lane.
No source was changed or removed; no mutation setting or floor changed.
The temporary mutation tree was already gone after the line check.
Full log and JSON: `stack-t17-lift-full.log` and
`stack-t17-lift-full.json` in the briefs cache.

Final gate: build, check, Hono 84, Drizzle 25, stack 68,
tracker 79; `EXIT 0`.
Check: 0 errors and 29 warnings, unchanged.
The tracker browser proof ran once uncached; all 7 helper tests passed,
`BROWSER_EXIT 0`.
`pnpm validate`: all 48 lanes passed, `VALIDATE_EXIT 0`.
An extra validator lock wait was cancelled before the validator started;
that wait exited 143, then the requested direct run passed.
Both mutation runs used the lock; neither was cancelled.
`pnpm-workspace.yaml` already allowed the esbuild build and is unchanged.

The old server survivors now killed are 174, 181, 185, 191, 192,
193, 194, 195, 196, 197, 270, 272, 273, 275, 276, 277, 278, and 279.
The remaining server survivors are 176, 200, 201, 204, 214, 230, and 255.
These IDs are from the full JSON report.
No new Jev labels or Core feedback issues.
All three existing labels stay unchanged.
No source, config, floor, t04 trace read, or t06 migration changed.
No rebase, reset, or push; all jobs finished in this turn.

Final logs in the briefs cache: `stack-t17-lift-gate.log`,
`stack-t17-lift-browser.log`, and `stack-t17-lift-validate.log`.

### t17 resume on the authoring model

Owner: stack/t17 writer. Status: Doing.
Next: finish the fresh gate, both mutation lanes,
four uncached browser runs, and the validator.
Verify: the gate exits zero; each lane's killed share reaches 85%.
The lead owns landing. Nothing is pushed by this writer.

The worktree arrived at `547c23a1`, not the brief's `188e3337`.
Its board commit touched only this file.
Dropped that commit with `git reset --hard HEAD~1`.
That also discarded the saved docs-only edit.
Assumption: the same board-only landing commit had been rebased.
The remaining head, `2298ea28`, already included `741f5f84`.
The first rebase had no new conflicts.

Read ADRs 0084–0091 from origin/main before checking the merge.
Hono keeps main's aborted-request and failed-stream-start cleanup,
its trace reads, and Core's call ownership.
It also keeps t17's session body, commit before reply,
rollback after a raised error, and fresh 500 after failed close.
Stack keeps its per-start listener state and `PieceInUse` owner.
Close stops accepting requests before draining them.
The listener closes idle sockets after their last response.
Main's publisher and telemetry changes are unchanged.

Fresh main check at `217a4fe3`: zero errors, 28 warnings.
The branch check has the same count.
Fresh main red proof: nine failures and four passing guards.
Commit failure still answers 201; mapped and unmapped errors keep A.
Failed stream commit still ends its body without an error.
Main now passes the synchronous stream cleanup guard.
Only the ticket's tests and their dependencies were copied there.
The main source stayed unchanged.

An old lander was still testing mutations in this worktree.
Asked it to stop and release the worktree through Paseo.
It stopped before this writer started a mutation lane.
The overlapping run caused two Drizzle test timeouts.
The gate passed when repeated after that job stopped.

Jev source flags: stream owns request close;
server defer owns listener stop; the closing flag belongs to that listener.
The three labels remain false.
The stream label now captures the merged source.
The noisy `wrapsCallersStep` note owes no label.
No README promise gaps; strict style census and prose pass.
The old Hono helper-size and count notes are unchanged.
They are plain notes, with no model judge to label.

Assumption: a raised error rolls back;
a returned 4xx alone does not fail a request.
The tracker checks freshness and missing rows before writing.
None of its routes need writes kept after a raised error.

Proof logs use `stack-t17-resume-*` in the briefs cache.

Rebased all 17 commits onto `217a4fe3` without conflicts.
That main change only moved the board cards back to Doing.
Install passed; the worktree is clean.
Fresh gate after the old mutation stopped:
build, check, Hono 86, Drizzle 25, Stack 111, tracker 79.
The gate ended with `EXIT 0`.
Check: zero errors, 28 warnings, matching main.
Log: `stack-t17-resume-gate-clean.log`.
The temporary main red-proof worktree was removed.

All 18 test tasks passed through their package configs,
`ALL_TESTS_EXIT 0`; 17 used cached green results.
The ticket's four suites also passed fresh in the gate above.
Used one task at a time after a build.
Log: `stack-t17-resume-all-tests.log`.

All four tracker browser proofs passed without cache.
Each run also passed its seven helper tests.
Each printed `BROWSER_<run>_EXIT 0`.
They check saved rows, stale 409 edits, and live reconnect after restart.
They also check phone-sized controls and no sideways scroll.
No tracker source or browser test was changed.
Logs: `stack-t17-resume-browser-1.log` through `-4.log`.

One Hono lock wait exited 143 before any mutation tests started.
The empty log and lack of a child process proved it was only waiting.
Stopped that wait to run the four browser proofs.
The full Hono lane then ran once with a 60-second limit.

`pnpm validate` passed all 48 lanes, `VALIDATE_EXIT 0`.
The workspace already allowed esbuild; restored the file after the run.
It has no branch change.
Log: `stack-t17-resume-validate.log`.
Browser proof and validation ran before the mutation lanes,
using their queue wait; the source stayed unchanged.
Both fresh mutation lanes followed.

Fresh full Hono lane: `HONO_MUTATION_EXIT 0`.
370 killed, zero timed out, 56 survived, two without coverage.
No errors; all 428 mutants stayed included.
Killed share: `370 / (370 + 0 + 56) = 86.85%`.
Stryker score: 86.45%; both clear the floor of 85.
Ran once under the lock, with a 60-second limit and two runners.
Log and JSON: `stack-t17-resume-hono-mutation` in the briefs cache.
Stack was already waiting and started after Hono released the lock.
The source and mutation settings stayed unchanged.

Fresh full Stack lane: `STACK_MUTATION_EXIT 0`.
552 killed, three timed out, 89 survived, two without coverage.
No errors; all 646 mutants stayed included.
Killed share: `552 / (552 + 3 + 89) = 85.71%`.
Stryker score: 85.91%; both clear the floor of 85.
Ran once under the lock, with a 60-second limit and two runners.
Log and JSON: `stack-t17-resume-stack-mutation` in the briefs cache.
Hono had already started when the shared-lock request arrived.
Kept it running and queued Stack, as the lead's fallback allowed.
Stack took the lock next; no lane ran between them.

Both lanes ended before creating `t17-mutation.done` in the briefs cache.
The marker now lets the other writers queue their lanes.
The checked Hono, Stack, tracker, Core, and lockfile trees are unchanged.
No code or tests changed during this resume.
The branch is ready for lead review; this writer did not push.
Core feedback: none new.

## t18 writer — 2026-09-30

Owner: stack/t18 writer.
Branch: `stack/t18`.
Next: lead review and landing; the writer has not pushed.
Verify: stack and tracker tests, browser proof, real entry
exit codes, plain lifetime rules, validation, and mutation.

### t18 impact before code

- Remove the public `runUntilStop` function.
  Its callers are the tracker's server entry and the
  stack's server tests; the stack README shows it too.
- Add `readExitCode(result, observe, phase)`.
  The result and observe config are borrowed.
  The helper owns no scope and does not wait or close.
- A failed result or any teardown error answers 1.
  Every other result, including cancellation, answers 0.
- Assumption: the root supplies `"boot"` or `"shutdown"`
  because core's result has no boot marker.
  Reading ready's outcome chooses the existing log line;
  only core owns cleanup and the stop listener.
- Keep the tracker's extension order from t06.
  Rebase on t17 before the final gate and keep its server
  changes. Leave the parallel root migration alone.
- Review: index stack and check both helper symbols.
  The removed symbol must print `(none)`.

```sh
scripts/scip.sh index stack
scripts/scip.sh refs 'runUntilStop' stack
scripts/scip.sh refs 'readExitCode' stack
```

### t18 first green step

- Commit `4ad58653` replaces the old helper with
  `readExitCode` and moves the tracker onto core's stop
  signal and `closed` result.
- Build, `vp check`, and stack tests: exit 0.
  Stack: 65 tests in eight files.
  Check: zero errors and 28 warnings.
  A separate `origin/main` worktree at `f8acfee5` also
  built and checked with zero errors and 28 warnings.
- Tracker: 79 tests in nine files, exit 0.
- Browser proof and seven browser-helper tests: exit 0.
- The real server entry answered 0 on SIGTERM.
  Bad PORT answered 1 with one `boot failed` line and
  `payload.keys` equal to `["PORT"]`.
- SCIP: `runUntilStop` printed `(none)`.
  `git grep` found no old helper in packages or apps.
  `rg` is not on PATH; `git grep` checked tracked files.
- Jev over `origin/main..HEAD`: no source flags.
  Stack tests: zero of 30 titles flagged.
  README promises: zero missing lines.
  No labels were needed for this ticket.
- The required `main..HEAD` run also read core's root
  lifetime changes because local main was still at t06.
  Its 61 unit flags are outside this ticket's diff.
  The remote-base run above checks only this ticket.
- The plain directory lint found no S19, S27, S28, or
  S29 rows. S19's wider reach and S29 have not landed.
  Two unchanged factory notes remain in `publish.ts`
  and `testing.ts`: each factory binds its own inputs.
- TSDoc: zero S26 rows. Style census: OK.
- Core feedback: no new failing case.

### t18 wider checks before the t17 landing

- `pnpm validate`: all 48 lanes passed, exit 0.
- `vp run -r build && vp run -r test`: exit 0;
  all 17 workspace test tasks passed.
- The cancellation test now awaits `run()` instead of
  discarding a `settle()` result; each case names its
  exit code. Build, check, and stack tests passed again.
- The README's root example fits a 60-character line.
- t17 is still absent from `origin/main` at `f8acfee5`.
  The final rebase, gate, and mutation run wait for it.

### t18 final gate before mutation

- Rebased onto t17's checked commit `31334686`, then
  onto `origin/main` at `b78302c1` for S19 and S29.
  Assumption: the checked t17 branch is the intended
  dependency while its landing on main is still pending.
  The t17 code ends at `090d07e8` in this branch.
  The t17 server and Hono source are unchanged.
- Kept the tracker's order: server, migrate, web, src,
  then the live piece when NATS_URL is set, else publish.
- The only rebase conflict was the track notes.
  Both sets of notes are kept.

```sh
vp run -r build && vp check \
  && vp run stack#test \
  && vp run @tinker-issue-tracker#test
```

```text
check: 0 errors, 28 warnings
stack: 70 passed (8 files)
tracker: 79 passed (9 files)
EXIT 0
```

- The warning count matches the main baseline check.
- `pnpm validate`: all 48 lanes pass, exit 0.
- `vp run -r test`: all 17 tasks pass, exit 0.
- Browser proof and seven browser-helper tests: exit 0.
  One earlier browser attempt overlapped validation's
  package rebuild and could not import stack's dist.
  Running it after validation passed without a code change.
- Real entry: SIGTERM exits 0 with no boot failure line.
  Bad PORT exits 1 with exactly one `boot failed` line,
  whose `payload.keys` is `["PORT"]`.
- New plain rules: no S19, S27, S28, or S29 rows in
  the tracker's server source or the stack's source.
  The same two factory notes remain; no label is owed.
- Jev over this ticket's diff: zero source flags.
  Stack tests: zero of 35 titles flagged.
  README promises: zero missing lines.
  New label lines: none.
- SCIP: the deleted helper prints `(none)`.
  Its replacement has refs in the public entry and tests.
  No old helper remains in tracked packages or apps.
- Style census: OK.
- Prose lint: zero hits.
- Core feedback: no new failing case.

### t18 final mutation and handoff

- The full stack lane ran once, alone under the lock.
  Its config kept `timeoutMS: 60000` and the floor of 85.

```sh
flock /tmp/mutation.lock \
  vp run --no-cache stack#mutate
```

```text
All files: 88.74%
Killed: 268
Timeout: 0
Survived: 33
No coverage: 1
Errors: 0
EXIT 0
```

- The new exit helper scored 85.71%: 18 killed and
  three survived, with no timeout or uncovered code.
- Report: `packages/stack/reports/mutation/mutation.json`.
  The command log is `/tmp/stack-t18-mutation.log`.
- This proof covers the checked t17 code plus t18 on
  `origin/main` at `b78302c1`.
  t13 landed on main while this lane waited for the lock;
  it is outside this tested base.
  The lead must rebase and run the landing checks on
  current main, as the contributor rules require.
- New Jev label lines: none; no new Core feedback.
- No push. The card is in Review.

### t18 reviewer fix round 1

- Keep teardown errors on the same failed boot log line.
  Prove it through a real root with two start hooks.
- Read the log phase straight from ready in the server
  entry and README example.
- Assumption: this round keeps the reviewed base and
  touches only the two fixes, their test, and this proof.
- The new test failed without the fix: the single log
  line had no `teardown` field.
  The fix adds that field and keeps the message,
  other fields, and exit code of one.
- Gate: build, check, stack tests, tracker tests.

```text
check: 0 errors, 28 warnings
stack: 71 passed (8 files)
tracker: 79 passed (9 files)
EXIT=0
```

- The warning count matches the reviewed base.
- Prose lint: zero hits; README code lines under 60.
- Jev lint: no S19, S27, S28, or S29 rows.
  The two old factory notes remain in `liveUpdates`
  and `createTestDatabase`: each binds its own inputs.
  These plain code notes need no labels.
- Jev pre-flight: zero flags in the changed source.
  Stack tests: zero of 36 titles flagged.
  README promises: zero missing lines.
  The new test matches its promise exactly.
  One unsure old live-signal title is already promised
  across two README lines; no change is needed.
- Style census: OK.
- New Jev label lines: none; no new Core feedback.
- Logs: `/tmp/stack-t18-r1-gate.log` and
  `/tmp/stack-t18-r1-red-test.log`.
- Next: run the full stack mutation lane once under
  the lock, then save its proof here.

### t18 resume on main

Owner: stack/t18 writer.
Status: Review.
Next: lead review and landing.
Verify: stack and tracker tests, browser proof, real entry,
SCIP, lifetime lint, stack mutation K/T/S, and validation.

- Base: `217a4fe3` from `origin/main`.
- Another writer rebased the same worktree onto the
  stopped lander's t17 tip while the briefs were read.
  Its `1a01f415` held the same eight t18 commits.
  Used `git rebase --onto origin/main 547c23a1` to move
  only those eight onto main.
  This leaves out t17 and its board commit.
- The first t18 commit conflicted in this file.
  Kept main's notes and t18's notes.
  Left t17's notes on its own branch.
- The duplicate writer then repeated its t17 rebase
  during the build, producing `f5ba6331`.
  Stopped the duplicate run and the mixed-base gate.
  Saved the useful trace test edit and its README line.
  Discarded unsaved track notes.
  Restored the completed main rebase at `cc96f012`.
  Reapplied the test and README edits.
- No rebase is in progress; no old gate is still running.
- Kept main's trace cleanup fix (`da27c9cc`).
  Missing or invalid config still closes with its boot error.
  Its test now checks exit code 1 and one boot failure line.
- Assumption: ready's outcome supplies the log phase.
  Core owns cleanup through `signal` and `closed`.
- No t17 code is needed: the main-only build and gate pass.
- Gate: build, check, stack, tracker; `EXIT 0`.
  Stack: 109 tests in 12 files.
  Tracker: 79 tests in nine files.
  Check: zero errors and 28 warnings.
  The clean main check at `217a4fe3` also has 28 warnings.
- The boot teardown test fails with the old helper behavior:
  its log has no teardown field, `RED_EXIT 1`.
  Restoring the fix makes it pass, `GREEN_EXIT 0`.
  The source is restored with no diff.
- SCIP: the old helper has no definition or reference.
  The new helper is used by the server and trace tests.
  `rg runUntilStop packages/ apps/` has no matches.
- Jev: zero source flags and zero of 52 test titles flagged.
  No missing README promises; one old title is unsure.
  New label lines: none.
- The required directory lint has no S19, S27, S28,
  or S29 row; these rules are present on main.
  Seven old factory notes remain.
  The trace factory makes its own config tag and graph.
  The test database factory binds its own migrations.
  These plain notes need no label.
- Strict style census: OK; TSDoc: zero S26 rows.
  Prose lint: zero hits.
- All 18 package test tasks pass through their own configs,
  `ALL_TESTS_EXIT 0`.
- The browser proof and seven browser helper tests pass,
  `BROWSER_EXIT 0`.
- The real entry answers GET with HTTP 200 and exits 0
  on SIGTERM.
  Bad PORT exits 1, writes one boot failure line,
  names only PORT, and creates no database.
- The final fetch still points to `217a4fe3`.
  `git rebase origin/main` reports up to date.
- The clean main check worktree was removed.
- Logs: `/tmp/stack-t18-resume-gate-final.log`,
  `/tmp/stack-t18-main-baseline.log`,
  `/tmp/stack-t18-resume-red.log`,
  `/tmp/stack-t18-resume-green.log`,
  `/tmp/stack-t18-resume-jev.log`, and
  `/tmp/stack-t18-resume-lint.log`.

### t18 checks after t17 landed

- Waited for the lead's t17 mutation marker.
  The cancelled lock wait had not started a lane.
  Waited again until the lead confirmed t17 had landed.
- Rebased only t18's ten commits onto `870beab4`.
  This is `origin/main`, tagged `stack/t17`.
  No unlanded t17 commit remains on this branch.
- Conflict: `docs/roadmap/stack-v1/PROGRESS.md`.
  Main adds t17's checked landing notes.
  The ticket adds t18's impact and proof notes.
  Kept both sets; no source conflict needed a choice.
- Install: exit 0; no file changed.
- The ticket's one gate chain passed, `GATE_EXIT 0`.
  Build passed; check has zero errors and 28 warnings.
  Stack: 114 tests in 12 files.
  Tracker: 79 tests in nine files.
- A clean `870beab4` worktree also builds and checks
  with zero errors and 28 warnings, `MAIN_CHECK_EXIT 0`.
  The clean worktree was removed after the check.
- All 18 package test tasks pass through their own configs,
  `ALL_TESTS_EXIT 0`.
- Browser proof and seven browser helper tests pass,
  `BROWSER_EXIT 0`.
- The real entry serves HTTP 200 and exits 0 on SIGTERM.
  Bad PORT exits 1 with exactly one boot failure line.
  Its payload names only PORT; it creates no database.
- SCIP finds no old helper; `rg` has no old caller.
  The required lint has no S19, S27, S28, or S29 row.
- Strict style census: OK; TSDoc has zero S26 rows.
- Jev on `origin/main..HEAD`: zero source flags.
  Stack: zero of 57 titles flagged; no promise gap.
  New label lines: none.
- The required `main..HEAD` run also reads unrelated
  examples and landed Hono and server changes.
  Local main is `600992f7`, behind the tested remote base.
  Its 18 unit flags are outside t18's diff.
  The remote-base run above checks only this ticket.
  The directory lint's seven factory notes need no labels.
- Logs: `/tmp/stack-t18-final-gate.log`,
  `/tmp/stack-t18-final-browser.log`,
  `/tmp/stack-t18-final-entry.log`, and
  `/tmp/stack-t18-final-bad-port.log`.
- The earlier mutation proof is from the paused base.
  The current lane and validation are recorded below.

### t18 current mutation proof — 2026-10-01

- Ran once after t17 landed, alone under `/tmp/mutation.lock`.
  Waited in this turn until the shared lock was free.
  Kept the 60-second config and used two workers.

```bash
flock /tmp/mutation.lock \
  vp run --no-cache stack#mutate --concurrency 2
```

```text
Killed: 548
Timeout: 3
Survived: 89
No coverage: 2
Errors: 0
MUTATION_EXIT 0
```

- Kills alone: 548 of 640, or 85.625 percent.
  With the two uncovered rows: 548 of 642, or 85.36 percent.
  Both exceed the floor of 85.
  Stryker's score, which counts timeouts, is 85.83.
- Timeouts: `src/publish.ts:97`, `src/trace.ts:220`,
  and `src/trace.ts:221`.
  These source files are unchanged by this ticket.
- The first test run passed all 114 tests.
  Source files remain unchanged after the lane.
- Report: `packages/stack/reports/mutation/mutation.json`.
  Saved a copy as `stack-t18-final-mutation.json`
  in `/home/paseo/.cache/tinkered-briefs`.
  Log: `/tmp/stack-t18-final-mutation.log`.
- `pnpm validate`: all 48 lanes pass, `VALIDATE_EXIT 0`.
  `allowBuilds.esbuild` was already true.
  Restored `pnpm-workspace.yaml` after validation.
- No new Jev labels or Core feedback.
  No source or config edit followed the gate.
- Final logs and the mutation report are also saved in
  `/home/paseo/.cache/tinkered-briefs`.
  Validation log: `/tmp/stack-t18-final-validate.log`.
- Status: Review; next is lead review and landing.
  Nothing was pushed.

### t18 final main refresh — 2026-10-01

- Main moved during the lock wait to `22b91ecf`.
  Its four new commits give each example its own package.
  Read ADR 0092 before the final refresh.
- Rebased all twelve t18 commits onto that main.
  This rebase has no conflicts.
  Install passed; it changed no tracked file.
- Compared the old checked head `821b1416` with the new head.
  Stack's source, tests, configs, and README are byte-for-byte equal.
  Core, Hono, Drizzle, NATS, and tracker are also byte-for-byte equal.
  No mutation input or runtime dependency changed.
  The one full mutation lane above still covers this code.
- The browser and real-entry proof also cover identical code.
  Their logs remain the `stack-t18-final-*` logs above.
- Re-ran the ticket's full gate on `22b91ecf`, `GATE_EXIT 0`.
  Build passed; check has zero errors and 28 warnings.
  Stack: 114 tests in 12 files.
  Tracker: 79 tests in nine files.
- All 28 package test tasks pass, with no cached result,
  `ALL_TESTS_EXIT 0`.
- The updated `pnpm validate` passes all 48 lanes,
  `VALIDATE_EXIT 0`.
  Restored `pnpm-workspace.yaml` afterward.
- The required lifetime lint still has no S19, S27, S28, or S29 row.
  Jev on the remote-base diff has zero source flags.
  Stack has zero of 57 test titles flagged and no promise gap.
  The old live-signal title is unsure, not missing.
  New label lines: none; Core feedback: none.
- Latest logs: `/tmp/stack-t18-latest-gate.log`,
  `/tmp/stack-t18-latest-all-tests.log`,
  `/tmp/stack-t18-latest-jev.log`, and
  `/tmp/stack-t18-latest-validate.log`.
  Copies are in `/home/paseo/.cache/tinkered-briefs`.
- Status: Review; next is lead review and landing.
  Nothing was pushed.

## t10 writer work

- Owner: stack/t10 writer (Codex), branch `stack/t10`.
- Status: Review; both fresh full mutation runs pass.
- Base: local `stack/t06` at `c68802fd`.
- Next: lead review, then join the listed Hono changes with t17.
- Verify: HTTP auth tests, Hono and stack tests, gate,
  validation, and one auth mutation lane at least 85.
- Assumption: the example app lives in
  `packages/auth/tests/fixture`.
- Settings: `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
- Impact: `HonoScope.Wiring.tags` will accept a promise.
  Hono awaits it before opening the request session.
  Existing sync callers keep their call shape.
  No symbol is removed.
- Callers: Hono tests, the tracker request tags,
  and stack live-update tests use this wiring.
  New auth wiring supplies the async cookie read.
- Review refs: `HonoScope/Wiring.*tags` and `hono\(\)`.
  Run Hono, auth, stack, and tracker tests.

### t10 first green step

- Added `@tinker/auth` with Better Auth and its adapter at 1.7.6.
- Drizzle 1.0 needs the adapter's `relations-v2` entry.
  The default entry's generated `relations()` call fails on this RC.
- Auth settings are checked at start; the client loads on first use.
- The fixture app owns its schema and migrations.
  Fresh auth generation and Drizzle drift checks both pass.
- Build, check, 15 auth tests, and 70 Hono tests pass; exit 0.
- Check: 0 errors and 29 warnings.
  Main at `6330012c` also passes with 29 warnings.
- Hono awaits only promise tags, keeping sync calls on the same turn.
  The first unconditional await broke six abort and close tests.
  The final code passes all six and the two new tests.
- Prose and the strict census of authored auth code pass.
  The generated schema retains the CLI's own pure-call comments.

### t10 gate and review checks

- Fresh fetch: origin/main has no `stack/t06` or `stack/t17` tag.
- Rebased onto local `stack/t06` at `c68802fd`.
  This adds the migrate writer's latest tests and error handling.
- Gate: build, check, auth, stack, and all repo tests; `EXIT 0`.
  Auth: 15; Hono: 70; stack: 63; tracker: 79.
  All 18 repo test tasks pass.
- Check: 0 errors, 29 warnings, matching checked main.
- The full tracker run caught a pre-aborted request answering 500.
  It now answers 499 without running an operation.
  The tracker test and the new async-tag abort test both pass.
- Regression proof: ran both new Hono tests on the old Hono source.
  Both failed, exit 1; restored the new source before the gate.
- SCIP confirms the Hono tag hook is used by auth's wiring.
  No symbol was removed; all consumers pass.
- Jev tests: no auth or Hono test title flags.
  The README checks find no missing promise.
- Existing Hono helper-count and helper-size notes stay unchanged.
  Those files are outside this change; the helpers use public seams.
- Plain local-unit notes: each auth frame owns distinct config and user
  tags; its settings resource reads that frame's config.
  Moving them outside would join separate auth pieces.
- The inherited test-database resource captures its own PGlite.
  Moving it outside would share that handle between templates.
- Both model flags already have false labels in the bank:
  `leakedInternal` on the tracker's public entry;
  `effectWithoutDefer` on Hono's `stream`.
  The entry is the app's test seam.
  The stream closes its session when the body ends or is cancelled.
  Neither needs a new label or calibration change.
- Strict census of authored auth code and changed Hono files: OK.
  TSDoc: no findings.

### t10 validation proof

- `pnpm validate`: all 50 lanes pass, `EXIT 0`.
  The two new lanes check auth's tests and size.
- `pnpm-workspace.yaml` has no branch change.
  Workspaces and TypeScript configs already find packages by folder.
- The final Jev pass gives the same notes and existing labels.
- Auth mutation is queued under `/tmp/mutation.lock`.
  Its config has `timeoutMS: 60000`, concurrency 2, and floor 85.
  No source file is excluded.

### t10 async tag reads during shutdown

- A further probe found HTTP 500 when graceful close began during
  an async tag read, before the request session existed.
- Core refuses new sessions as soon as close starts, even when
  an owned operation is still running.
- Hono now drains its accepted async requests before calling the
  captured root close, as NATS already does for subscriptions.
  It rejects new requests during that drain with HTTP 503.
- Forced close does not wait for tag reads.
  A tag read that finishes later cannot run its prepared operation.
- Added graceful-close, forced-close, and rejected-tag-read tests.
- The first two approaches failed the graceful-close probe.
  The final code passes all 73 Hono tests.
- Full gate and all 18 repo test tasks pass again, `EXIT 0`.
  Auth: 15; stack: 63; tracker: 79; check: 29 warnings.
- Cancelled only this ticket's waiting `flock` before editing.
  The auth mutation tool had not started; its log was empty.
  No full auth mutation lane has run yet.
- Core feedback: Hono needs a per-root hook before close locks
  out new sessions, to drain request preparation.
  Until then, its start wraps that root's public close method.
  This is the same missing close hook already reported by NATS.

```ts
const reply = app.request("/me");
const closing = scope.close({ graceful: true });
finishCookieRead();
await reply; // was HTTP 500; should be HTTP 200
await closing;
```

### t10 final shutdown review

- Re-ran validation after the shutdown fix: all 50 lanes pass,
  `EXIT 0`.
- Re-ran SCIP refs, strict census, TSDoc, and prose; all pass.
- Jev finds no auth or Hono test title flags and no clear
  missing README promise.
- Added two false `stateOutsideCell` labels:
  `serveRequests` and `serveAfterTags` own a root's pending
  request promises and close state, not app data.
  Their sets release each promise on either outcome.
- Fresh fetch still points to `origin/main` at `be6a9526`.
  Neither `stack/t06` nor `stack/t17` has landed there.
- The full auth mutation lane is queued again under the lock.

### t10 full mutation result and test gaps

- The one full lane finished with `EXIT 1`: score 81.11.
  Killed: 73; timeout: 0; survived: 17.
  No coverage: 0; errors: 0; total: 90.
- The unchanged tests passed before mutation began.
  The config kept `timeoutMS: 60000` and floor 85.
- Full log and JSON are saved as `stack-t10-mutation.log`
  and `stack-t10-mutation.json` in
  `/home/paseo/.cache/tinkered-briefs/`.
- Two real test gaps appeared among the survivors.
  Dropping the supplied settings still passed the HTTP tests.
  A nondefault base URL did not catch this either.
  The HTTP fixture now uses `http://auth.example.test`.
- The second-owner test now rejects `BadAuthSettings` before
  accepting `PieceInUse`, proving those errors stay distinct.
- The first narrow check killed all five error-kind changes,
  including the three old survivors.
  Dropping the settings still survived; the check exited 1.
- Added a public check that changing the secret on restart
  rejects a cookie from the prior root.
- No runtime source changed after the full lane.
  The next check repeats those two source lines.
- The brief allows one full lane.
  A fresh full score of at least 85 remains a landing check;
  the failed full result is not a pass.

### t10 survivor proof and handoff

- Final narrow check: `EXIT 0`, score 100.
  Killed: 6; timeout: 0; survived: 0.
- These four survivors from the full report are now `[Killed]`:
  14, 16, and 17 at `src/errors.ts:22`;
  96 at `src/index.ts:88`.
- Compared all three runtime files with the full report's source.
  They are unchanged.
  Only the tests and their docs changed after that run.
- The first run's 73 kills plus four new kills are 77 of 90,
  or 85.56 percent across the two reports.
  This is combined proof, not a fresh full-lane score.
- Saved the narrow log and JSON as
  `stack-t10-survivor-check-final.log` and
  `stack-t10-survivor-check-final.json` in the same cache folder.
- Final gate: build, check, auth, stack, and all repo tests;
  `EXIT 0`.
  Auth: 16; Hono: 73; stack: 63; tracker: 79.
  All 18 test tasks pass; check still has 29 warnings.
- Re-ran `pnpm validate` after the secret-change test.
  All 50 lanes pass, `EXIT 0`.
- Jev tests and README promises: no flags on the auth changes.
  Strict style census and prose pass.
- Latest fetch: `origin/main` is still `be6a9526`.
  No `stack/t06` or `stack/t17` tag has landed there.
- No push; no own mutation or test job left running.

The narrow check was:

```sh
cd packages/auth
flock /tmp/mutation.lock \
  vp exec stryker run \
  --mutate 'src/errors.ts:22-22,src/index.ts:88-88' \
  --reporters clear-text,json
```

The lead's remaining full gate is:

```sh
flock /tmp/mutation.lock \
  vp run --no-cache auth#mutate
```

### t10 lead follow-up

- Keep the current base; do not rebase onto the pending t17.
- Run fresh full auth mutation, then Hono mutation, alone.
  Count kills as `killed / (killed + timeout + survived)`.
  The required floor is 85 percent.
- List each Hono change and why auth needs it before review.
- Re-run the full gate and validation; commit by path.

### t10 Hono changes to keep with t17

All paths below are under `packages/hono`.
All changes serve auth's async cookie read; none were removed.

- `src/index.ts:70`: the tag hook accepts a promise.
  Auth must read its session cookie before a request can open
  `store.tx`, since PGlite has one connection.
- `src/index.ts:212`: each started server owns its pending
  reads, forced-close flag, and one close promise.
  Auth can have requests waiting on the cookie database read
  before core has a request session to own.
- `src/index.ts:224`: wrap this root's close.
  Graceful close drains accepted reads and their requests
  before core blocks new sessions.
  Forced close starts at once; repeat close returns its promise.
  Without this order, an accepted auth request can answer 500
  during graceful shutdown because it cannot open its session.
- `src/index.ts:233`: reject new requests with 503 while draining.
  New cookie reads must not enter after shutdown chose the
  accepted set it will drain.
- `src/index.ts:234`: read request hooks, then pass their bound
  tags and namespace to the request session.
  Only promise tags wait; sync tags keep their old call order.
  Auth needs the wait; other callers need their sync behavior.
- `src/index.ts:247`: retain each async read through its response,
  and release it on success or failure.
  This covers the gap before the request session exists and
  hands any kept stream back to core's session close path.
  A failed auth read fails its request, not the root's close.
- `src/index.ts:253`: answer 499 after a forced close.
  A cookie read that finishes later must not start an operation.
- `src/index.ts:264`: move the old session body to `serveSession`.
  Both sync and async tags use it without adding an await to
  sync callers; typed context also removes the old cast.
  Its session, error hook, abort listener, and stream cleanup
  are the prior code moved into this helper.
- `src/index.ts:272`: answer 499 for an already-aborted request.
  A client can abort while auth reads its cookie, before the
  session's abort listener exists.
  The operation must not run once that cookie read ends.
- `tests/hono.test.ts:585`: proves the cookie read order before
  a session resource opens, standing in for the transaction.
- `tests/hono.test.ts:619`: proves abort during that read prevents
  the operation and answers 499.
- `tests/hono.test.ts:652`: proves graceful shutdown finishes the
  accepted read and request instead of answering 500.
- `tests/hono.test.ts:673`: proves a rejected auth read fails
  only that request and leaves graceful close successful.
- `tests/hono.test.ts:684`: proves forced shutdown does not run
  an operation after its cookie read ends.
- `README.md:296`: states those async-read promises and the
  promise-returning hook so auth callers can rely on them.

For the later rebase, t17 owns commit-before-answer and rollback
after a raised error.
Keep its request body and stream close rules when joining the
session code at `src/index.ts:273`.
The t10 changes above prepare tags before that body starts;
they do not require keeping the old commit or rollback behavior.

### t10 fresh auth mutation proof

- Fresh full auth run: `EXIT 0`.
  Killed: 77; timeout: 0; survived: 13.
  No coverage: 0; errors: 0.
- The killed-only score is `77 / 90 = 85.56%`.
  This is a new full run, not the earlier combined proof.
  No further auth lift was needed.
- The auth sandbox folder was already absent before the run.
  Stryker made a fresh sandbox and tested all 90 changes.
- Logs: `stack-t10-auth-full-2.log` and
  `stack-t10-auth-full-2.json` in
  `/home/paseo/.cache/tinkered-briefs/`.
- Next: full Hono mutation, with a 60 second tool timeout
  and two workers, alone under the same lock.

### t10 fresh Hono mutation proof

- One fresh full Hono run, after auth: `EXIT 0`.
  Killed: 275; timeout: 0; survived: 45.
  No coverage: 3; errors: 0.
- The lead's score is `275 / 320 = 85.94%`.
  Stryker's total, which counts the three uncovered changes,
  is 85.14 percent and passes its unchanged floor of 85.
- Command: `vp run --no-cache hono#mutate`, under the lock,
  with `--timeoutMS 60000 --concurrency 2`.
  No Hono config or runtime file changed in this follow-up.
- Logs: `stack-t10-hono-full-1.log` and
  `stack-t10-hono-full-1.json` in the same cache folder.
- Next: the requested full gate, then `pnpm validate`.

### t10 follow-up final gate

- The requested chain passes by exit code, `EXIT 0`:
  build, check, auth, Hono, stack, then every repo test task.
- Check: 0 errors and 29 warnings, matching the checked base.
  Auth: 16; Hono: 73; stack: 63; tracker: 79.
  All 18 repo test tasks pass.
- Then `pnpm validate` passes all 50 lanes, `EXIT 0`.
  Restored `pnpm-workspace.yaml`; it has no branch change.
- Strict census, TSDoc, prose, and SCIP refs pass.
  No public symbol was removed.
- Main advanced while the mutation runs waited.
  Stopped only this worktree's advisory `main..HEAD` reader:
  it was reading newer core and HTTP changes outside this ticket.
  Re-ran Jev on the held base, `c68802fd..HEAD`.
  It has no file flags and the same explained unit notes.
- The two `stateOutsideCell` labels and the stream's
  `effectWithoutDefer` label remain false; no new labels.
  Request bookkeeping belongs to the started server root.
  The stream already owns its close path.
  Each auth frame needs its own config and user tags.
- No runtime source, test, or package config changed in this
  follow-up; only the board and these proof notes changed.
- No rebase or push.
  Base is still local t06 at
  `c68802fd96fc26fa606dd2419662979164e52b26`.
- All own long jobs finished in this turn.
  Status: Review; next is the lead's review and later t17 rebase.
- Final logs: `stack-t10-followup-gate.log`,
  `stack-t10-followup-validate.log`, and
  `stack-t10-followup-jev-base.log` in the same cache folder.

## t10 resume — 2026-09-30

- Owner: stack/t10 writer.
- Base checked: `c68802fd` is an ancestor of the paused head.
- Rebased with `--onto origin/main c68802fd`.
- Main is `870beab4`; t06 and t17 are both in it.
- No paused edits or board-landing commits were present.
- Assumption: use the saved fixture app and its migrations.
- Keep main's session body, abort cleanup, stream cleanup,
  commit before answer, and rollback on every raised error.
- Drop t10's own client-abort guard: main already answers 499.
- Keep async tags, the pre-close drain, and forced-close 499.
- Return 503 during the drain.
  Once close ends, keep main's Hono error path for late requests.

### Impact before the final fix

- Public change: `HonoScope.Wiring.tags` accepts a promise.
- Callers: auth wiring, Hono tests, and the tracker route wiring.
- All other Hono consumers use the shared session body.
- Check SCIP refs for `HonoScope/Wiring#tags`.
- Run every package's tests and the tracker browser proof.
- Verify: the named gate, both mutation lanes, and validation.

### First rebased gate

- Build, check, auth, Hono, and stack: `EXIT 0`.
- Auth: 16 tests; Hono: 91; stack: 111.
- Check: 0 errors, 28 warnings.
- Fresh main check at `870beab4`: 0 errors, 28 warnings.
  Main's build and check also ended with `EXIT 0`.
- Strict style census and TSDoc pass.
- SCIP finds the promise-tag hook in auth's source and tests.
- Jev: no file flags or missing README promises.
- Three local auth units stay inside each piece.
  Moving its tags out would join separate auth pieces.
- Existing Hono helper-size and helper-count notes stay as-is.
  Those helpers predate this ticket and use public APIs.
- Label the new request-close state as driver cleanup.
  Each promise is joined and each pending entry is released.
- Main's stream already has the same false effect label.
- Used `origin/main..HEAD` for Jev.
  Local main has unrelated example work ahead of origin.
- Fresh fetch still points to `870beab4`.

### Final rebased gate and browser proof

- Named gate: build, check, auth, Hono, stack; `EXIT 0`.
- Auth: 16 tests; Hono: 91; stack: 111.
- Every repo test task ran uncached: 19 tasks passed.
  Core: 790 tests; tracker: 79.
- Main and branch both have 28 warnings and no errors.
- Close-phase regression: build passed, then the test failed
  without the fix, `EXIT 1`: got 503 where main promises 500.
  Restored the fix and rebuilt before the final gate.
- Tracker browser proof ran once, uncached, `EXIT 0`.
  The browser run and all 7 helper tests pass.
- Used the full `@tinker-issue-tracker` task name.
  The short `issue-tracker` name matched no task.
- The source from the trace reader through the end of Hono
  is byte-for-byte the same as main.
- Logs: `stack-t10-resume-gate-final.log`,
  `stack-t10-resume-browser.log`,
  `stack-t10-resume-regression.log`, and
  `stack-t10-resume-main-check.log` in the briefs cache.
- Next: auth and Hono mutation lanes, alone under the lock,
  then validation and the lead's review.

### Rebase conflicts

- `packages/hono/src/index.ts`: t10 prepares cookie tags;
  main owns the request body and close result.
  Keep preparation outside main's moved session body.
  Drop the old t10 session body and client-abort guard.
- `packages/hono/README.md`: main promises commit and cleanup;
  t10 promises async tags.
  Keep both, with a new async-tags section.
- `docs/roadmap/stack-v1/PROGRESS.md`: keep main's later proof
  and append t10's saved proof and these resume notes.
- `TODO.md`: keep main's board and update only the t10 card.
  Remove its old parked row while this writer resumes it.
- `tools/jev/cases.jsonl`: keep both banks' rows.
  Label the changed request preparation and moved session body.
- Later t10 Hono patches met code already kept in the first
  replayed commit; keep that code and replay their tests.
- No board-landing commit needed dropping or reverting.

### Hono changes kept for auth after the rebase

All paths in this list are under `packages/hono`.

- `src/index.ts:71`: tags can return a promise.
  Auth's cookie read must finish before `store.tx` opens.
- `src/index.ts:214`: one started root owns pending reads,
  its close phase, forced-close mode, and one close promise.
  Core cannot own a cookie read before its session exists.
- `src/index.ts:228`: graceful close waits for accepted reads
  and their requests before core refuses new sessions.
  Forced close starts at once; repeat close joins the same work.
- `src/index.ts:236`: mark the root closed when close ends.
  Keep main's error handler for late requests after that point.
- `src/index.ts:241`: new requests answer 503 while closing.
  They cannot add a cookie read after the drain starts.
- `src/index.ts:244`: read tags before opening the session.
  Sync hooks keep main's tags, trace, namespace read order.
  Async hooks wait, then bind the user beside the raw request.
- `src/index.ts:259`: hold each async read through its reply
  and release it on success or failure.
  A stream has its owned session before this promise leaves.
  A rejected cookie read fails its request, not root close.
- `src/index.ts:265`: answer 499 when a cookie read finishes
  after forced close; never run the prepared operation.
- `src/index.ts:276`: move main's session body into one helper.
  Both sync and async tags use its commit and rollback rules.
  Main's abort cleanup and stream rules stay intact.
- `tests/hono.test.ts:585`: prove tags precede session resources.
- `tests/hono.test.ts:619`: prove abort during tags answers 499
  and runs no operation, using main's abort branch.
- `tests/hono.test.ts:652`: prove accepted requests finish during
  graceful close, while new requests answer 503.
- `tests/hono.test.ts:676`: prove a failed cookie read does not
  make root close fail.
- `tests/hono.test.ts:687`: prove forced close answers 499
  after tags and runs no operation.
- `README.md:347`: promise the async-read order and close rules.

Main already covers a client abort once the session exists.
The t10-only guard before session creation was dropped.
Main does not drain cookie reads before sessions exist.
That drain and the forced-close 499 still belong to t10.

### Core feedback kept from the saved branch

Core blocks new sessions before a close hook can drain preparation.
Hono still wraps this root's close to finish accepted cookie reads.
A hook before that block would remove the workaround.
Without it, the accepted request below answers 500 on close.

```ts
const reply = app.request("/me");
const closing = scope.close({ graceful: true });
finishCookieRead();
await reply;
await closing;
```

### Rebased auth mutation — 2026-10-01

- One fresh full auth lane, under `/tmp/mutation.lock`.
- Killed: 77; timeout: 0; survived: 13.
- No coverage: 0; errors: 0; total: 90.
- Killed-only score: `77 / 90 = 85.56%`; `EXIT 0`.
- Config: timeout 60000, two workers, floor 85.
  All three source files were tested; none were excluded.
- The lock wait finished before this lane began.
- Saved log and JSON: `stack-t10-resume-auth-mutation`
  in the briefs cache, with `.log` and `.json` endings.
- Next: the full rebased Hono lane under the same lock.

### Rebased Hono mutation — 2026-10-01

- One fresh full Hono lane, after auth, under the same lock.
- Killed: 405; timeout: 0; survived: 62.
- No coverage: 2; errors: 0; total: 469.
- Killed-only score: `405 / 467 = 86.72%`; `EXIT 0`.
- Stryker's score with uncovered changes is 86.35 percent.
  Both scores pass the unchanged floor of 85.
- Command: `vp run --no-cache hono#mutate`, with
  `--timeoutMS 60000 --concurrency 2` under the lock.
- All source files were tested; none were excluded.
- Saved log and JSON: `stack-t10-resume-hono-mutation`
  in the briefs cache, with `.log` and `.json` endings.
- Next: finish validation, then hand the branch to the lead.

### Refreshed main after the lock waits — 2026-10-01

- Main moved during the two mutation lock waits.
  Fetched and rebased again onto `23f0ccce`.
  This keeps the landed t18 root exit code work
  and the separate example projects.
- Only the progress notes conflicted on this refresh.
  Keep all t18 proof, then append the t10 proof.
  Fixed one missing blank line found by the format check.
- Installed again and ran the full gate from the new base.
  Build, check, auth, Hono, stack: `EXIT 0`.
  Auth: 16 tests; Hono: 91; stack: 114.
- Every repo test task ran uncached: 29 tasks passed.
  Core: 790 tests; tracker: 79.
  One existing repo test is skipped; no authored test is skipped.
- Tracker browser proof ran once on this refreshed base,
  uncached, followed by all 7 helper tests: `EXIT 0`.
- Check: no errors and 28 warnings.
  A fresh main worktree at `23f0ccce` has the same result.
  Removed that check worktree after seeing `EXIT 0`.
- Kept the completed full mutation results.
  Assumption: proof stays valid when its inputs stay the same.
  Compared every reported mutation source with the current file.
  Auth, Hono, Core, and Drizzle trees are unchanged,
  including their tests, package configs, and peer code.
  The lockfile changed only the example project entries.
  All package versions and snapshots are unchanged.
  Auth tests use Stack's server and test database exports.
  Those files and their called helpers are unchanged.
  Stack's entry replaces an unused stop export with
  an unused exit code export; both only declare functions.
  The new root run config only changes task caching.
- Auth mutation: killed 77, timeout 0, survived 13.
  No coverage 0, errors 0; killed-only 85.56 percent.
- Hono mutation: killed 405, timeout 0, survived 62.
  No coverage 2, errors 0; killed-only 86.72 percent.
  Stryker's score with uncovered changes is 86.35 percent.
  Both full lanes ran alone under the lock and ended `EXIT 0`.
- Fresh strict census, TSDoc, prose, and SCIP refs pass.
  The Hono source from the trace reader to the end
  still matches main exactly.
- Fresh Jev: no file flags or missing README promises.
  Auth: zero of 11 titles flagged; Hono: zero of 91.
  Seven Hono promise matches are unsure, not missing.
  Plain local-unit notes keep each auth piece's identity.
  The three Hono state labels remain false:
  `serveRequests`, `serveAfterTags`, and `serveSession`
  own request preparation, the reply, and cleanup.
  Main's unchanged stream keeps its false effect label.
  The noisy answer-route note needs no label.
- Logs in the briefs cache start with
  `stack-t10-resume-refreshed-`:
  gate, main-check, Jev, style, refs, and validation.
- Refreshed validation: all 50 lanes pass, `EXIT 0`.
  Rebuilt before running it and restored the workspace file.
  The earlier validation also passed all 50 lanes.
- Status: Review; next is lead review.
  No push; all owned jobs ended in this turn.
  No runtime source changed after the full mutation runs.
- Core feedback is unchanged: the failing close snippet above
  shows why Hono still wraps close before session admission ends.

## t10 reviewer fix round 1 — 2026-10-01

- Owner: stack/t10 writer; reviewed head `dca8561b`.
- Next: carry refreshed cookies to app answers,
  skip the user read on auth routes, and state close rules.
- Verify: both cookie tests fail on the reviewed head,
  then the full repo gate, prose, both mutation lanes,
  and validation pass.
- The no-tags 503 is already present on the reviewed head.
  Its new test should pass there; this finding needs docs.
- Keep main's failed-commit header drop unchanged.

### Fix round 1 failing-first proof

- Runtime source still matched `dca8561b` exactly.
  Added the tests first, then rebuilt.
- The two near-expiry cookie tests failed, `EXIT 1`.
  App route: only `app=active; Path=/` was returned.
  Auth get-session route: no cookies were returned.
  Both lacked `better-auth.session_token`.
- The no-tags shutdown test passed on the old code, `EXIT 0`.
  It names the already shipped 503; docs now state that rule.
- Logs: `stack-t10-fix1-failing-first.log` and
  `stack-t10-fix1-no-tags-baseline.log` in the briefs cache.

### Fix round 1 first green step

- Auth reads with `returnHeaders: true` before the session.
  Append each returned cookie to the app answer.
  The app's own cookie remains beside the refreshed token.
- Skip the tag user read on `/api/auth/*`.
  Better Auth now reads and refreshes once on its own route.
- Hono's runtime source is unchanged.
  Its docs now say 503 applies during any root close,
  and late requests reach Hono's error handler after close.
- Stack's server doc names the tag drain before listener stop.
  No Stack runtime behavior changed.
- Extended the existing failed-commit header-drop test
  with an async tag cookie and an appended route cookie.
  Its fresh 500 still drops all built headers.
- Build, check, auth 18, Hono 92, prose: `EXIT 0`.
  Check still has no errors and 28 warnings.
- Next: full repo gate, advisory checks, fresh mutation,
  then validation and review.

### Fix round 1 full gate and advisory checks

- Fetched main before the full gate; it remains `23f0ccce`.
  Rebase reports this branch is up to date.
- Gate: build, check, every repo test task, then prose.
  All 29 test tasks ran uncached; `EXIT 0`.
- Auth: 18 tests; Hono: 92; Stack: 114; tracker: 79.
  Core: 790; the one existing repo skip remains.
- Check: no errors, 28 warnings; same as the seen main proof.
- Strict style census and TSDoc pass.
  Jev has no file flags or missing promises.
  Auth: zero of 13 titles flagged; Hono: zero of 92.
  Ten Hono promise matches are unsure, not missing.
- Existing Hono state and stream labels remain false.
  The root owns preparation and the request owns cleanup.
  Stack's unchanged listen helper keeps both false labels.
  Its returned stop is owned by the server's defer.
  Its close flag only selects socket cleanup.
- Each auth piece keeps its own config and user tags.
  Existing Hono helper-size and helper-count notes are unchanged.
  The noisy answer-route note needs no label.
- No new labels or judge rules.
  Hono's runtime source still matches the reviewed head.
- Logs: `stack-t10-fix1-gate.log`, `stack-t10-fix1-jev.log`,
  and `stack-t10-fix1-style.log` in the briefs cache.
- Next: fresh full auth and Hono mutation lanes,
  one at a time under `/tmp/mutation.lock`, then validation.

### Fix round 1 mutation found a cookie test gap

- First auth lane: killed 83, timeout 0, survived 15.
  No coverage 0, errors 0; score 84.69 percent, `EXIT 1`.
  The floor stays 85; no exclusions were added.
- Both append changes survived: an empty option object
  and `append: false` each overwrite earlier cookies.
- The existing refresh test only set an app cookie
  after the user read; it missed cookies already present.
  Its fixture now also sets an earlier cookie.
  The same test checks that both app cookies stay
  beside the refreshed session token.
- No runtime code changed; this checks the promised append.
- Kept the failed log and JSON as
  `stack-t10-fix1-auth-mutation-attempt1` in the briefs cache.
- Hono did not start after the failed auth lane.
  Next: auth checks and fresh mutation, then Hono and validation.
- Round 2 edits wait until round 1's checks finish.

### Fix round 1 auth mutation passes

- Saved the stronger cookie test at `359ceeac`.
  Build, check, auth 18, and prose pass, `EXIT 0`.
- Fresh full auth lane under `/tmp/mutation.lock`:
  killed 85, timeout 0, survived 13.
  No coverage 0, errors 0; 86.73 percent, `EXIT 0`.
- Both append changes are killed by the same refresh test.
  Earlier app cookies now have proof beside later cookies.
- Log and JSON: `stack-t10-fix1-auth-mutation`
  in the briefs cache.
- Next: Hono under the same lock, then validation.

### Fix round 1 Hono mutation passes

- Fresh full Hono lane under the same mutation lock:
  killed 405, timeout 0, survived 62.
  No coverage 2, errors 0; score 86.35 percent, `EXIT 0`.
  Killed divided by killed, timeout, and survived is 86.72 percent.
- Timeout stayed 60000; concurrency stayed 2.
  Both full lanes passed without new exclusions.
- Log and JSON: `stack-t10-fix1-hono-mutation`
  in the briefs cache.
- Round 1 validation follows before round 2 edits.

### Fix round 1 complete

- Build and `pnpm validate`: all 50 lanes pass, `EXIT 0`.
  Restored `pnpm-workspace.yaml` after validation.
- Log: `stack-t10-fix1-validate.log` in the briefs cache.
- Both mutation lanes and validation finished before round 2 edits.
- Next: restore the plain failed-commit test, add an async twin,
  and document and test raw answers copying auth headers.
  Then read the second resume brief and rebase for event hooks
  and the static store resource; repeat the requested proof.

### Fix round 2 before the authoring rebase

- Restored the plain failed-commit header test from the old main.
  Its original no-tags case stays separate from the new async case.
  Rebase will keep main's new static-store fixture names.
- Added a separate async-tag cookie test and README promise.
  Hono runtime source is unchanged in this fix step.
- The raw-answer test failed first, `EXIT 1`:
  only `app=1; Path=/` reached the browser.
- Auth's README now names `c.json`, `c.text`, and `c.body`,
  and shows a raw answer copying `c.res.headers`.
  Add its own cookies to the context before that copy.
  The fixture follows that form and keeps both cookies.
- Chose the requested doc and example fix:
  automatic copying would change Hono's header merge rules.
- Build, check, auth 19, Hono 93, prose: `EXIT 0`.
  Check has no errors and the same 28 warnings.
- Logs: `stack-t10-fix2-raw-failing-first.log` and
  `stack-t10-fix2-before-rebase.log` in the briefs cache.
- Next: read `stack-resume-2.md`, rebase for event hooks
  and the static store, then repeat all requested proof.

### Second authoring rebase and first green gate

- Read `stack-resume-2.md`, ADRs 0093 and 0094,
  the event fields, Drizzle's README, and the tracker store.
- Fetched and rebased onto `d96fee94` on origin/main.
- Conflicts and results:
  `tools/jev/cases.jsonl` keeps both label sets,
  with duplicate identical lines removed.
  `TODO.md` keeps other cards and one current t10 card.
  `packages/hono/tests/transactions.test.ts` keeps the async
  cookie case with main's static database fixture.
- Restored the plain header-drop test exactly from new main.
  A byte comparison confirms that whole test matches.
- Auth start and the no-tags close gate use event hooks.
  Hono's merged start already passes `event.scope`
  to request preparation; Stack keeps main's own hooks.
- Auth's fixture declares one namespace database resource
  and one session transaction resource at module scope.
  It borrows each clone; tests close it after the scope.
  The logger and transaction adapters keep native values.
- All t10 acceptance and cookie-refresh fixes remain.
  No positional hooks or store frames remain in auth.
- Hono's owned request body and stream helpers match main.
  The user read still runs before opening that body.
- Gate: build, check, uncached auth, Hono, Stack, tracker, prose.
  Auth 19, Hono 93, Stack 114, tracker 79: `EXIT 0`.
  Check: no errors and 28 warnings.
- Log: `stack-t10-resume2-gate.log` in the briefs cache.
- Next: full repo tests, style and advisory checks, fresh
  auth and Hono mutation, one uncached browser proof, validate.

### Second resume full gate and advisory checks

- All 29 repo test tasks ran uncached, `EXIT 0`.
  The one existing skipped test remains.
- Strict style census passes.
  Jev has no file flags or missing README promises.
  Auth: zero of 14 titles flagged; Hono: zero of 93.
  Eight Hono promise matches are unsure, not missing.
- Auth's local config and user tags keep each piece's identity.
  Its settings resource belongs to that same piece.
  Those three plain code notes need no judge label.
- Labeled Hono request bookkeeping false at `66a115ca2cde`:
  its call site now uses `event.scope`; the started root
  owns the accepted cookie reads and the close drain.
- The existing false labels for request preparation,
  the request body, and the stream remain in the bank.
  The inherited helper size and count notes remain unchanged.
  The noisy answer-route note needs no label.
- Logs: `stack-t10-resume2-all-tests.log`,
  `stack-t10-resume2-style.log`, and `stack-t10-resume2-jev.log`
  in the briefs cache.

### Hono changes kept after the second resume

- `packages/hono/src/index.ts:71`: tags may return a promise.
  Better Auth must finish its cookie read before a transaction opens.
- `packages/hono/src/index.ts:224`: prepare tags outside the session.
  Keep tag, trace, and namespace read order; sync tags do not await.
- `packages/hono/src/index.ts:231`: drain accepted reads before close.
  Core otherwise blocks their late request sessions.
  After close, keep main's error handler behavior.
- `packages/hono/src/index.ts:244`: answer 503 during any root close.
  New requests must stop entering auth reads while shutdown drains.
- `packages/hono/src/index.ts:262`: retain preparation through its answer.
  A stream must enter its owned session before root draining begins.
- `packages/hono/src/index.ts:268`: forced close answers 499.
  Never run an operation prepared after the root was forced closed.
- `packages/hono/src/index.ts:279`: move main's body into a helper.
  This only separates pre-session auth work; rollback, commit before
  answer, failed-close header drop, abort cleanup, and ownership stay.
  Stream code and its following helpers match main exactly.
- Main already handles abort after the cookie read at line 303.
  Keep that path; no second auth abort guard is needed.
- `packages/hono/tests/hono.test.ts:586`, `:621`, `:654`, `:677`,
  `:703`, and `:714`: prove preparation, abort, graceful drain,
  no-tags 503, read failure, and forced close.
  Auth needs those outcomes before opening its transaction.
- `packages/hono/tests/transactions.test.ts:115`: a separate async
  cookie case proves a failed commit drops every built header.
  The plain test above it matches main exactly.
- `packages/hono/README.md:312` and `:348`: promise that separate
  cookie failure case and explain preparation and shutdown answers.
- Hono's and Stack's event starts are main's unchanged code.
  The only added Stack line names the accepted-read drain.

### Second resume auth mutation passes

- Fresh full auth lane after the event and static-store rebase:
  killed 86, timeout 0, survived 14.
  No coverage 0, errors 0; 86.00 percent, `EXIT 0`.
- The full lane ran alone under `/tmp/mutation.lock`,
  with timeout 60000, concurrency 2, and the unchanged floor 85.
- Log and JSON: `stack-t10-resume2-auth-mutation`
  in the briefs cache.
- Next: Hono under the same lock, then the uncached browser
  proof and validation.

### Second resume Hono mutation passes

- Fresh full Hono lane after rebasing onto event hooks:
  killed 406, timeout 0, survived 62.
  No coverage 2, errors 0; Stryker score 86.38 percent, `EXIT 0`.
  Killed divided by killed, timeout, and survived is 86.75 percent.
- Both fresh lanes ran alone, one after the other
  under the same `/tmp/mutation.lock`.
  Timeout 60000, concurrency 2, floor 85; no new exclusions.
- Log and JSON: `stack-t10-resume2-hono-mutation`
  in the briefs cache.
- Next: tracker browser proof once uncached, then validation.

### Second resume browser proof passes

- Ran tracker `test:browser` exactly once, uncached.
  Browser proof and 7 helper tests pass, `EXIT 0`.
  Both task cache hits are zero.
- Log: `stack-t10-resume2-browser.log` in the briefs cache.
- Next: final `pnpm validate`, then review.

### Second resume and fix round 2 complete

- Final build and `pnpm validate`: all 50 lanes pass, `EXIT 0`.
  Restored `pnpm-workspace.yaml`; it is not part of a commit.
- Named gate: auth 19, Hono 93, Stack 114, tracker 79.
  All 29 repo test tasks also pass uncached.
  Check has no errors and 28 warnings; prose and style pass.
- Fresh mutations: auth 86 / 0 / 14, score 86.00 percent;
  Hono 406 / 0 / 62, Stryker score 86.38 percent.
  Hono has 2 no-coverage cases and no errors.
  Its killed-only score is 86.75 percent.
  Both full lanes passed alone under the lock, `EXIT 0`.
- Tracker browser proof ran once uncached; 7 helpers pass.
- The two round 1 cookie tests failed on `dca8561b` first.
  The new raw-answer test also failed before header copying.
  Every one now passes with event hooks and static resources.
- The plain failed-commit test matches `d96fee94` exactly.
  Its separate async-cookie test keeps its own README promise.
- Raw answers use the documented context-header copy.
  No automatic Hono header merge was added.
- The Hono change map and conflict results are above.
  Core feedback stays the same accepted-read close snippet
  recorded above; no new feedback from the event rebase.
- All owned foreground jobs have finished.
  Commit by path; do not push. The lead reviews and lands.
- Final log: `stack-t10-resume2-validate.log` in the briefs cache.

## t08 writer work

- Owner: stack/t08 writer, branch `stack/t08`.
- Status: Doing.
- Base: local `stack/t06` at `50b31bab`, as requested.
- Next: add jobs after the migrate extension.
- Verify: jobs, stack, tracker tests; build and check;
  all validation lanes; jobs mutation at least 85.
- Assumption: list the jobs extension just after migrate.
  Drizzle commits before the jobs start takes its own lock.

### t08 first green step

- Added `@tinker/jobs`, pinned to pg-boss 12.35.0.
- Sixteen public tests pass on real PGlite.
- Build and check pass: no errors, 29 warnings.
  A clean main at `6330012c` has the same 29 warnings.
- Prose and strict style census pass; TSDoc has no findings.
- `createJobsClock` binds a clock through the scope's tags.
  It moves both pg-boss timers and SQL time.
  Cron tests advance to a fixed minute and poll the app queue.
- Assumption: `JOBS_URL` names the Postgres worker pool.
  On PGlite, the caller lends the store's own `db` resource.
  In both modes, send borrows `store.tx` for each call.
- Core close has no scope argument, as in the NATS ticket.
  The jobs piece stops fetches through the captured close handle.
  It waits for worker cleanup after core closes child sessions.
- Registered jobs in the size/test validation lanes and driver check.
  The workspace already includes all packages by path pattern.
  Each package has its own tsconfig; there is no root reference list.
- Next: full gate, Jev, validation, and the single mutation lane.

### t08 gate and Jev

- Gate chain: build, check, jobs 16, stack 63, tracker 79.
  `EXIT 0`; check has no errors and 29 warnings.
- Jev tests: 0 of 16 flagged; every title has a README line.
- Label `leakedInternal false` on `src/time.ts`:
  the tag is shared inside the package, not in its exports.
- Label `stateOutsideCell false` on the test fixture:
  the client array owns cleanup, not app state.
- The inherited tracker entry flag already has t06's false label.
- The inherited test-helper resource closes over its PGlite client.
  Moving it to module scope would lose that owner.
- All remaining preflight hits were hints or noisy notes.

### t08 close ownership fix

- A new test held another extension's final cleanup open.
  The old code let a second scope start during that wait.
  Red proof: one failed test, exit 1.
- Keep the owner until the captured root close has returned.
  Failed boot still releases it through the start defer.
- Build and check pass; all 17 jobs tests pass.
  Check still has no errors and 29 warnings.
- Jev tests and README promises: no flags in 17 tests.
- Full repo tests before this fix: all 18 package tasks pass.
  No package outside jobs changed in this fix.

### t08 checks before mutation

- Fresh fetch: no `stack/t06` tag is on origin.
  The base remains `50b31bab` from local `stack/t06`.
- Final gate: build, check, jobs 17, stack 63, tracker 79.
  `EXIT 0`; no errors and the same 29 warnings.
- `pnpm validate`: all 50 lanes pass, exit 0.
  `pnpm-workspace.yaml` has no branch change.
- Final Jev hits are covered by the same labels and notes.
  Strict style census: OK.
- Mutation is next, once, under `/tmp/mutation.lock`.
  The config has used `timeoutMS: 60000` from the start.

### t08 Core feedback

The close hook gets options and next, but no scope.
Jobs must capture the public handle in start and wrap close,
as NATS does, so closing a rejected scope cannot stop its owner.
The following probe fails with TS2322, exit 1:

```ts
extension({
  close: async (_scope: Scope.Handle, next) => next(),
});
```

The type checker says `CloseOptions` cannot be `Scope.Handle`.
The probe was removed after the check.
This is another caller for `core/close-hook-scope`.
Core itself has no change on this branch.

### t08 mutation findings

- First full run: 65.75%, exit 1.
  Counts: 92 killed, 4 timeout, 45 survived, 5 no coverage.
- The report marked deletion of `jobs()` as survived.
  Starting jobs in `beforeAll` made broken setup skip tests.
  Only the Drizzle template now starts in that hook.
  Each test starts jobs in its own body.
- Tests now check the saved cancel cause, commit error,
  original job error, old close handles, and failed boot cleanup.
- Three new tests cover other queues during close,
  worker database faults, and failed child operations.
- Build, check, and all 20 jobs tests pass, exit 0.
  Check has the same 29 warnings as main.
  Jev tests and promises have no flags; style census passes.
- Deviation: repeat the final mutation run after fixing setup.
  The first report had false survivors and cannot prove the floor.
  Keep its log and JSON; do not change the floor or source list.

### t08 corrected final checks

- Fetch still shows no `stack/t06` tag on origin.
  The base is local t06 at `50b31bab`.
- Gate chain: build, check, jobs 20, stack 63, tracker 79.
  `EXIT 0`; no errors and the same 29 warnings as main.
- `pnpm validate`: all 50 lanes pass again, exit 0.
- Jev preflight has the same labels and notes.
  Jev tests and promises: no flags in 20 tests.
- No source change since the prior close fix.
  The corrected mutation run is the last check.

### t08 final proof

- Corrected full mutation run: 86.99%, exit 0.
  Counts: 127 killed, 0 timeout, 17 survived, 2 no coverage.
  All 146 mutations stayed in the run; the floor stayed at 85.
  `timeoutMS` stayed at 60000 from the first config.
- Deleting `jobs()` is now killed by a test.
  The first report marked that deletion survived with zero tests.
  One remaining module-load failure still reports zero tests.
  It counts against the score, not as a killed mutation.
- Both full runs held `/tmp/mutation.lock` and ended in this turn.
  The first report remains saved, including its failed score.
- The final repo test command passes all 18 package tasks, exit 0.
  The required gate, all 50 validation lanes, prose, and style pass.
- A fresh fetch still has no `stack/t06` tag on origin.
  `origin/main` remains `be6a9526`.
  This branch's base is local t06 at `50b31bab`.
- Card moved to Review; no push.
  Next: lead review, then landing after t06.
- Logs and reports are in `/home/paseo/.cache/tinkered-briefs/`:
  - `stack-t08-final-gate2.log`: required gate.
  - `stack-t08-validate2.log`: 50 passing lanes.
  - `stack-t08-all-tests-final.log`: all repo tests.
  - `stack-t08-mutation-first.log` and `.json`: first run.
  - `stack-t08-mutation-final.log` and `.json`: corrected run.

### t08 reviewer round 1

- Owner: stack/t08 writer; base stays `50b31bab`.
  No rebase or push in this round.
- Fix unknown queue sends before calling pg-boss.
  Add the managed error `UnknownQueue` with `{ queue }`.
- Apply retry settings on restart and remove dropped cron schedules.
- Prove a throwing Hono request rolls back its queued job.
  Keep the forced-close rollback test.
- Log cancellation when it uses the job's last try.
- Verify: each regression, required gate, coverage, prose, Jev.
  Run mutation only if source coverage drops.
- Caller check: this base has no jobs consumers outside its tests.
  No existing cross-package symbol changes.

### t08 round 1 fixes and gate

- New regression tests failed on the old runtime code, exit 1.
  Unknown queue send timed out, as did its close cleanup.
  Restart kept the old cron schedule.
  Last-try cancellation produced no failure log.
  The new throwing-request test already passed, as reviewed.
- Unknown queue sends now raise before any pg-boss call.
- Queue setup creates, updates, then schedules or unschedules.
  Omitted settings reset to `retryLimit: 2`, `retryDelay: 0`,
  and `retryBackoff: false`.
  These are pg-boss 12.35.0's defaults.
  All queue setup still runs before workers start.
- The final-try log now includes cancelled jobs during close.
  The early cancellation check uses that same error path.
- All four tests pass; the forced-close rollback test stays.
- Required gate: build, check, jobs 24, stack 63, tracker 79.
  `EXIT 0`; no errors and the same 29 warnings as before.
- Next: compare coverage, finish Jev and all validation lanes.

### t08 round 1 final proof

- The required gate passed, exit 0.
  Jobs: 24 tests; stack: 63; tracker: 79.
  Check: no errors and the same 29 warnings.
- `pnpm validate`: all 50 lanes pass, exit 0.
  `vp run -r test`: all 18 package tasks pass, exit 0.
- Coverage before and after, over every jobs source file:
  - Lines: 100% to 100% (73/73 to 79/79).
  - Functions: 100% to 100% (20/20 to 22/22).
  - Statements: 98.82% to 98.91% (84/85 to 91/92).
  - Branches: 95.34% to 95.65% (41/43 to 44/46).
    No file lost coverage in any of these measures.
    Mutation was not rerun, as requested for this fix round.
- Coverage used `@vitest/coverage-v8` 4.1.11 from the home cache.
  The temporary module link was removed after the checks.
  Repo package files have no new tool dependency.
- Jev tests and promises: no flags in 24 tests.
  The two existing jobs labels still apply:
  `leakedInternal false` for the private clock tag;
  `stateOutsideCell false` for test client cleanup.
  The tracker entry has its inherited false label.
  The stack test resource still needs its own database client.
  Other hits were hints or a noisy judge; no new labels.
- Prose and strict style census pass.
  No new Core feedback; the earlier close-hook probe still applies.
- Base snapshot stays `50b31bab`; no rebase or push.
  Card returns to Review for the round 1 fixes.
- Proof files share `/home/paseo/.cache/tinkered-briefs/`:
  - `stack-t08-round1-red-queue.log`: send and close timeouts.
  - `stack-t08-round1-red-other.log`: two failures and the passing throw test.
  - `stack-t08-round1-gate.log`: required gate.
  - `stack-t08-round1-validate.log`: all 50 lanes.
  - `stack-t08-round1-all-tests.log`: all package tests.
  - `stack-t08-round1-coverage-before/coverage-summary.json`.
  - `stack-t08-round1-coverage-after/coverage-summary.json`.

### t08 resume gate — 2026-09-30

- Owner: stack/t08 writer.
  Branch: `stack/t08`.
- Discarded the paused lander's uncommitted board,
  track, and calibration edits, as requested.
- The diff from reviewed `da34b8cf` to old head `5e968706`
  contains code changes from the earlier base change.
  It changes 49 files overall.
  The jobs package itself has no change in that diff.
- `50b31bab` is no longer an ancestor.
  Landed t06 at `2700a440` is an ancestor.
- Rebasing from `2700a440` tried to replay old main commits.
  It hit `scripts/validate.mjs`; that attempt was aborted.
- Rebased the ten jobs commits from their actual main fork,
  `4c88cded`, onto `origin/main` at `217a4fe3`.
  No jobs landing commit was present to drop.
- The completed rebase had one conflict:
  `tools/jev/cases.jsonl`.
  Kept main's labels and the two jobs labels.
- Main's stack code and the jobs code needed no merge edits.
  Drizzle still commits before the jobs extension starts.
  Main's publisher, namespace, trace, and close behavior stays.
- Restored `TODO.md` from current main.
  Old jobs commits had restored a stale Review card.
  The lead owns the current board and landing.
- Gate: jobs 24, stack 106, tracker 79 tests pass.
  Build and check pass: 0 errors, 28 warnings.
  A clean `origin/main` worktree also has 28 warnings.

```bash
vp run -r build && vp check \
  && vp run jobs#test && vp run stack#test \
  && vp run @tinker-issue-tracker#test
EXIT 0
```

- Jev tests: 0 flags in 24 tests.
  README promises: 0 gaps in 24 titles.
- Jev preflight: the private clock tag has its saved
  `leakedInternal false` label.
  It is shared only inside the package.
  The remaining hits are a noisy note and two hints.
- Strict style census: OK.
  Prose lint passes.
- t17 is absent from `origin/main` at this gate.
  The mapped 4xx job test still waits for its rollback fix.
- Next: all package tests, jobs and stack mutation under
  `/tmp/mutation.lock`, then `pnpm validate`.
- Proof logs: `~/.cache/tinkered-briefs/` files named
  `stack-t08-resume-gate.log`,
  `stack-t08-resume-main-check.log`, and
  `stack-t08-resume-jev-*.log`.

### t08 resume jobs mutation — 2026-09-30

- All 19 package test tasks pass: `EXIT 0`.
- Jobs mutation ran alone under `/tmp/mutation.lock`.
  It completed in the foreground with `EXIT 0`.
- Jobs: 133 killed, 1 timeout, 20 survived.
  No coverage: 3.
- Killed / (killed + timeout + survived): 86.36%.
  Stryker score: 85.35%, above its 85 floor.
- Proof: `~/.cache/tinkered-briefs/` files
  `stack-t08-resume-jobs-mutation.log` and
  `stack-t08-resume-jobs-mutation.json`.
- The lead reserved the next lock turn for t17.
  Waited in the foreground, polling once a minute,
  until `t17-mutation.done` existed.
- After that file appeared, fetched origin again.
  `origin/main` is still `217a4fe3`; t17 is absent.
  The mapped 4xx job test still waits for that fix.
- Stack mutation is queued after the done file.
  Next: its result, then `pnpm validate`.

### t08 follow-up after t17 — 2026-10-01

- The queued stack lane passed on the first resumed base.
  Killed: 530; timeout: 2; survived: 86; no coverage: 1.
  Killed share: 85.76%; Stryker score: 85.95%; `EXIT 0`.
  Its log and JSON use `stack-t08-resume-stack-mutation`
  in the briefs cache.
- A fresh fetch found t17 on `origin/main` at `22b91ecf`.
  Added the promised mapped 409 job test and README line.
- Before t17, the test failed: the 409 left an active job.
  After t17, the 409 leaves no job; no clock wait is needed.
  Red proof: `stack-t08-resume-409-red.log`, `EXIT 1`.
- Rebased onto `22b91ecf`.
  Kept both track-note blocks and both Jev label sets.
  The lockfile keeps main's separate example packages
  and the jobs dependency entries.
  Dropped only obsolete example dependencies in the conflict.
- Main's Hono, stack, and Core source stays unchanged.
  Install passed; restored `CLAUDE.md`.
- Full gate: jobs 25, stack 111, tracker 79; `EXIT 0`.
  Check: 0 errors, 28 warnings, matching a fresh main check.
  Logs: `stack-t08-resume-final-gate.log` and
  `stack-t08-resume-final-main-check.log`.
- Jev: 0 flags and 0 README gaps in 25 tests.
  The private clock's saved false label still applies.
  Strict style census and prose pass.
- Next: all package tests and validation, then fresh jobs
  and stack mutation on this final base under the lock.
  The lead owns review and landing; this writer never pushes.

### t08 final-base tests and validation

- All 29 test tasks pass without cache: `EXIT 0`.
  Each package used its own test config after the full build.
- `pnpm validate`: all 50 checks pass, `EXIT 0`.
  The workspace already allowed esbuild.
  Restored `pnpm-workspace.yaml`; it has no branch change.
- Logs in the briefs cache:
  `stack-t08-resume-final-all-tests.log` and
  `stack-t08-resume-final-validate.log`.
- Assumption: rerun both mutation lanes after the t17 rebase,
  since the tested Hono and stack behavior changed.
  Next: jobs, then stack, alone under `/tmp/mutation.lock`.

### t08 mutation timeout check

- First final-base jobs run: 127 killed, 7 timeout,
  20 survived, 3 without coverage; `EXIT 0`.
  Stryker score: 85.35%.
  Killed share: 82.47%, below the required 85%.
  This run does not meet the resume gate.
- Kept its full log and JSON under
  `stack-t08-resume-final-jobs-mutation-first`
  in the briefs cache.
- Four timeouts cover the unknown-queue test.
  That test awaited the send before releasing its transaction.
  It now polls the public result, closes in `finally`,
  and joins the send after close.
  It keeps the same managed error and payload checks.
  No runtime code or mutation setting changed.
- Gate after the test change: jobs 25, stack 111, tracker 79;
  build and check pass, `EXIT 0`.
  Check: 0 errors, 28 warnings, still matching main.
  Log: `stack-t08-resume-final-gate-cleanup.log`.
- Next: validate again, then both full mutation lanes.

### t08 Core feedback: early failure from an async send

The declared send result is a promise.
TypeScript accepted `.then` on its settled result.
The unknown-queue path returned a plain failed result instead.
The first test revision failed with `then is not a function`.

```ts
const pending = request.settle(piece.send, {
  input: { queue: "nope", data: {} },
});
await pending.then((result) => result);
```

`Scope.Settled<Promise<T>>` only declares a promise.
The test uses `Promise.resolve` before `.then`.
This is new type feedback; no Core source changed.

### t08 refresh after t18

- Fetched and rebased onto `origin/main` at `23f0ccce`.
  The only conflicts were appended track notes.
  Kept all t18 notes and jobs notes.
- Main's stack and tracker source stays unchanged.
  Install passed; restored `CLAUDE.md`.
- Fresh gate: jobs 25, stack 114, tracker 79; `EXIT 0`.
  Check: 0 errors, 28 warnings.
  A fresh clean main check has the same 28 warnings.
- Gate and main logs in the briefs cache:
  `stack-t08-resume-t18-gate.log` and
  `stack-t08-resume-t18-main-check.log`.
- Jev still has 0 flags and 0 README gaps in 25 tests.
  No source label changed.
- Next: all tests and validation on this base,
  then jobs and stack mutation under the lock.

### t08 t18-base validation

- All 29 test tasks pass without cache: `EXIT 0`.
- `pnpm validate`: all 50 checks pass, `EXIT 0`.
  Restored `pnpm-workspace.yaml`; it has no branch change.
- Logs: `stack-t08-resume-t18-all-tests.log` and
  `stack-t08-resume-t18-validate.log` in the briefs cache.
- Next: the final jobs run with the bounded queue check,
  then stack, alone under `/tmp/mutation.lock`.

### t08 bounded lifecycle checks

- The next jobs run ended with 125 killed, 9 timeout,
  20 survived, and 3 without coverage; `EXIT 0`.
  Killed share: 81.17%, below the required 85%.
  Stryker score: 85.35%; that score counts timeouts.
- Saved this run's log and JSON under
  `stack-t08-resume-final-jobs-mutation-second`
  in the briefs cache.
- The queue check still waited on a close that joined
  the blocked send before releasing its transaction.
  The test now borrows a real transaction from a separate
  session and closes that owner before joining the send.
  No fake database or runtime change is needed.
- Lifecycle checks now poll the job's entry event.
  The graceful-close check releases its gate in `finally`.
  A missing worker must fail the check without leaving
  the test waiting forever for an entry event.
- Full gate passes: jobs 25, stack 114, tracker 79;
  build and check pass, `EXIT 0`.
  Check: 0 errors, the same 28 warnings as clean main.
- Jev: 0 flags and 0 README gaps in 25 tests.
  Strict style census: OK.
- Next: check the timeout ranges under the lock,
  then rerun both full mutation lanes and validation.

### t08 cleanup validation

- `pnpm validate` passes all 50 checks, `EXIT 0`.
  Restored `pnpm-workspace.yaml`; it has no branch change.
- Proof: `stack-t08-resume-cleanup-validate.log`
  in the briefs cache.
- The focused mutation check is still waiting
  for `/tmp/mutation.lock` in the foreground.
- Next: its result, then both full mutation lanes.

### t08 authoring migration

- Owner: stack/t08 writer.
- State: Doing; main removed the old hook and store forms.
- Rebased onto `origin/main` at `d96fee94`.
  Kept main's authoring labels and the jobs labels
  in the only conflict, `tools/jev/cases.jsonl`.
- Assumption: jobs tests must use native database
  and transaction resources, matching main's Drizzle API.
- Next: object hooks and native test resources,
  then a fresh gate and both full mutation lanes.
- Verify: build, check, jobs, stack, tracker, Jev,
  strict style census, mutation, and `pnpm validate`.
- Read ADRs 0093 and 0094 and the wave-2 brief.
  The database resource uses `target: "namespace"`
  with a borrowed `{ client }` config binding.
  The session resource calls `openTransaction`.
- Jobs and all test extensions now use object hooks.
  The worker still borrows the native database's `$client`.
  Sending, retries, cron, and close order stay the same.
- Fresh gate: jobs 25, stack 114, tracker 79; `EXIT 0`.
  Check: 0 errors, 28 warnings.
  A clean `d96fee94` check has the same 28 warnings.
- Gate and baseline proof in the briefs cache:
  `stack-t08-resume-hooks-gate.log` and
  `stack-t08-resume-hooks-main-check.log`.
- Jev: 0 flags and 0 README gaps in 25 tests.
  The private clock's saved false label still applies.
  Strict style census and prose pass.
- Next: all tests and validation on this base,
  then the focused check and both full mutation lanes.

### t08 all tests after the hook migration

- All 29 package test tasks pass without cache, `EXIT 0`.
  Each task uses its own test config.
- Proof: `stack-t08-resume-hooks-all-tests.log`
  in the briefs cache.
- Next: validation, then the locked mutation checks.

### t08 validation after the hook migration

- `pnpm validate` passes all 50 checks, `EXIT 0`.
  Restored `pnpm-workspace.yaml`; it has no branch change.
- Proof: `stack-t08-resume-hooks-validate.log`
  in the briefs cache.
- Next: the focused timeout check, then both full
  mutation lanes alone under `/tmp/mutation.lock`.

### t08 timeout ranges after the hook migration

- Focused run: 75 killed, 0 timeout, 8 survived,
  3 without coverage; `EXIT 0`.
  Killed share: 90.36%; Stryker score: 87.21%.
- The old timeout cases now print `[Killed]`:
  fetch wait, worker registration, queue guard and body,
  per-call database, queue setup function and loop,
  and the error registry's throw body.
- The queue check releases its real transaction owner.
  Lifecycle checks poll entry and release the work gate.
  No runtime behavior or mutation settings changed
  to fix the timeouts.
- Proof: `stack-t08-resume-jobs-timeout-ranges.log`
  and its `.json` in the briefs cache.
- One queued attempt used the wrong CLI list form.
  Stopped only that waiting command and corrected it.
  Stopped the next waiting attempt when hooks landed.
  No running mutation lane was stopped.
- Next: both full lanes, jobs first, then stack
  after checking the t17 done file.

### t08 full jobs mutation after the hook migration

- Jobs: 135 killed, 0 timeout, 20 survived,
  3 without coverage; `EXIT 0`.
  Killed share: 87.10%, above the required 85%.
  Stryker score: 85.44%.
- The runner recovered from one worker's `SIGILL`.
  The final report has no error rows or timeouts.
- Proof: `stack-t08-resume-final-jobs-mutation.log`
  and its `.json` in the briefs cache.
- Checked that `t17-mutation.done` exists before
  queuing stack under `/tmp/mutation.lock`.
- Next: finish the full stack lane, save its counts,
  and hand the branch to the lead for review.

### t08 full stack mutation after the hook migration

- Stack: 553 killed, 2 timeout, 89 survived,
  2 without coverage; `EXIT 0`.
  Killed share: 85.87%, above the required 85%.
  Stryker score: 85.91%.
- Ran alone under `/tmp/mutation.lock` after jobs.
  Checked the t17 done file before queuing it.
- Proof: `stack-t08-resume-final-stack-mutation.log`
  and its `.json` in the briefs cache.
- Fresh fetch still shows `origin/main` at `d96fee94`.
  No further rebase or code change is needed.
- Next: final validation, then lead review and landing.

### t08 final resume proof

- Owner: stack/t08 writer.
- State: Review; all resume checks pass on `d96fee94`.
- Jobs and test extensions use event hooks.
  The namespace database resource borrows `{ client }`;
  the session transaction resource uses `openTransaction`.
  All 25 jobs promises still pass.
- The mapped 409 check failed before t17 with a saved job.
  It passes after t17 with no job, before clock advance.
- Gate: build, check, jobs 25, stack 114, tracker 79;
  `EXIT 0`, with 0 errors and 28 warnings.
  A clean main check has the same 28 warnings.
- All 29 test tasks pass without cache, `EXIT 0`.
- Both full mutation lanes pass the killed share floor:
  jobs 135 / 0 / 20, 87.10%;
  stack 553 / 2 / 89, 85.87%.
  Counts are killed / timeout / survived.
- Final `pnpm validate`: all 50 checks pass, `EXIT 0`.
  Restored `pnpm-workspace.yaml`; no branch change.
  Proof: `stack-t08-resume-post-mutation-validate.log`
  in the briefs cache.
- Jev has no test flags or README gaps.
  The two saved false labels stay in the case bank.
  Strict style census and prose pass.
- No owned check is left running. Never pushed.
- Next: lead review and landing; the lead owns the board.

### t09 writer assumptions and impact

- Register React templates by name at the root.
  Save that name and JSON props in each job.
  Render only when the worker runs.
- Use one jobs piece for mail and the app's other rows.
  The root binds its send operation with `piece.sendMail(queue.send)`.
- A permanent delivery failure must stay failed in pg-boss.
  Jobs needs a public `failJob(cause)` for that outcome.
  Use pg-boss per-job results after the session rolls back.
- Existing `jobs`, `job`, and `send` signatures stay the same.
  Callers: jobs tests, tracker job fixture,
  and the new mail package.
  Verify: jobs/mail/stack tests and a refs check on `failJob`.
- SMTP only; no HTTP provider is needed for this ticket.
  The root supplies the sender used when `from` is absent.

### t09 gate and review checks

- Fetched and rebased on `origin/main` at `b9ee321c`.
  The branch was current; no conflict needed a fix.
- Added `@tinker/mail`, with pinned Upyo 0.6.0
  and React Email 6.11.0.
  It exports a mail piece, a queue row, and a send operation.
- The gate passed with `EXIT 0`:

```bash
vp run -r build && vp check \
  && vp run --no-cache mail#test \
  && vp run --no-cache jobs#test \
  && vp run --no-cache stack#test
```

```text
check: 0 errors, 28 warnings
mail: 11 passed
jobs: 26 passed
stack: 114 passed
EXIT 0
```

- `pnpm validate`: all 54 lanes passed, `EXIT 0`.
  Mail has test and size lanes beside the other pieces.
- Strict style census and prose lint passed.
  TSDoc check: 0 S26 rows.
- Mail and jobs tests and README promises have no Jev flags.
- The test mock's state belongs to the test, not a scope.
  Labeled `stateOutsideCell` false for `createMailMock`.
  Rechecked only that judge's score after adding the label.
- Keep the backend tag inside `mail` so each definition
  has its own binding; the module-level tag note needs no label.
- The first preflight range included source outside this ticket.
  Also ran preflight on `origin/main..HEAD`
  to keep those flags apart from this ticket's changes.
- SCIP found `failJob` in jobs and its mail caller.
- Core feedback: none; no Core workaround was needed.

- Full repo tests: `vp run --no-cache -r test`
  passed all 31 tasks, `EXIT 0`.
  The tracker passed 79 tests; its jobs caller still works.
  The tinkerer suite keeps its one old skipped test.

### t09 final rebase and fault proof

- Fetched and rebased again onto `7014b683`,
  the PGlite merge that kept the jobs piece.
- Only `tools/jev/calibration.json` conflicted.
  Kept main's score data and dropped the old score commit.
  Rechecked `stateOutsideCell` against the merged labels.
  Every main label and this ticket's one label remain.
- The fresh gate passed, with the tracker added as a consumer:

```bash
vp run -r build && vp check \
  && vp run --no-cache mail#test \
  && vp run --no-cache jobs#test \
  && vp run --no-cache stack#test \
  && vp run --no-cache @tinker-issue-tracker#test
```

```text
check: 0 errors, 28 warnings
mail: 11 passed
jobs: 26 passed
stack: 114 passed
tracker: 80 passed
EXIT 0
```

- Fresh `pnpm validate`: all 54 lanes passed, `EXIT 0`.
- Fresh `main..HEAD` preflight has no file flags.
  The mock owner flag keeps its false label.
  The backend tag note and the noisy wrapper note are unchanged.
- Both fault lanes ran alone under `/tmp/mutation.lock`.
  Mail ran once, after the fresh gate and release checks.
  Its config sets `timeoutMS: 60000` and a floor of 85.
- Mail: 89.29%; killed 100, timeout 0, survived 12.
  No uncovered mutants and no errors; `EXIT 0`.
- Jobs: 85.96%; killed 142, timeout 5, survived 21.
  Three uncovered mutants and no errors; `EXIT 0`.
  Jobs ran before the final rebase; its package files
  were unchanged by that rebase, checked by `git diff`.
- Saved work waits in Review for the lead.
  The writer made no push.
- Core feedback: none; no Core workaround was needed.

### t09 review fix: optional SMTP login

- Fetched and rebased before the gate.
  `origin/main` stayed at `7014b683`; no conflicts.
- A URL with no user and no password opens SMTP without login.
  `smtp://localhost:1025` can use Mailpit or a local relay.
- A user or password alone still raises `InvalidConfig`
  with `{ key: "MAIL_URL" }` at boot.
  A wrong scheme or missing host stays bad config.
- Reused the local SMTP server for the no-login send test.
  Before the fix, that test failed with `InvalidConfig`, `EXIT 1`.
  After the fix, it boots, delivers mail, and sends no login command.
- Added the username-without-password test and both README promises.
- Kept `failJob(cause)` and the receipt retry rule as accepted.
  The jobs README already states that permanent failures do not retry.
- The requested gate passed:

```bash
vp run -r build && vp check \
  && vp run --no-cache mail#test \
  && vp run --no-cache jobs#test \
  && vp run --no-cache stack#test
```

```text
check: 0 errors, 28 warnings
mail: 13 passed
jobs: 26 passed
stack: 114 passed
EXIT 0
```

- `pnpm validate`: all 54 lanes passed, `EXIT 0`.
- Prose and strict style census passed.
- Jev tests and promises: no flags or gaps across 13 titles.
  Preflight: no file flags; `readUrl` has no unit flag.
  The earlier false `stateOutsideCell` label still applies:
  the test owns the mock transport, and scopes borrow it.
  Each mail definition owns its backend tag.
  The tag note needs no label; the wrapper notes are unchanged.
- Core feedback: none; no Core workaround was needed.

- The final mail fault lane ran once, alone, in the foreground:

```bash
flock /tmp/mutation.lock bash -c \
  'vp run --no-cache mail#mutate'
```

- It waited for the prior lock holder, then ran to completion.
- The changed-file rule arrived while that command was queued.
  Kept the command: its scope is exactly the changed-file list.
  All three mail source files are new on this branch:
  `src/errors.ts`, `src/index.ts`, and `src/testing.ts`.
  The report confirms those three files and matches the saved source.
- Killed 98, timeout 0, survived 12; no uncovered mutants or errors.
  `98 / (98 + 0 + 12) = 89.09%`, above the floor of 85.
  `EXIT 0`.
- Saved work waits in Review for the lead to land it.
  The writer made no push.
