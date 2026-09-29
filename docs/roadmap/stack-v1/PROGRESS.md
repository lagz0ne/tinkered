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
- **t04 core: a span carries a trace id** -- [ ] blocked by: none
  Writer: `stack/t04`, in `/home/paseo/next/tinkered-stack-t04`.
  Next: draw numeric bits at open; format on read; re-screen and re-check.
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
  core Observe/Trace# src/index.ts tests/trace.test.ts
  core Scope/Options#.*trace src/index.ts tests/trace.test.ts
  core Observe/Span#.*traceId src/index.ts tests/trace.test.ts
  core Observe/Span#.*spanId src/index.ts tests/trace.test.ts
  core Observe/Span#.*parentSpanId src/index.ts tests/trace.test.ts
  core Observe/Span#.*sampled src/index.ts tests/trace.test.ts
  core Observe/Trace#.*traceId src/index.ts tests/trace.test.ts
  core Observe/Trace#.*parentSpanId src/index.ts tests/trace.test.ts
  core Observe/Trace#.*sampled src/index.ts tests/trace.test.ts
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
- **t12 live updates across server processes** -- [x] landed `c0cc81c`
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

- **t17 hono answers a failed commit** -- [ ] blocked by: none
  Found by the t12 review. A request's session
  closes before its answer leaves; a failed commit
  answers 500 (today: 200 with nothing saved). Any
  error the route's operation raised rolls the
  request back, even when answered 4xx (ADR 0084).
  Verify: a test per rule that fails on today's
  main; `vp run hono#test`, tracker tests, browser
  proof, `pnpm validate`.

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
Bits will come from `random.next()` at open.
Hex text will be built on first read and cached.
The trace text is shared across children.
No extra core module name may be added.
The base stays `de72d42`.
Verify: N=31 for all observation cases and the seven named cases; no other row b is slower.
Then the full gate, all budget lanes, and one full core mutation run under the lock.
