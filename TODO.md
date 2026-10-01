# TODO — Kanban

The live board. Move a card between lanes; keep it in one lane only.
Long ticket notes and proof stay in [the track files](docs/roadmap/).

```text
Ready → Doing → Review → Done
         ↕
       Blocked

Parked = deferred; not scheduled
```

- **Ready:** approved and clear enough to start; ordered top to bottom.
- **Doing:** one card per lead. Name the owner, next step, and proof needed.
- **Review:** work is saved; review or checks still remain. Keep the owner and next step.
- **Blocked:** name the exact missing thing and the next step once it is available.
- **Parked:** an idea or deliberate deferral. Record what would make it worth starting.
- **Done:** proof was observed. Link the result; keep only recent cards here.

Finish approved work through Done. Blocked and Parked cards keep their true state.
[Earlier work and full migration history](docs/roadmap/archive/todo-2026-09-19.md).

## Ready

- **core/graceful-writes** — active calls keep state open during graceful close.
  Asked by: Harness and Tinkerer live entries.
  Next: a Core writer fixes the delayed controller write after the active card.
  Verify: a running call can finish its write during graceful root close;
  calls after close begins stay refused; Core ticket and size checks pass.
  [Proof](docs/roadmap/core-feedback.md#graceful-close-blocks-active-writes-2026-10-01).

- **docs/vertical — phone-readable docs: lists over tables, fences ≤ 60 chars (`docs/writing-style.md` → Vertical layout)**
  Owner: lead (Claude)
  Next: `node scripts/prose-lint.mjs --wide` lists 47 files; convert each when next touched, `TODO.md` and `docs/glossary.md` first; one contributor per package README
  Verify: `--wide` prints 0 files; `vp run prose` clean

- **perf/warm-ctl-trade** — win back `s4_warm_ctl` (+0.3 ns, +2.8% at perf/tagged-close) without losing `warm`: both read through `nodeState`; the fix that inlined the whole warm read (611 → 613 bytes) made the bare controller lookup slower. V8 first (inlining of both loops), then N=31 `SCEN="warm s4_warm_ctl"`. Verify: neither "B slower" vs main before perf/tagged-close.

- **core/close-hook-scope** — an extension can tell the scope began closing, on a graceful close too (a signal or state its start can read), and its close hook gets the scope. Two askers: sync/subscribe (a `closing` flag set by its close hook) and stack/t07 (nats replaces core's `scope.close` on its handle as a stopgap). Also (ADR 0085): a root's close hooks run once, cannot skip cleanup or replace its outcome, and a hook's throw becomes a teardown error; then `closed` counts it. Next: brief a writer after stack/t04 and core/start-log (one core card at a time). Verify: sync drops its `closing` flag and nats drops its `scope.close` patch; core tests; `scripts/ticket.sh`; `pnpm validate`.
- **core/traceparent** — one W3C `traceparent` parse and format helper beside core's trace types; hono, http, and nats use it and drop their copies. Next: brief after the core lane frees (core/root-lifetime, then core/start-log, then core/close-hook-scope). Verify: SCIP refs show one parse and one format; core, hono, http, nats tests; `pnpm validate`.
- **stack/span-kinds** — OTLP span kind from the driver: hono marks server spans, http client spans, nats producer and consumer spans; today every span exports INTERNAL. Next: settle where the kind hint lives (ADR 0076 §5 left it open) after core/traceparent. Verify: the sink test sees SERVER / CLIENT / PRODUCER / CONSUMER per driver.

## Doing

- **stack/t16 generator** — owner: stack/t16 writer.
  Next: final rebase, review, mutation, and gate.
  Verify: fresh app checks and tests; dev and prod boot;
  changed-file mutation at least 85; full gate and validate.
  [Track](docs/roadmap/stack-v1/PROGRESS.md).

Pairs since 2026-09-29: an Astra writer (`codex/gpt-6-astra`, xhigh) and an Opus 5.5 (high)
reviewer per card (no Fable, user 2026-09-29); a lander runs mutation, timing, and `pnpm validate` alone, one core card at a time.

## Review

Next: lead reviews and lands `stack/t15`; no push.
Verify: gate `EXIT 0`; Stack 152, Hono 93, tracker 128;
four fresh browser proofs; validation 54/54.
Changed-file killed shares: Stack 86.02%, tracker 85.83%.
[Proof](docs/roadmap/stack-v1/PROGRESS.md).

Hook loggers replace the boot log workarounds.
Next: lead review and landing; the writer never pushed.
Verify: final gate EXIT 0; all 31 test tasks pass.
Killed shares: Hono 86.87%, jobs 85.33%, Stack 87.25%.
Validate: all 54 lanes pass on origin/main at 5487051b.
[Proof](docs/roadmap/stack-v1/PROGRESS.md).

Next: lead reviews and lands the saved branch.
Verify: gate `EXIT 0`; auth 25, mail 13, jobs 26;
Stack 114, tracker 80; all 31 test tasks; release 54/54.
Auth changed-file mutation: 88.03% (103/0/14).
Rebased onto `758efce5`; auth source hashes match the run.
[Proof](docs/roadmap/stack-v1/PROGRESS.md).

Next: lead lands `stack/t09`; the review fix and checks are saved.
Verify: review fix gate `EXIT 0`; mail 13, jobs 26, stack 114;
release 54/54; mail killed share 89.09% (98/0/12).
[Proof](docs/roadmap/stack-v1/PROGRESS.md).

Next: lead reviews both fixes and the event and store rebase.
Verify: auth 19, Hono 93, Stack 114, tracker 79; full repo tests;
fresh auth and Hono mutation above 85; browser proof and 7 helpers;
validation 50 of 50, `EXIT 0`; prose and style pass.
[Proof](docs/roadmap/stack-v1/PROGRESS.md).

## Blocked

## Parked

- **perf/explicit-uses** — declare the ctx features a unit uses (`uses: ["defer", "signal"]`). The committee (Astra + Fable) found an estimated 10–40 ns per run and a migration of every package; the user skipped it (2026-09-29, ADR 0073). Resume when: a graph consumer needs per-unit lifetime facts, or the per-run ctx becomes the main cost of a hot path. Next: the measure-only ceiling screen in `/home/paseo/next/tinkered-inv-reports/committee-uses.md`.

- **jev/handrolled** — survey, bridge analysis, ADR 0070, and plain rules S20–S25 landed
  (tags `jev/plain-rules`, `tracker/reconnect`). Left: the two Jev judges `bridgesOwnStatus` and
  `redundantAbort`. Resume when: each has 5 true labels in `tools/jev/cases.jsonl` (ADR 0054;
  today 2 and 1). Next: add the judges' questions to the bank and calibrate.

- **perf/lifecycle-creep** — `lifecycle` (a fresh scope, then a plain `close()`) crept across two
  landings: core/cancel-reason +0.2% (37/61), then core/with-data +1.8% (42/61); about +2.7%
  together (separate runs, read loosely). Each passed the bar alone. Parked by the user
  (2026-09-27, "conclude the work"). Resume when: the next change to the close path, or a caller
  that closes many short scopes. Next: find what core/with-data added to `closeLayer`/`fastClose`
  with V8 traces, prove a fix with `N=61 SCEN=lifecycle bench/queued.sh`.

- **errors/errorMap** — an `errorMap` field on an operation that turns its panics into managed
  errors in one place (user idea, 2026-09-26; parked by the user). Not needed now: 9 catch-then-raise
  spots in 4 packages each wrap one call with details only that spot has, and drivers (hono,
  process, mcp) already `settle` each op and turn a panic into a 500, exit 1, or a tool error —
  Go's `recover` at the request edge. Resume when: two packages want every throw in an op
  converted and neither `try/catch` + `ctx.raise` nor `settle` can do it. Next: the three open
  questions (panics only? return `{ kind, payload }`? any depth?). Verify: both askers drop their
  workaround.

- **blueprint/devtool — a devtool extension that draws and edits a blueprint graph from the YAML (nodes, `depends` edges, `why` on each node)**
  Resume when: blueprint/t05 landed and the YAML shape has held for two apps
  Next: Decide the host (browser devtool vs a Paseo plugin); the file stays the truth, the tool only reads and writes it
  Verify: A blueprint round-trips through the tool with no diff

- **ai/v1 — `@tinker/ai`**
  Resume when: A real driver needs the AI layer
  Next: Start from that driver's use case and write the scope and tickets
  Verify: Driver need and acceptance checks recorded before implementation

- **core/ideas — Remaining core feedback**
  Resume when: A second integration asks, or the existing workaround misrepresents behavior
  Next: Use the [reviewed ideas](docs/roadmap/blocked-and-parked-review.md#core-ideas-one-by-one), name the caller, and scope one need
  Verify: Evidence of the real need before creating a core ticket

- **react/mutation — Mutation checks in the browser**
  Resume when: This deferred test-tool integration is scheduled
  Next: Set up Stryker with the existing browser tests; [track note](docs/roadmap/react-v1/PROGRESS.md#v1-complete)
  Verify: Prove browser tests exercise mutants; record an isolated mutation run

- **react/observation — Pending work and component activity**
  Resume when: A concrete UI/debugging need asks for these facts
  Next: Design the needed events and their lifetime; [reverted r16](docs/roadmap/react-v1/issues/16-react-span-emission.md)
  Verify: Clear event contract and behavior checks before implementation

[All blockers and parked work reviewed 2026-09-19](docs/roadmap/blocked-and-parked-review.md).

## Done

- **stack/t15 server-pages** — the tracker's pages render on the server with TanStack Router 1.170.40 (pinned) under one Hono route: `@tinker/stack`'s `pages()` piece reads the page's cells in the request's session, renders, and streams the HTML through Hono's `stream`, so the session stays open until the stream ends and commits then (ADR 0084); the browser boots from those values, then the SSE wire takes over; 404 pages stay server pages; the dev host renders pages through Vite and an edit shows on reload. Proof: gate EXIT 0 (stack 152, hono 93, tracker 128; 0 errors, 28 warnings), browser proof 4/4, changed-file mutation stack 86.02% (203/2/31), tracker 85.83% (327/3/51), validate 54/54. Lead review. Sol writer 3dc1eaaa. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **authoring/package-roles** — all 16 package roles checked.
  Removed unused `utils`; Drizzle and React entries name their roles.
  Opus high review READY; build, check, full tests, and 54 release checks pass.
  Current-main checks pass; all six docs pass prose and phone checks.
  [Track](docs/roadmap/authoring-model/PACKAGE-ROLES.md).

- **stack/start-log-cleanup** — the stack pieces log through their hook's logger now that core/start-log landed: hono's boot logger resource and its `hono.errors` span are gone; `readExitCode(result, log, phase)` takes a logger instead of `observe` plus `clock`; the server, live, migrate, nats, and jobs pieces drop their direct sink writes (the trace sink keeps its warnings local so they never feed its own queue). Log lines add `extension`. Proof: gate EXIT 0 (all 31 test tasks; 0 errors, 28 warnings), changed-file mutation hono 86.87% (397/0/60), jobs 85.33% (128/5/17), stack 87.25% (267/0/39), validate 54/54. Lead review. Sol writer 4f788859.
- **process/role** — settled as app entry support.
  CLI host adapter; graph modules and helper libraries have clear roles.
  Proof: public API and callers reviewed; 48 Process tests pass;
  prose has 0 hits; all five touched docs pass the phone-width check.
  [Track](docs/roadmap/authoring-model/PROGRESS.md#process-is-app-entry-support).

- **stack/t14 dev-host** — `vp run dev` is one process, the dev host (`@tinker/stack/dev`): it keeps the HTTP listener, one PGlite, a local `nats-server`, and Vite (client HMR) for the whole session; a server edit re-imports the app, stops the old root through its signal, and starts a new one with the lent handles (`runServer(env, stop, host?)`; the store takes `{ kind: "borrow", client }`). Old requests finish; a failed edit keeps the host up and answers the error until the next good edit; SIGTERM closes everything. Only the dev host binds defaults: the tracker in prod now needs `PORT`, `HOST`, `DATA_PATH`, and `NATS_URL` (its no-NATS local mode is gone). `benchctl ab`: a reload beats a restart, 20,882 → 7,288 ms (−65%). Proof: gate EXIT 0 (stack 135, nats 36, drizzle 43, tracker 87; 0 errors, 28 warnings), changed-file mutation stack 85.75% (319/1/52), nats 88.10% (111/0/15), validate 54/54. Lead review of the prod path. Sol writer c4f5f4d3. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **process/thin-entry** — native command and service ownership.
  Object calls, static shells, caller-owned output, and guarded main entries.
  All callers moved; Opus high review READY.
  Proof: full build, check, 31 test tasks; Process 48; strict census and prose.
  Fresh fault scores: Process 86.00, Blueprint 86.23, Tinkerer 91.82.
  Release checks 54/54; three outside-repo example copies pass.
  [Track](docs/roadmap/authoring-model/PROCESS.md).

- **process/model-review** — basic jobs and extra layers reviewed.
  Proof: build, check, 50 tests, and strict style census pass.
  Real probes show lost pipe output, ignored cleanup, and a loader stop gap.
  Smaller command and service cases are proposed; no runtime code changed.
  [Review](docs/roadmap/authoring-model/PROCESS-REVIEW.md).

- **stack/t11 auth-mails** — sign-up sends a verify mail and a reset request sends a reset mail, both through `sendMail` (React Email templates in `@tinker/auth`; an app can pass its own); links use `BETTER_AUTH_URL`, the sender comes from mail; mail stays optional. The mail job is added after Better Auth commits, so PGlite's one connection takes turns; if that insert fails the account stays and the mail is lost (the README says so). Six HTTP tests: verify link marks the email verified, reset link sets the new password, a duplicate sign-up sends nothing. Proof: gate EXIT 0 (auth 25, mail 13, jobs 26; 0 errors, 28 warnings), changed-file mutation 88.03% (103/0/14), validate 54/54. Lead review. Sol writer bcb8d8e0. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **core/start-log** — a log written in an extension's event-form `start` or `close` hook now reaches the scope's sink, with the level filter and clock, named by the extension, no span (on main both printed `[]`; five askers: stack t02, t05, t07, t08, t13). The logger is built once per extension on first use; logging off stays a no-op. Proof: gate EXIT 0 (core 796, all repo tests; 0 errors, 28 warnings), slots headroom 4, size 16,350 B (cap 16,384), N=31 timing all "no difference we can see", changed-line mutation 85.71% (6/0/1), validate 54/54. Lead review. Sol writer c3f272c1. The stack pieces' workarounds can go now (a follow-up card).
- **stack/t09 mail** — `@tinker/mail` on Upyo 0.6.0 and React Email (pinned): the app's operation calls `sendMail` (template + props + to/subject), which adds a mail job through the request's transaction, so a rolled-back request sends nothing; the job renders HTML and text and sends; a retryable failure retries, a permanent one fails once via `failJob(cause)` (new in `@tinker/jobs`); `MAIL_URL` (`smtp://`, login optional so Mailpit works) checked in start; a log backend for dev and Upyo's mock for tests. Proof: gate EXIT 0 (mail 13, jobs 26, stack 114; 0 errors, 28 warnings), mail mutation 89.09% (98/0/12), release checks 54/54. Lead review (one fix: optional SMTP login). Sol writer daf6d3a7. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **authoring/main-entries** — static exports and guarded app entries.
  Proof: READY review; build, check, all 30 test tasks, and prose pass.
  All ten fresh example copies and 52 release lanes pass.
  Thirty imports start nothing; stop probes keep the finished reply.
  Cleanup, strict style census, and TSDoc checks pass.
  [Proof](docs/roadmap/authoring-model/ENTRIES.md).

- **authoring/drizzle-pglite** — static PGlite units and a migration action.
  Tracker and example use namespace config and session transactions.
  Proof: Opus review READY; build/check, 28 test tasks,
  browser-helper 7, 48 release checks, Drizzle faults 87.97 >= 85.
  All 336 inputs match; all 14 package fault scores pass.
  [Track](docs/roadmap/authoring-model/PGLITE.md).

- **stack/t08 jobs** — `@tinker/jobs` runs pg-boss 12.35.0 (pinned) as a driver: each job's operation runs in its own session, success commits, a throw rolls back and retries, after the limit one `job failed` line; an operation adds a job through the request's transaction, so a rolled-back request (including a mapped 4xx, ADR 0084) adds none; cron rows through pg-boss; a queue no row lists raises `UnknownQueue` before touching the database; a restart applies changed rows; Drizzle migrates before pg-boss starts in its own `pgboss` schema; PGlite borrows the store's client, Postgres needs `JOBS_URL` (checked in start). Event-form hooks and the static store resource (ADRs 0093, 0094). Proof: gate EXIT 0 (jobs 25, stack 114, auth 19, tracker 79; 0 errors, 28 warnings), jobs mutation 87.10% (135/0/20), stack 85.87% (553/2/89), validate 52/52. Reviewer READY (b372d629) before the resume; Sol rebase writer 04d6e604; the lead rebased onto stack/t10 and landed. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t10 auth-signin** — `@tinker/auth`: Better Auth 1.7.6 (pinned exact, with its Drizzle adapter and the `auth` CLI) for email and password sign-up and sign-in, mounted at `/api/auth/*` through the hono wiring; its tables live in `pgSchema("auth")` in the app's one migration history (the app's `schemaFilter` is `public` and `auth`, never `pgboss`) with an auth drift check; the signed-in user is read from the cookies BEFORE the request's transaction opens (hono tags may return a promise; a graceful close drains accepted reads and answers 503 meanwhile; 499 after a forced close or a client abort). Review fixes: the refreshed session cookie now reaches every reply (users were signed out after 7 days), including raw `Response` answers. ADR 0084 holds with async tags. Event-form hooks and static database resources (ADRs 0093, 0094). Proof: gate EXIT 0 (auth 19, hono 93, stack 114, tracker 79; 0 errors, 28 warnings), browser proof, auth mutation 86.00% (86/0/14), hono 86.38% (406/0/62), validate 50/50. Reviewer 06eab677 (two rounds; the lead checked round 2). Sol writer cfabd9f8. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **authoring/hooks** — one event hook form; native static Drizzle resources.
  Owner: lead (authoring session); Astra writers, xhigh, one package each.
  Next: complete; namespace instances and session transactions are explicit.
  Verify: build/check, 28 test tasks, 48 release lanes, and 207 event calls pass;
  all 14 fault scores >= 85; fresh Drizzle 96.77, Hono 93.01, Stack 85.91.
  [Track](docs/roadmap/authoring-model/HOOKS.md).

- **stack/t18 roots-signal** — `@tinker/stack` drops `runUntilStop` for `readExitCode(result, observe, phase)` over a plain `Result` (ADR 0085 §6: failed or any teardown error answers 1, else 0, `cancelled` included); the tracker's server root passes its stop signal to `createScope({ signal })`, takes the phase from which way `scope.ready` settled, and awaits `scope.closed`. A failed boot keeps its teardown errors in the log line; a failed telemetry boot is covered. SIGTERM exits 0; a bad `PORT` exits 1 with one "boot failed" line and no database touched. No `runUntilStop` left; the lifetime lint (S19, S27–S29) prints no row. Proof: gate EXIT 0 (stack 114, tracker 79; 0 errors, 28 warnings), browser proof, stack mutation 85.63% (548/3/89), validate 48/48. Review: the first reviewer (5d41ea28) stopped in the 05:53 restart after one fix round; the lead reviewed the final diff. Sol rebase writer f63d5891. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **examples/standalone** — all eleven examples run on their own.
  Owner: lead (Codex); Astra writers; Opus 5.5 READY.
  Proof: every exported copy passed install, check, tests, and run.
  Full build, check, package tests, prose, and strict census passed.
  All 48 release checks passed; Jev calibration is saved.
  [Track](docs/roadmap/examples-v1/PROGRESS.md).

- **stack/t17 hono-commit** — a request commits before it answers: a close that is not clean (failed commit, failed hook, any teardown error) answers a fresh 500 and logs one `RequestCloseFailed` line; any raised error (mapped 4xx, body builder, unmapped, plain Error, HTTPException) rolls the request back and its answer is unchanged; a returned (not raised) 4xx commits; a stream commits at its end and errors on a failed commit (ADR 0084, user 2026-09-29). The server piece shuts its port when close starts and keeps per-start state (`PieceInUse` on a second live root). Rebased onto the authoring-model main (kept its abort and stream-start cleanup, call ownership, trace reads). The new tests fail on main in 9 places. Proof: gate EXIT 0 (hono 86, drizzle 25, stack 111, tracker 79; 0 errors, 28 warnings), browser proof 4/4 uncached, hono mutation 86.85% (370/0/56), stack mutation 85.71% (552/3/89), validate 48/48. Reviewer READY (839f6123) before the resume; Sol rebase writer 4783edd2; landed by the lead. [track](docs/roadmap/stack-v1/PROGRESS.md).
- **authoring/packages** — checked all 14 packages and all three apps.
  Owner: lead (authoring session); source: `46bf1f74`.
  Fixed owner, namespace, setup, and steering gaps with public tests.
  Core call signals stop one action and leave its parent alive.
  Trace is a reusable extension with its own telemetry scope.
  Added the two-service Harness example and the authoring guide.
  Proof: build/check, all 18 test tasks, prose, and 48 release lanes pass.
  All 14 package fault scores pass the floor of 85; Stack is 85.95.
  Main's fresh install and checks pass; all 374 checked inputs match.
  Core is 16,384 bytes gzip at the approved 16 KiB cap.
  Checkpoint tag: `core/tauthoring-packages`.
  [Track](docs/roadmap/authoring-model/PACKAGES.md).

- **process/early-abort** — startup abort stops before the command runs.
  Owner: lead (authoring session); source: `5b7a0cd5`.
  Proof: the public regression failed before the fix and now returns 130.
  Process 50 tests pass; code check has 0 errors; fault score 94.61.
  Root completion uses a signal and waits for `closed`.
  [Track](docs/roadmap/authoring-model/PACKAGES.md).

- **react/namespaces** — reset and refetch keep sibling project stores.
  Owner: lead (Codex); source: `878ca7ba`, Playground: `a8f131ff`.
  Pushed to main; [live Sessions lab](https://playground.tini.works).
  Proof: two red checks before the fix; React 83 and Playground 64 tests pass.
  Full build/check/tests, 48 release lanes, and React fault score 93.10 pass.
  The live image is healthy and its files match the checked build.
  Live resets, route return, caches, and source navigation pass at three widths.
  [Track](docs/roadmap/react-v1/PROGRESS.md).

- **playground/awwwards** — refined sea, Code, and Benchmark are live.
  Proof: source `c55801d3`; build/check, 17 test tasks, 48 release lanes pass.
  Paired storm verdict: b is faster; 25.5% less time in the headless check.
  Deployment done, healthy image, matching live files, desktop and phone checks pass.
  [Track](docs/roadmap/playground-v2/PROGRESS.md).

- **authoring/model** — lazy object hooks and all five module fixes.
  Landed and pushed at `dfaad530`; tag `core/tauthoring-model`.
  Core: 16,373 bytes gzip under the approved 16 KiB cap.
  Proof: build/check, all 17 test tasks, 48 release lanes, and prose passed.
  All 14 package fault scores meet the floor of 85.
  The eight task checkouts and branches were removed.
  [Track](docs/roadmap/authoring-model/PROGRESS.md).

- **migrate/root-lifetime** — Astra writer + Opus review (one fix round); tag `migrate/root-lifetime`; ADR 0085. Every root outside core and stack stops closing itself after a rejected `ready`: the tracker's test fixtures and `src/client/main.tsx`, the examples, and the sync tests (each ran its close hooks twice since core/root-lifetime; a tracker test now counts one close). `examples/mcp/serve.ts` is the model entry: `createScope({ …, signal: AbortSignal.any([stop, ended.signal]) })`, `await scope.closed`, exit code failed → 1, teardown errors → 1, else 0. S29 rows left: only stack's `runUntilStop` (stack/t18). Tracker 79 tests, browser 7, sync mutation 86.60 (398 killed, 9 timeout, 61 survived, 2 no cover), validate 48 PASS. Jev: 2 `inputDefaultMasks` labels; calibrated (proven, sep 54%, ordered 95%).
- **stack/t13 trace-sink** — the stack's trace sink sends spans and logs as OTLP/JSON to `OTEL_EXPORTER_OTLP_ENDPOINT` (our own writer, no dependency, ~10 KB): spans queue by reference and encode at flush (the sink adds ~5 µs per request over local JSON logs); bounded queue; a dead or slow collector never fails a request, a forced close aborts in 4 ms, a graceful close flushes within 1 s; ok spans UNSET, failed spans code 2; logs carry severity and their span's ids; `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` checked in start. NATS publish carries `traceparent`; a subscriber joins the trace; tracing off sends no header. Payload checked against the official OTLP proto code. Proof: gate EXIT 0 (stack 92, nats 24, tracker 79), stack mutation 85.61% (465/5/76), nats mutation 92.74% (166/0/10), validate 48/48. Reviewer READY (52f8099b). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **jev/lifetime-rules** — Astra writer + Opus review (one fix round); tag `jev/lifetime-rules`; ADR 0085 §7. S19 (a helper that takes a scope, controller, or session) now also runs in the repo lint for `apps/*/src`, `examples/`, and `packages/stack/src`, and sees `Scope.RootHandle`. New S29, a root's lifetime written by hand: S29.ready (a `try` that only awaits a root's `ready` and whose `catch` closes that same root, or `ready.catch`/`.then(_, fail)` that does) and S29.stop (a graceful close after a hand-written wait on an abort). The lint reads test files for S29 only. Repo rows today: S19 at `packages/stack/src/stop.ts`, S29.ready at 12 spots that migrate/root-lifetime and stack/t18 remove. Jev tests 144, writer-trial tests 60.
- **core/root-lifetime** — Astra writer + Opus review (one docs fix round); tag `core/root-lifetime`; ADR 0085. `createScope({ signal })` returns a `Scope.RootHandle`: an abort closes the root gracefully once `ready` resolved, and `closed` holds core's one close `Result` (signal roots only, a plain property). `ready` now rejects only after the forced close ended, and core's own closes (a failed start, the signal) go through the handle's `close`, so every close hook runs (they were skipped on a failed start). Two tests failed on main first. Core 750 tests, mutation 85.66 (2742 killed, 29 timeout, 436 survived, 28 no cover), validate 48 PASS, slots end at 254, size 14,981 B, benchd N=61: `create` +0.8% (32/61), `lifecycle` −0.5% (30/61), `cold` +0.5% (35/61), `cold2` +0.7% (36/61), `s1_getctl` −0.6% (24/61), `s2_data` −0.2% (31/61), `s3_doubled` −0.3% (23/61), `session` −0.5% (28/61): all no difference we can see. Known until the migrations land: roots that still catch a failed `ready` and close by hand run each close hook twice (every hook is safe to); a close wrapper that waits before core's close can still see a second close (core/close-hook-scope).
- **stack/t06 migrate-step** — the tracker's tables come from Drizzle migration files: the stack's migrate step (listed right after the server piece) takes a Postgres advisory lock, brings an old hand-migrated database level (a baseline that keeps every row, from any point of its history), runs the migrations, and releases the lock before the port opens; `@tinker/drizzle` runs the folder and gives a drift check (`SchemaDrift` with drizzle-kit's answer); the stack's test helper migrates once and hands each test a PGlite `clone()`. Never `push`. The lock is proven only on PGlite (one connection, never contended). Proof: gate EXIT 0 (drizzle 25, stack 63, tracker 79), browser proof, config test 3/3, drizzle mutation 93.86% (107/0/7), stack mutation 88.89% (253/3/32), validate 48/48. Reviewer READY (49d197f1). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t04 trace-id** — core: every observed span carries a W3C trace id and span id (lazy hex, private id stream: observation never moves a seeded `ctx.random`, ADR 0086); a session can join a remote trace; hono reads `traceparent`, http sends it; core imports no OTel; nothing draws at import (Workers-safe). Cost: `opobs` +8 ns (+4%, N=61), accepted by the user. Proof: gate EXIT 0 (core 731, hono 71, http 86), slots headroom 1, impact 0, mutation core 85.38% at 60 s (2687/29/437; killed 85.22% of decided) / hono 86.09% (291/0/45) / http 89.70% (446/7/45), validate 48/48, N=61: no other row slower. Reviewer READY (43da66df). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t12 live-across** — a save on one server reaches tabs on another: after a commit the stack's live piece sends one empty signal per app over NATS, and every server (the sender too) re-reads from the database; no signal on a GET, a rolled-back save, or a failed commit; a handled 4xx that saved still signals. Reviewer probes: a burst of 10 saves ends on the final list everywhere. Later: send the signal whenever the commit works, not only when the sender's own re-read works. Proof: gate EXIT 0 (stack 58, nats 19, tracker 69), browser proof, stack mutation 89.47% (238/0/28; the stack lane now waits 60 s per mutant: at the default limit it gave 226/15/25 and its timed-out mutants left `/tmp/tinker-nats-*` stores), validate 48/48. Reviewer READY (0420f317). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t07 nats** — `@tinker/nats` on the NATS v3 client (pinned): the extension checks `NATS_URL` in start and connects at boot even with no subscriptions (fail fast on an unreachable server, a deliberate reading of ADR 0081 §4); publish is an operation; a subscription row runs its operation in its own session per message, a failure logs one line and the next message runs; close drains then closes; a second live start of one piece fails `PieceInUse`. Tests run a real `nats-server` v2.15.0, SHA-256 checked, cached. Proof: gate EXIT 0 (nats 19), nats mutation 91.43% (224/0/15 at 60 s; the lane's 10 s limit gave 193/31/15, same score), validate 48/48. Reviewer READY (f9c360e0). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t02 hono-errors** — a managed error becomes its HTTP answer through `@tinker/hono`: an error table maps a kind to a status, or a status plus a body from the payload (Rails `rescue_responses`); an unmapped error logs one line through the scope's sink and answers 500; `HTTPException` keeps its response. The tracker declares its table; every answer is byte-for-byte the same (reviewer probed each kind). Proof: gate EXIT 0 (hono 68, tracker 69), browser proof, hono mutation 85.27% (249/0/41), validate 46/46. Reviewer READY (f0f42868). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t03 drizzle-rc** — the repo runs on one exact Drizzle 1.0 RC: `drizzle-orm` and `drizzle-kit` `1.0.0-rc.4` pinned in the catalog (ADR 0079); `@tinker/drizzle` accepts `^0.45.2 || ^1.0.0-rc.4` (reviewer proved 0.45.2 still works: the package never imports drizzle-orm); the tracker builds its client the 1.0 way. Proof: gate EXIT 0 (drizzle 13, tracker 69), browser proof, drizzle mutation 88.14% (killed 52 / timeout 0 / survived 7; the lane's default 5 s limit starves on this box: 39 / 20 / 0 twice, main 34 / 24 / 1, so the proof run used `--timeoutMS 60000 --concurrency 2`), validate 46/46. Reviewer READY (de555b1a). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t01 sync-sse** — `@tinker/sync/sse` ships the SSE transport, both halves: `createSseServer(write, signal)` over a plain chunk writer (sync imports no Hono) and `createSseClient({ open, onState, onRetry })`; the tracker and the sync example dropped their copies. Reviewer ran 20,000 random event sequences old vs new: 0 differences. Proof: gate EXIT 0 (sync 69, tracker 69), browser proof 4/4 uncached, sync mutation 86.81%, validate 46/46. Reviewer READY (e9e3562c). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **stack/t05 stack-server** — `@tinker/stack` exists: the server stack piece checks `PORT`/`HOST` in its start (one `BadListenSettings` names every bad key), opens the port after every other start, serves the built client; `runUntilStop` answers the exit code; `jsonLines` writes the logs. The tracker's entry uses it; its root is still one function (ADR 0078). Proof: gate EXIT 0 (stack 38 tests, tracker 69), browser proof (7 tests), stack mutation 87.68%, validate 46/46. Reviewer READY (c2cdb8c8). [track](docs/roadmap/stack-v1/PROGRESS.md).
- **entries/follow-suit** — Astra writer + Opus review (one fix round); tag `entries/follow-suit`; ADR 0078. Every backend entry and example root now follows ADR 0078; the S27/S28 lint prints no row over apps, examples, and package source (6 rows on main before). Guarded: `packages/blueprint/src/main.ts`, `examples/mcp/cli.ts`, `examples/process-cli/main.ts`; `examples/mcp/serve.ts` became one root function (stops on SIGINT, SIGTERM, or stdin end; review fix: a closed stdin crashed it with exit 13). `boot()` left `examples/sync/hono.ts`; the sync test builds its own root `[web, src]`. The hono, mcp, and sync tours close a rejected `ready`. The `packages/mcp/README.md` entry snippet is guarded. Browser roots stay out of scope. validate 44 PASS, blueprint mutation 86.27, sync mutation 86.49.
- **perf/tagged-100** — a tagged call copies its bindings into a one-item list first, not an empty list that grows; reads match `readMany` exactly (list iterator once, no caller methods, no re-read). Fable writer (`5234b4b` + fix `5ecc245`); Astra cross-review READY (8 differences fixed; 820 + 627 checks MATCH); tag `perf/tagged-100`. benchd N=61 vs `2148e48`: `tagged` 188.3 → 171.3 ns (−9.0%, 5/61), `taggeddefer` 346.8 → 329.3 (−5.0%); no row B slower in all 23, `warm` no difference we can see. Core mutation 85.59; 715 tests; promises tagged 2; validate 44 PASS. New rule: `tagged` ≤ 200 ns. With every rule kept the floor is about 145–150 ns; 100 needs ADR 0038 dropped for tagged calls and a tag API that allocates nothing; the user chose to stop (2026-09-29) ([budgets](docs/roadmap/core-v1/budgets.md)).
- **perf/lazy-log-obs** — a body's `log` and `obs` tools are built on first read (getters on the ctx prototype; no API change; ADR 0073); retained ctx fields written once. Astra writer, Fable review (9-case behavior probe, gate), lead READY; tag `perf/lazy-log-obs`. benchd N=61 vs `a4baeb0`: `opsink` 251.9 → 72.0 ns (−71.4%, 0/61), `opobs` 248.9 → 208.4 (−16.3%), `op` −18.9%, `run` −15.7%, `tagged` 198.3 → 188.8 (−4.8%); `oplog` no difference we can see; no row B slower in all 23. Core mutation 85.44; 715 tests; promises tagged 2; validate 44 PASS ([budgets](docs/roadmap/core-v1/budgets.md)).
- **perf/tagged-close** — fp3/fable stack + Astra's lazy tagged child session + mutation lift + warm fix (`nodeState` inline again); reviewed by Opus (code), Astra (758 cases vs main: only ADR 0071/0072 outcomes), Fable (62 lazy-session boundary cases; lift READY); tag `perf/tagged-close`. ADR 0071 (an idle session ends in place) and ADR 0072 (a tagged call that ended in place returns its value). benchd N=61 vs `917ee14`: `tagged` 2150.3 → 198.0 ns (−90.8%, 0/61), `session` 1684.9 → 572.8 (−66.0%), `taggeddefer` −83.8%, `taggedres` −22.1%, `create` −36.6%, `op` −15.7%; `warm` no difference we can see; exception (user): `s4_warm_ctl` 10.6 → 10.9 (+2.8%, 53/61), follow-up perf/warm-ctl-trade. Promises tagged 17 → 2; core mutation 85.33; 710 tests; validate 44 PASS. New rules: `tagged` ≤ 250 ns, `promises_tagged` = 2 ([budgets](docs/roadmap/core-v1/budgets.md)).
- **tracker/entry-root** — lead draft + Astra writer + Fable review (one fix round); tag `tracker/entry-root`; ADR 0078. `createApp` is gone. Pieces live beside their code: `issueServer` (routes.ts), `publish()` (publish.ts: the boot publish and the publish after commit, merged), `draftTags` (draft.ts). `main.ts` exports `runServer(env, stop)`, the one full root; `if (import.meta.main)` starts it, so a test imports the entry and starts nothing. The server is first in every list, so the port opens after the saved list is published (on main a tab could get `[]` first). Every root awaits close after a failed `ready`. New tests: the order test (fails with the server listed last or `publish()` missing) and a real-root test on a free port. Tracker tests 72, browser 7, validate 44 PASS, hono mutation 88.03. Core feedback row: a rejected `ready` settles before its close.
- **jev/entry-rules** — Astra writer + Fable review (one fix round); tag `jev/entry-rules`; ADR 0078. Two plain rules. S27 unguardedEntry: a top-level `await`, `for await`, or `await using` outside `if (import.meta.main)`; tests, `.tsx`, and `client/` are skipped. S28 returnedRoot: a function that returns a scope it made with `createScope`, alone or in an object; a factory handed to an owner (a call or `new` argument, a JSX attribute) does not count. Repo lint today: S27 on 7 entry lines (tracker server and tools, blueprint, four example lines), S28 on the tracker's `createApp` and the `boot()` in `examples/sync/hono.ts`. Jev tests 135, writer-trial tests 60.
- **bench/probe-warmup** — Opus writer + Fable review; tag `bench/probe-warmup`. mitata chose batch or one-call timing per process from the first call's time (≤ 500 µs), so main ran one-call and branches a mix. The probe now times every scenario in batch mode by construction (10,000 warm-up calls, then mitata's public `measure()` with both warm-up limits lifted; METRIC says `mode=`), and `ab.sh` runs ONE probe (B's) against both trees' builds and fails on a one-call run. Re-baseline main vs main (18 scenarios): all "no difference we can see". `fb35497` vs main in batch mode: `tagged` −57.0%, `session` −51.5%. Older tables are not comparable ([budgets](docs/roadmap/core-v1/budgets.md)).
- **perf/warm-read** — Astra writer + Fable review; tag `perf/warm-read`. A default resource controller reads a built resource from its saved record again: one map lookup on a warm hit, not two (t31 had added the second through `resourceSlot`). Named controllers keep the full path. benchd N=61 vs `337978e`: `warm` 26.4 → 18.0 ns (−31.8%, faster 61/61, "B faster"), below t27's 20.0; `op`, `run`, `session`, `tagged`, `lifecycle`, `cold` "no difference we can see". Re-check on `210e3af` after perf/create-presets (vs `dc40d00`): `warm` 26.4 → 18.0 ns "B faster" (61/61); `create` 183.9 → 183.9 ns and `tagged` 2132 → 2130 ns "no difference we can see". Behavior: the reviewer's probe (release, failed rebuild, async pending and settled, owner and caller close, namespace buckets) logs identically on main and the branch. Gates: GATE=0 (core 636 tests), promises 17, core mutation 85.60, `pnpm validate` 44 PASS.
- **perf/create-presets** — Astra writer + Fable review; tag `perf/create-presets`. Empty presets return before any loop; the loop moved to `applyPresets`. Preset setup 266 → 76 bytecode bytes and inlines into `createScope` again; no array iterator in optimized create. benchd N=61 vs `337978e`: `create` 205.5 → 184.1 ns (−10.4%, slower 0/61, "B faster"); `op`, `run`, `session`, `tagged`, `lifecycle`, `cold` "no difference we can see". Behavior: 15 preset shapes give identical output on main and the branch. Gates: GATE=0 (core 636 tests), promises 17, core mutation 85.81, `pnpm validate` 44 PASS.
- **perf/cost-timeline** — where the call path's cost went since `core/t27`: 13 steps across the milestone tags, one probe (main's) for all trees, N=31 per step through `benchd` ([budgets](docs/roadmap/core-v1/budgets.md), "Where the cost went since t27"). Timing only; nothing fixed.
  - `op`/`run`: op-parity's FAIL is a probe artifact. Same `op` lines in both probes; with one probe t27 100.9 → main 101.8, steps sum −2.0 ns.
  - `warm`: t31 (deps as values) +9.7 ns, +48.5%, 31/31; steps sum +7.2 vs op-parity +6.6.
  - `create`: http/t07 (`readMany`, Standard Schema, `Tag.Bindings`) +29.0 ns, +17.2%, 31/31; namespaces +8.7; extensions −8.2; sum +31.7 vs +29.2.
  - `tagged`: namespaces +77, named resources +126, tagged-promises −132; sum +366 vs +207 (eight noisy +1.5–3.3% steps); end to end 1943 → 2176 (+12.0%).
  - Fixes in progress elsewhere: perf/warm-read, perf/create-presets. Raw CSVs in `/home/paseo/next/tinkered-cost-timeline-csv/`.
- **perf/op-parity** — the call-path budget re-checked through `benchd`, N=61, each tree's own probe: main `13e09c8` vs `core/t24` `bdc2971` and vs `core/t27` `2e1f261` ([budgets](docs/roadmap/core-v1/budgets.md), "Call paths through benchd"). Timing only; nothing fixed.
  - vs t24: `op` 79.0 → 101.0 (+27.9%, 61/61) B slower; `run` 88.7 → 113.2 (+27.6%, 61/61) B slower; `create` +21.2% B slower; `warm` 20.0 → 26.5 (+32.5%) B slower; `cold` +1.2% and `lifecycle` +1.2%: no difference we can see.
  - vs t27: `op` +12.6% and `run` +11.3% B slower; `session` 1584 → 1681 (+6.1%, 58/61) B slower; `tagged` 1942 → 2149 (+10.7%, 60/61) B slower; `create` +16.5% and `warm` +33.0% B slower; `inline`, `cold`, `lifecycle`: no difference we can see.
  - Rules: `op` ≤ t24 + 2 FAIL (101.0 > 81.0); `run` ≤ t24 + 2 FAIL (113.2 > 90.7); `inline` ≤ run + ~90 PASS (194.0 ≤ 203.1); `tagged` ≤ 2000 FAIL (2149). Raw CSVs in `/home/paseo/next/tinkered-op-parity-csv/`.
- **harness/fixtures-throw, apps/ambient-scope** — the harness test fixture `parsePrompt` no longer hand-throws (census S05 passes in harness), and the README examples take `input: z.string()`; harness 72 tests, validate 44 PASS; apps are out of `check-ambient`'s scope by decision (ADR 0062 As built): their raw reads are process edges and a benchmark's stopwatch.
  - Gate EXIT 0; harness 72 tests; census harness OK.
- **docs/tsdoc follow-ups** — opus high + fable review; tags `census/tsdoc-text`, `process/drop-load`, `harness/ts-expect-error`, `core/ts-expect-error`, `jev/preflight-big-file`, `tools/check-ambient`. The census's S11/S14 skip TSDoc text (a fix round kept template strings honest); the unused `Process.Load` is gone; the two `@ts-expect-error` rows in harness and one in core became `expectTypeOf` checks (census S12 at 0 in both); Jev's preflight and review skip a file too big for one call instead of crashing; `check-ambient` scans every package's `src` (5 → 42 files; it had never scanned core) and takes one `@ambientSource` tag per declaration instead of line marks.
  - Gate EXIT 0; validate 44 PASS; promises 17; jev tests 115; no mutation (no runtime code changed).
- **jev/doc-judge-reword** — fable review (no fix round); tag `jev/doc-judge-reword`. `docRestatesCode` was noisy on the cleanup's 392 labels (sep 7%, ordered 65%). An honest audit changed 1 wrong-claim label (a contradiction is not a restatement); three restatement-only wordings stayed noisy (best: sep 13%, ordered 68%; bar 30% / 90%), so it is retired per ADR 0054 — its 392 cases stay in `cases.jsonl`. `docs.mjs` runs the TSDoc parser (S26) only; review checks that a doc says what the code cannot.
  - Gate EXIT 0; jev tests 111; writer-trial tests 60; validate 44 PASS.
- **docs/tsdoc** — user, 2026-09-28 (rule 10 option B). Checker (tag `jev/tsdoc-check`): S26 runs the TSDoc parser; the Jev judge `docRestatesCode` asks if a doc only restates its code. Cleanup, 10 writers in two waves, each reviewed (tags `docs/tsdoc-<group>` for core, mcp+harness, hono+http, tinkerer, process+react, sync+drizzle, blueprint, issue-tracker, playground, examples): every stray `//` and `/* */` comment moved into TSDoc or deleted; every malformed doc fixed; roughly 300 restating docs deleted; about 25 docs that claimed what the code contradicts fixed (the "only throw site" claim was false in every package); two reviews restored a lost contract (core `buildResult`, ADR 0027). Census S10/S11 at 0 everywhere; S26 at 0.
  - Labels: 378 new docRestatesCode rows (284 in the last 8 landings); calibration: docRestatesCode noisy (true 335 med 75%, false 57 med 68%, sep 7%, ordered 65%; threshold 0.65), so its hits print as notes.
- **jev/s22-settle** — opus high + fable review (no fix round); tag `jev/s22-settle`. S22 also flags a `settle` whose Result a core handle drops (`void x.settle(…)`, or `x.settle(…)` / `await x.settle(…)` as a bare statement): `settle` recovers a panic, so an unread Result hides it (ADR 0067). A handle is a name the file ties to one (a unit body's parameters, a `.session` callback's parameter, a controller/scope/session type, a `createScope`/`createSession`/`useScope` const); drizzle's `started.settle`, sync's `waiting.settle`, core's `held.settle`, and mcp's returned `s.settle` do not hit. `void x.run()` stays allowed (the scope tracks the run), now a line in the coding-convention skill. S21 rows unchanged.
  - Gate EXIT 0; jev tests 107 pass (2 new fail on main); writer-trial tests 60; validate 44 PASS.
- **tracker/wire-rebuild** — opus high + fable review (no fix round); tag `tracker/wire-rebuild`. The tab's live list rebuilt from first principles: the keys ride the stream URL (`GET /sync?keys=issues`; bad keys → 400 before any stream) and the browser's own `EventSource` reconnect does the retrying (`retry: 1000`; each reconnect is a fresh GET and a fresh snapshot). Gone: the `POST /sync` channel, the `viewers` inbox, the client id, the gate, the replay, the hand-written backoff (diff +314 / −657; the wire resource 125 → 62 lines). Boot with the server down shows "Connecting…" and goes live when it starts (user's pick); the dead page only when the browser gives up before the first snapshot.
  - Gate EXIT 0; tracker 69 tests; browser proof 4 of 4 uncached; validate 44 PASS; 7 Jev labels, calibration refreshed.
- **tracker/server-ops** — opus high + fable review (no fix round); tag `tracker/server-ops`. `loadSaved`, `writeIssue`, and `recordActivity` became operations on `store.tx` (best-practices rule 4), run as subflows in the request's one transaction; `selectAllIssues` was exactly `listIssues`, which `publishIssues` now depends on. Pure value functions stay functions. A missing issue's error now names `loadSaved` as its origin; a test presets `recordActivity` alone. Review probes: a failed activity write rolls the whole edit back; HTTP answers (404, 409, 400) unchanged.
  - Gate EXIT 0; tracker 78 tests (2 new); browser proof 2 of 2 uncached; validate 44 PASS; 4 Jev labels, calibration refreshed.
- **sync/transport-unit** — opus high + fable review (one fix round); tag `sync/transport-unit`; closes ADR 0070's open question. `subscribe(link, wiring)` takes its transport from a resource and resolves it inside the scope; sync does not reconnect (the link does). The tracker's `wire` resource is the transport, so nothing is built before `createScope` (`memoryPair`, `wirePeer`, `linkWire` gone). Fixed on the way: a close while `start` awaited its transport hung `ready`; now it rejects `SyncNotReady` and parts the wire.
  - Gate EXIT 0; sync 52 tests (4 new), tracker 76; sync mutation 86.49; browser proof 4 of 4 uncached; validate 44 PASS; 3 Jev labels, calibration refreshed.
- **tracker/gate-leftovers** — opus high + fable review (no fix round); tag `tracker/gate-leftovers`. Saved issue, comment, and activity ids come from `ctx.random` (a seeded scope replays them); `checkCapability` reads its check through `settle` (a managed error shows failed, a panic shows failed and is rethrown); the two boot resources leave their runs to the scope (`void op.run()`: core tracks the run, and a fire-and-forget `settle` would recover a panic); two unreachable notices removed; `fail()` builds without a cast. The tracker's writer gate: 12 blocking at first review → 3, each a labeled Jev wrong hit.
  - Gate EXIT 0; tracker 76 tests; browser proof 3 of 3 uncached; validate 44 PASS; 4 Jev labels, calibration refreshed.
- **tracker/reconnect** — opus high + fable review (four fix rounds, one lander stop); tag `tracker/reconnect`; ADR 0070's application case. The tab wire is one `wire` resource: it owns the current `EventSource` (id from `ctx.random`), is the only writer of the `connection` health, and rewires itself — after a drop it waits on `ctx.clock` (1 s doubling to a 30 s cap, reset on live) and opens again until live or close; the `reconnect` operation only bumps the `retry` intent cell, which opens at once. Only the first stream's failure is final (the dead page). Sync holds a steady `memoryPair` end. Gone: the hand-rolled state machine, `onStatus`, the `liveness` bridge, `reopen`, `Math.random`, the POST queue.
  - Gate EXIT 0; tracker 71 tests; browser proof 4 of 4 uncached; validate 44 PASS; 14 Jev labels, calibration refreshed. First lander stop: the proof passed 1 of 4 when a failed rewire gave up.
- **jev/plain-rules** — opus high + fable review (one fix round); tag `jev/plain-rules`. Six plain rules for hand-rolled tinker features: S20 raw random → `ctx.random`, S21 raw clock in a unit body → `ctx.clock`, S22 a dropped run → `settle`, S23 a hand-made `onX` on a listener set → a cell, S24 raw `fetch` in app code → an http endpoint, S25 component state → a cell (writer gate). Repo lint over apps and examples finds exactly the survey's 11 hand-rolled cases, none of its fine ones. S18 counts `family`, not `extension` (drivers build extensions in a function by design). `lint.mjs` on a folder reads only `.ts`/`.tsx`.
  - Gate EXIT 0; jev tests 104 pass; writer-trial tests 60 pass; validate 44 PASS.
- **tracker/gate-fixes** — opus high + fable review (no fix round); tag `tracker/gate-fixes`. Seven gate findings fixed in `apps/issue-tracker`: a bad `PORT` (`abc`, `80x`, `70000`) now fails boot with `BadPort` (it silently became 4311 or 80); a draft `prompt` that is not text answers 400 `BadDraftInput` (it silently became `""`); `applyDraft` works on plain values; two casts became checks; a test imports the public entry; `ScopeProvider` renders in `main.tsx`. Gate: 12 blocking → 6, each left a labeled wrong hit or waiting on `jev/s18-kinds`.
  - Gate EXIT 0; tracker 55 tests (4 new fail on main); validate 44 PASS; 9 Jev labels, calibration refreshed.
- **review/tracker-gate** — opus high + fable review (no fix round); tag `review/tracker-gate`. `node tools/writer-trial/app-gate.mjs <folder>` runs the writer-trial gate (ADR 0068) over any folder's `src/` and `tests/` with the live Jev calibration: exit 0 nothing blocks, 1 blocks, 2 unavailable (never a pass). One rule, one place: `review.mjs check` and `app-gate.mjs` share `judgeFile` (`tools/writer-trial/folder.mjs`) and `gate.mjs`; trials keep their frozen copy. Jev hits now carry their unit's line. First run on `apps/issue-tracker`: 12 blocking (8 plain, 4 proven Jev), 29 advice, 0 unavailable — [report](docs/roadmap/issue-tracker-review/2026-09-27-gate.md).
  - Gate EXIT 0; writer-trial tests 60 pass; validate 44 PASS.
- **core/with-data** — opus high + fable review (one fix round); tag `core/with-data`; ADR 0069. `close({ withData: true })` moves the session's own data into the close `Result` as `data` (`data.get(cell, { ns })` → `Presence`, every ending); off by default. Core frees a session's data only after its `session` hooks return, so a hook reads cells and tags through its handle after `next()`; writes and resource reads there still throw. A kept store is stripped to cells so a held `Result` does not pin the layer (review fix). The tracker's publish hook now reads the request method after `next()`.
  - Gate EXIT 0; core 636 tests, tracker 51; core mutation 85.75; promises 17; validate 44 PASS; slot headroom 6; timing N=61 through benchd: lifecycle +1.81% (42/61), every other scenario within 1%; 7 Jev labels, calibration refreshed.
- **core/cancel-reason** — opus high + fable review (one fix round) + one speed fix round; tag `core/cancel-reason`. A forced close's cancel reason is a `CancelReason` that reads like the web's `AbortError`: `name` `"AbortError"`, `String(reason)` and `util.inspect` read `AbortError: The scope closed before this work finished.` No stack (it is minted on every forced close), one instance per close so origin stamps stay apart, the brand an own field so a foreign `AbortError` still settles `failed`. An mcp tool call cut short now answers that text instead of `[object Object]`. Speed: with the brand as a prototype getter, lifecycle was +2.5% (49/61) though nothing read it; as an own field it is within 1%.
  - Gate EXIT 0; core 629 tests; core mutation 86.25; promises 17; validate 44 PASS; slot headroom 6; timing N=61 through benchd: lifecycle +0.17% (37/61) (confirming run), writer's run session +0.00% (27/61), tagged +1.18% (34/61); calibration refreshed.
- **sync/source-stop** — opus high + fable review (no fix round); tag `sync/source-stop`. A closing `source` now stops its published set (as `subscribe` does) and drops each watch, so a new family member after close no longer throws `Disposed`. Also fixed: a start that failed with `SyncConflict` left an earlier family row's listener attached; `readPublished` attaches family listeners only after every row registers (shared with `subscribe`). Three new tests fail on main with `Disposed`.
  - Gate EXIT 0; sync 48 tests; sync mutation 88.24; validate 44 PASS; 2 Jev labels, calibration refreshed.
- **drivers/t08** — opus high + fable review; tags `drivers/t08a`, `drivers/t08b`. Units have no `meta`: the harness takes `expose` rows like mcp (t08a), then core drops `meta`, `Tag.Handle.read`, `Tag.Metaed`, `metaFind`; mcp drops the `tool` tag, `readTool`, `ToolUndeclared`, and its dead `isError`; drizzle and harness drop the pass-through (t08b). ADR 0023 superseded; 0046 and 0048 marked superseded in part. 13 meta-only tests deleted, one type test and three mcp seam tests added.
  - t08b: Gate EXIT 0; core 625 tests; mutation core 86.22, mcp 98.51, drizzle 93.22, harness 85.29; promises 17; validate 44 PASS; slot headroom 6; timing N=61 through benchd vs f2edf9e: inline 204.7 → 193.3 ns (−5.57%, B slower 0/61); every other scenario within 1%; 5 Jev labels, calibration refreshed. First landing stopped at mcp mutation 83.56; one fix round.
- **drivers/t08a** — opus high + fable review (no fix round); tag `drivers/t08a`. The harness takes `expose` rows, the same `Mcp.Row` mcp takes; nothing reads unit `meta` any more (mcp's `readTool` is left with its own tests only; t08b removes it). A bare op or a row without its facts is a type error (the runtime `ToolUndeclared` path is gone). issue-tracker shares `listTool` / `getTool` rows between its mcp server and its triage harness; examples/harness moved to rows.
  - Gate EXIT 0; harness 72 tests, issue-tracker 51; harness mutation 85.29; validate 44 PASS; 2 Jev labels, calibration refreshed.
- **ext/start-order** — opus high + fable review (one fix round); tag `ext/start-order`. A server started before the extension that reads it now fails with a label that names it: `mcp:<name>` (the wiring's MCP name) and `hono:<name>` (new optional `HonoScope.Wiring.name`; no name keeps `hono`). Core README: a `start` can read, after `await next()`, only extensions listed after it. mcp and hono READMEs show the working order. The new tests fail on main (`Expected "mcp:admin" Received "mcp"`).
  - Gate EXIT 0; mcp 17 tests, hono 62 tests; mutation mcp 85.54, hono 88.03; validate 44 PASS; no Jev labels.
- **core/slot-guard** — opus high + fable review (no fix round); tag `core/slot-guard`. A deterministic `pnpm validate` lane, `scripts/check-slots.mjs`: it counts the context slots V8 gives core's built `dist/index.mjs` (from slot 3; imports, exports, and names used only at top level take none; file order) and fails when a name before the release block (anchor: the dist name the source map ties to `function invalidateResource`) sits past slot 255. Matches `--print-bytecode` slot for slot (272 names, 3–274). Headroom 5 names. It fails on 6 added names (slot 256) and on a renamed anchor.
  - Gate EXIT 0; validate 44 PASS; promises 17; no mutation (comment-only core change).
- **tests/busy-host-flake** — opus high + fable review (no fix round); tag `tests/busy-host-flake`. Under load only core's two "warm read … O(1) in chain depth" wall-clock tests failed (18 loaded runs); they move to `bench/warm-read.mjs`, a timing lane run through benchd (fastest of 15 rounds; it fails on a broken read cache: ~1900 ns vs ~250 ns limit). The unnamed validate failure was a cut-off name: `scripts/validate.mjs` now prints every `FAIL` line. Two tinkerer timeouts widen (100→1000 ms, 200→2000 ms); every other wall-clock check was read and kept with a reason.
  - Gate EXIT 0; load proof 5 of 5 EXIT 0 inside one queue job (3 spinners on its core); mutation core 86.34, tinkerer 96.01; promises 17; validate 43 PASS; warm-read lane exit 0.
- **harness/approve-real-sdk** — opus high + fable review (one fix round); tag `harness/approve-real-sdk`. The real SDK (0.3.275) catches a throwing `canUseTool` and goes on, so the README promise "a throwing approve op rejects the turn" held only against the fake. Now a failed approval saves its error, aborts that turn's own controller (not the thread), answers the SDK `deny` (every later approval too), and the turn rejects with the approve error; a forced close still settles `cancelled`. The fake gained a `real` mode that copies the SDK's catch-and-continue.
  - Gate EXIT 0; harness 72 tests (4 fail on main in `real` mode); harness mutation 85.29; validate 43 PASS; 6 Jev labels, calibration refreshed.
- **repo/lint-staged-no-stash** — opus high + fable review (no fix round); tag `repo/lint-staged-no-stash`. The commit hook runs `vp staged --no-stash`, so it never writes the one stash list all worktrees share, and it refuses a partly staged file (without the backup, a failed task drops that file's unstaged lines to `.git/lint-staged_unstaged.patch`). Proofs in a throwaway clone: 2 worktrees × 5 rounds at once, 10 of 10 land with only their own files, 0 stash writes (old hook: 2 per commit).
  - Gate: vp check EXIT 0; prose 0 hits.
- **errors/settle-types** — opus high + fable review (no fix round); tag `errors/settle-types`. `Scope.Settled<T>` gives `RunResult | Promise<RunResult>` when `T` is `unknown` or `any`, and a generic `T` assigns to that union with no cast; known sync, async, and tagged types are unchanged; types only. mcp, harness, tinkerer drop `await Promise.resolve(…settle…)`; hono's Result cast is gone (its call-argument cast stays: core-feedback row).
  - Gate EXIT 0; core 638 tests (3 new type tests); mutation core 86.34, mcp 85.54, harness 86.34, tinkerer 96.01, hono 87.34; promises 17; validate 43 PASS; 1 Jev label, calibration refreshed.
- **perf/session-slots** — tag `perf/session-slots`. The release/invalidation block moved to the end of index.ts (a pure move) so hot paths read no module slot above 255: wide slot reads on the hot path 18 → 0, store-write path 3 → 0; `runSessionWith` 304 → 284 bytecode bytes. No scenario got slower. Gates: GATE=0 (core 635 tests), promises 17, core mutation 86.34 alone, `pnpm validate` 43 PASS.
  - Timing through benchd, N=61, vs `5ccfcc0`: session +1.1% (42/61 slower), lifecycle −1.0% (23/61), tagged +0.7% (33/61), op −0.1% (19/61), run −0.4% (20/61).
  - Timing through benchd, N=61, vs `836a656`: session +0.9% (36/61 slower), lifecycle +0.6% (33/61), tagged +0.0% (32/61), op −0.1% (22/61), run +0.5% (39/61).
- **perf/session-creep** — opus high + fable review; tag `perf/session-creep`. Smaller session-path functions (`failureOf` 142 → 29 bytecode bytes by an indexed read; `runSessionWith` calls `settleSessionEnded`) and two tests (the first of two caught panics wins; a caught panic beats a later failed build). No measurable time change: session +1.3% vs `5ccfcc0` both before and after (N=61, host load ~3), −0.1% vs main — under the 2% bar, within this host's ~1% noise. Found: a module-slot cliff (over 255 top-level names widens bytecode), noted in perf memory.
  - Gate EXIT 0; core 635 tests; mutation core 86.38; promises 17; validate 43 PASS.
  - Timing N=61: session vs `5ccfcc0` +2.0% (41/61 slower, load ~7), rerun +1.3% (43/61, load ~3); vs `origin/main` −0.1% (26/61).
- **writers/dev-server** — `npm run dev` and any `vite.config.ts` failed in trials: Vite writes `node_modules/.vite*`, and `node_modules` is read-only. Image `tinker-writer-trial:20260925.1` (same core/react builds, vite 8.3.1) links both to `/tmp`; recipe in `prepare.mjs`; readiness check "vite cache folders writable" (fails on 20260925, passes on .1; 9/9 on a fresh trial). The host had deleted every unused trial image; a keeper container and a saved copy now hold it. All canaries re-pinned and green.
- **errors/t03** — opus high + fable review (one fix round); tag `errors/t03`. A panic is sticky: it fails the layer it ran in even if caught; `settle` is the only recover; a run's managed error never fails a layer (a resource build's still does). Closes the interim gap for panics. The ADR 0067 rollout is complete.
  - Gate EXIT 0; core 633 tests, sync 45, hono 61; mutation core 86.40, sync 87.46, hono 87.34; promises 17; validate 43 PASS.
  - Timing N=61 vs `origin/main`: op +0.2% (31/61 slower), opres +0.1% (35), run +0.5% (33), inline −0.8% (23), session +2.3% (44), tagged +1.0% (35), lifecycle +1.2% (38), asyncsub −2.8% (14). None over both bars.
- **writers/gym-live** — sixth unseen task (gym class waitlist), checkers proven on 5 layouts first (16 planted bugs caught, gate proof exit 0). gym-01: DeepSeek passed on its first try, 43/43, 16.6 min, 2 `inputDefaultMasks` blocks fixed by the writer; no checker broke. [Results](docs/roadmap/writer-trial/GYM-LIVE.md). Trial cleaned up.
- **errors/t02** — all six packages recover through `settle` (hono, mcp, process, tinkerer, harness,
  http); tags `errors/t02-<pkg>`. Along the way: core fix errors/t01b (`settle` reports what `run` would
  do), cards errors/settle-types, errors/raise-types, harness/approve-real-sdk.
- **errors/t02-process** — opus high + fable review (one fix round); tag `errors/t02-process`. A command's exit code comes through `settle`: success → its value (a server that returns on the signal keeps its code), cancelled → 130, failed → print and 1; a root force-closed from inside now exits 130 and prints nothing (main printed `{}` and exited 1).
  - Gate EXIT 0; process 48 tests (4 new), blueprint 112, tinkerer 89, issue-tracker 51; process mutation 96.10; validate 43 PASS.
  - 1 Jev label; `calibration.json` refreshed for `stateOutsideCell` only (the full run passed 9 min).
- **errors/t02-http** — opus high + fable review (two rounds); tag `errors/t02-http`. Retry takes each try through `settle`; a backend failure is a managed `RequestFailed`/`Transport` raised in the attempt and is the only thing retried; a panic passes through after one call; a response delivered after a forced close is returned (as on main); five public-seam tests for margin.
  - Gate EXIT 0; http 83 tests (10 new), tinkerer 89, issue-tracker 51; http mutation 89.62; validate 43 PASS; no Jev labels added.
- **errors/t02-hono** — opus high + fable review (no fix round); tag `errors/t02-hono`. A route takes its operation through `settle`: `onError` first for any failure, the default map for managed kinds, an unanswered panic rethrown unchanged; responses and log lines match main in 16 cases.
  - Gate EXIT 0; hono 61 tests (3 new), sync 45, issue-tracker 51; hono mutation 87.34; validate 43 PASS; no Jev labels added.
- **errors/t01b** — opus high + fable review (no fix round); tag `errors/t01b`. `settle` reports what `run` would do: a value returned under a forced close is `success` (POSIX: the exit code the program returned wins); a cancel reason on an aborted scope is `cancelled`; anything else `failed`. Found by errors/t02-process.
  - Gate EXIT 0; core 619 tests; promises_tagged 17; core mutation 86.14; validate 43 PASS; no Jev labels added.
  - Speed vs origin/main, N=61: op +0.0% (27/61 slower), run +0.0% (28/61), session +0.5% (33/61).
- **errors/t02-harness** — opus high + fable review (no fix round); tag `errors/t02-harness`. A Claude tool call goes through `settle`, so a tool failure the SDK reports to the model is received (not sticky under t03); `origin` stays the tool (tested).
  - Gate EXIT 0; harness 66 tests (4 new), tracker 51; harness mutation 86.34; validate 43 PASS.
  - 4 Jev labels; `calibration.json` refreshed.
- **errors/t02-tinkerer** — opus high + fable review (no fix round); tag `errors/t02-tinkerer`. A tool call's failure reaches the model through `settle` (byte-identical results to main); `EditMiss` and `StreamEnded` raised via `ctx.raise`.
  - Gate EXIT 0; tinkerer 89 tests; tinkerer mutation 96.01; validate 43 PASS; 1 Jev label, calibration committed.
- **errors/t02-mcp** — opus high + fable review (one fix round); tag `errors/t02-mcp`. A tool call recovers through `settle`: the client's answer is unchanged, the call's session now closes success; a throwing `respond` logs one ok line (pinned by a test).
  - Gate EXIT 0; mcp 16 tests, harness 62, issue-tracker 51; mcp mutation 85.54; validate 43 PASS; no Jev labels added.
- **errors/t01** — astra xhigh then opus high + fable review (two fix rounds); tag `errors/t01`. No cooked promise (the subclass is gone; runs return native promises); `settle` returns a Result; `originOf(error)` and origin stamps (sync and async); `ctx.raise(kind, payload)`; a failed close carries `origin`. asyncsub 809 ns (+9.1% vs pre-0066).
  - Gate EXIT 0; promises_tagged 17; core mutation 86.18; validate 43 PASS; no Jev labels added.
  - Speed vs origin/main, N=61: session +1.5% (44/61 slower), lifecycle −0.6% (27/61), inline +0.0% (30/61), run −1.3% (11/61).
  - Speed from the first run (before the inlining fix): op −0.2% (27/61), opres +0.8% (36/61), tagged +1.2% (34/61).
- **writers/checker-layouts** — every teacher checker passes 5 valid layouts of its reference app (layout kit: labels, table names, row buttons, row headers, column order, alert, page part order). 8 apps (booking new), all canaries and 5 gate proofs exit 0; 4 checker bugs fixed (plan, stock by-position rows; booking positional two-roots fallback, undo form text). [Results](docs/roadmap/writer-trial/LAYOUTS.md).
- **writers/grow** — five-round growing booking app, DeepSeek only: all five rounds accepted, 43/43 at the end, 1458 lines, 56 min, one repair. Every round-stopping failure was teacher-side: two checker bugs, a wrong `useId` rule, and an `inputDefaultMasks` false block (reworded). [Results](docs/roadmap/writer-trial/GROW.md). Trial cleaned up.
- **writers/no-wrapper** — writer material teaches ADR 0060: units at module level, helpers over plain values (S18/S19 block in writer mode), image 20260925 on current core/react, seven reference apps rewritten (14 → 0 hits), near-bar median in the gate. cinema-02: DeepSeek followed both rules unaided, 41/41. [Results](docs/roadmap/writer-trial/NO-WRAPPER.md).
- **jev/titleVague-reword** — answered by retirement (ADR 0054 rule 1). The writer-trial
  branch reworded `titleVague` once on 120 labeled tests: still noisy (sep 19, ordered 68%), so it
  is retired; main's 2026-09-25 calibration agreed (sep 8%, ordered 57%). All labels stay in
  `cases.jsonl`. [HARDEN](docs/roadmap/writer-trial/HARDEN.md).
- **core/ext-hooks-every-layer** — sol 6 + opus review (one fix round); tag `core/ext-hooks-every-layer`. Extension `run`/`write` hooks wrap every run and write at every layer (sessions, tagged runs, subflows, inline runs, dependency writes); 72 lines of root-handle wrappers removed; no-hook path unchanged. Review fix: an async hook on a dropped failing subflow no longer escapes as an unhandled rejection.
  - Gate EXIT 0; promises_tagged 17; core mutation 85.83; validate 43 PASS; speed from the writer's N=61 run (tagged +2.1% in 40/61, inline +1.1%); Jev calibrate owed (gateway 402).
- **bridge gaps (ADR 0060)** — done 2026-09-25: core/ext-hooks-every-layer landed; ADR 0060 no longer promises a process bridge.
- **perf/async-subflow** — stopped, not landed (user 2026-09-25: no cooked promise, ever). It cut
  the subclass cost 28% (asyncsub 1807 → 1298 ns, 61/61 pairs); errors/t01 removes the subclass
  instead. Its `asyncsub` probe (commit `354914f`, branch `perf/async-subflow`) is reused there.
- **mcp/two-servers** — deepseek + opus review (one fix round); tag `mcp/two-servers`. Two mcp extensions on one scope: shared scope data, one session per call, one close stops both (each server's `isConnected()` false after), the same tool name answers from the server that got the call (ADR 0060). Found: a serving extension must be listed before the server it resolves; card ext/start-order.
  - Gate EXIT 0; mcp mutation 85.29; validate 43 PASS; Jev calibrate owed (service 503).
- **process/positionals** — deepseek + opus review (one fix round); tag `process/positionals`. `positionals(argv, { values })` in `@tinker/process`: plain words in order; value flags take the next word; `--k=v` is one word; `--` ends flags. blueprint `verify` and tinkerer `ask` use it; fixes `ask --json hello` dropping `hello` (test fails on main).
  - Gate EXIT 0; validate 43 PASS. Jev calibrate owed (service 503).
  - Mutation alone: process 95.90, blueprint 88.31, tinkerer 96.28.
- **hono/two-servers** — deepseek + opus review (one fix round); tag `hono/two-servers`. Two hono extensions on one scope: shared scope data, separate per-request sessions, the same path answers from the server that got the request, one close stops both once (ADR 0060). No bug found.
  - Gate EXIT 0; hono mutation 86.88; validate 43 PASS. Calibrate owed: the Jev gateway answered 503 five times; the next landing that adds labels runs it.
- **tinkerer/v1** and **process/v1** — both tracks finished (tinkerer t01–t06; process t01–t05); stale
  Doing rows closed 2026-09-24. Since then: tinkerer onto namespaces (namespace-v1/t07), `askCommand`
  deleted (nw/tinkerer-ask), mutation 96.12 (mut/tinkerer-85); the argv helper is card
  process/positionals.
- **core/caught-subflow** — sol 6 + opus review (five fix rounds, then a mutation lift); tag `core/caught-subflow`. ADR 0066: a subflow failure belongs to whoever receives it; an unreceived one fails the layer; an async subflow returns a promise that tracks receipt.
  - Gate EXIT 0; tagged promises 17; validate 43 PASS.
  - Mutation alone: core 85.60, http 85.05.
  - N=61 vs main: op -5.3% (0/61 slower), opres -4.1% (1/61), run -3.9% (1/61), inline -1.1% (14/61), session +0.3% (37/61), tagged -0.5% (28/61), lifecycle +0.1% (29/61).
  - Async op awaiting one async subflow, 200,000 runs, median of 7: main 1122.8 ns, branch 2184.4 ns (+1061.6 ns, +94.5%). No bar; reported.
- **mutation/floor-85** — every package's lane ≥ 85 (user, 2026-09-24): harness 86.32, hono 86.88, sync 87.38, process 95.51, tinkerer 96.12, blueprint 86.48; already ≥ 85: mcp 85.29, http 85.05, drizzle 96.61, utils 100, core, react.
- **mut/blueprint-85** — sol 6 + opus review (one fix round); tag `mut/blueprint-85`. Blueprint mutation 79.47 → 86.48 alone; public-seam tests for data writers, verify edges, bad YAML, evals, explain, suggest; tests on YAML parse issues check what our code owns, not the library's error code.
- **mut/tinkerer-85** — deepseek + opus review (one fix round); tag `mut/tinkerer-85`. Tinkerer mutation 81.74 → 96.12 alone; 31 public-seam tests (steer and queue, tool rows and gates, persist, bash, log lines, frame labels); one unreachable `calls` field on the steered branch removed (the loop never read it).
- **mut/process-85** — deepseek + opus review (one fix round); tag `mut/process-85`. Process mutation 82.69 → 95.51 alone: public-seam tests for help order (and equal names), partial io writers, graceful close, signal wiring, an unknown error, and `MissingTag` naming process tags outside `run`.
- **mut/sync-85** — sol 6 + opus review (two fix rounds); tag `mut/sync-85`. Sync mutation 80.13 → 87.38 alone: 12 public-seam tests (malformed keys, registration rules, wrong-direction messages, a failed snapshot send, viewer close parts the source wire, a closed viewer sends nothing later).
- **mut/hono-85** — sol 6 + opus review (one fix round); tag `mut/hono-85`. Hono mutation 80.09 → 86.88 alone: public-seam tests for PUT/PATCH/DELETE rows, a rejected body read, a closer object, byte chunks, a stream namespace, null input; the scope-close tests now check the whole result.
- **mut/harness-85** — sol 6 + opus review (one fix round); tag `mut/harness-85`. Harness mutation 76.30 → 86.32 alone: tests at the public seam for raw approval parsing and for unset Codex options staying out of SDK calls; every claimed mutant `[Killed]`.
- **jev/wrapper-checks** — sol 6 + opus review (two fix rounds); tag `jev/wrapper-checks`. Jev reports a wrapper before its fix: a plain-code check `unitCouldBeModuleLevel` (ADR 0057; 13 extractor tests, now in the gate) and a judge `wrapsCallersStep` (ADR 0058), now noisy after its false cases were labeled (prints `~`, advisory). It found every audit site first; five fix cards followed. Gate EXIT 0; no mutation lane (tools/jev); validate 43 PASS; calibrate: `wrapsCallersStep` noisy, sep 45%, ordered 85% (17 true, 12 false); no other judge changed status.
- **nw/docs** — deepseek + opus review (one fix round); tag `nw/docs`. Glossary, best-practices, and the mcp/harness/blueprint/tracker/examples READMEs name today's shapes; ADR 0060 accepted with an As built line; ADR 0057 records `askCommand`'s deletion. Retired-name grep in living docs: only RETIRED lines and history remain. Gate EXIT 0; no mutation lane (docs); validate 43 PASS.
- **nw/hono-stream** — sol 6 + opus review (one fix round); tag `nw/hono-stream`. `stream(c, op, call?)` runs a declared operation; the body reads `emit` from a tag and runs in its own child session (TSDoc + README say so); the trace names the body by its label. Tracker `draftBody` is its own operation with real depends. Jev hit gone. Gate EXIT 0; mutation 80.09 alone; validate 43 PASS.
- **nw/tracker-commands** — deepseek + opus review; tag `nw/tracker-commands`. The five CLI command operations declared once at module level (ADR 0057); Jev hits 10 → 0; `serveMcp` removes its watch and listener in `ctx.defer` (a cleanup no test can see: the process exits right after). Gate EXIT 0; no mutation lane (app); validate 43 PASS.
- **nw/tinkerer-ask** — deepseek + opus review (two fix rounds); tag `nw/tinkerer-ask`. `askCommand` deleted (ADR 0058: a frame never builds the author's operation); the test and README declare the ask operation on `@tinker/process`; `@tinker/process` is a dev dependency only. Jev hit gone. Gate EXIT 0; mutation 81.74 alone; validate 43 PASS.
- **nw/blueprint-shell** — deepseek + opus review; tag `nw/blueprint-shell`. The five CLI command operations declared once at module level (ADR 0057); Jev hits 10 → 0; CLI output unchanged. Adapter labels are named constants so the golden pair's `verify` skips them (comment + README say why).
- **nw/examples** — deepseek + opus review; tag `nw/examples`. Every unit in 9 examples declared at module level (ADR 0057); Jev `unitCouldBeModuleLevel` hits 14 → 0; deterministic tours byte-identical; lazy routes still load once.

- **perf/create-creep** — sol 6 + opus review; tag `perf/create-creep`. `create` crept up
  at four core landings. Two causes:
  - each scope built its own `releaseNs` closure; now `release` and `releaseNs` share one
    function.
  - every build did the named-link work; now only named builds do.
    Gate green (core 534 tests); core mutation 85.46 alone; `pnpm validate` 43/43 PASS;
    tagged promises 17. N=61, vs tag `namespace-v1/t02b-1`:
  - create -0.4%.
  - cold -2.2%.
    N=61, vs main `c400cf5`:
  - op -0.1%.
  - opres +0.4%.
  - lifecycle -2.5%.
- **core/release-cell-ns** — sol 6 + opus review; tag `core/release-cell-ns`. `release(cell)`
  now clears the cell's namespace entries at that layer (ADR 0063). It also stops releasing
  resources built on a CHILD's own entry, which main did.
  Gate green (core 533 tests); core mutation 85.47 alone; `pnpm validate` 43/43 PASS;
  tagged promises 17. N=61 vs main `0a97d28`: op +0.0%, opres +0.4%, lifecycle -0.5%,
  create +1.6% (35/61).
- **core/ns-watch-child** — sol 6 + opus review; tag `core/ns-watch-child`. Named writes and
  `releaseNs` wake namespace watchers on child layers, unless the child shadows the value.
  Gate green (core 528 tests); core mutation 85.36 alone; `pnpm validate` 43/43 PASS;
  tagged promises 17. N=61 vs main `2bab231`: op +0.0%, opres +0.6%, lifecycle -0.1%,
  create +2.5% (41/61). Review found two old behaviors, the same on main (core-feedback row,
  first asker).
- **core/ns-watch-index** — sol 6 + opus review; tag `core/ns-watch-index`. Named writes and
  `releaseNs` wake only watchers indexed under the changed key. Gate green (core 522 tests);
  core mutation 85.33 alone; `pnpm validate` 43/43 PASS; tagged promises 17.
  N=61 vs main `2584f21`: op -0.1%, opres +0.6%, lifecycle -0.6%, create +1.4% (34/61).
  Review found two old gaps, not from this branch (core-feedback row, first asker): a named write
  on the root does not wake a named watcher on a child session; `release(cell)` does not wake
  named watchers. Family probe (one cell, one namespace per watcher, median of 5), ns per write:
  - 100 watchers: 7779 → 1730.
  - 10,000 watchers: 430405 → 2409.
- **core/tagged-promises** — sol 6 + opus review; tag `core/tagged-promises`. Close skips the empty
  `closeInstances` call; a tagged run is back to 17 promises. Rebased over obs-clock and rechecked:
  gate green; core mutation 85.25 alone; `pnpm validate` 43/43 PASS.
  N=61 vs main `06b2b65`: lifecycle -0.0%, create +1.6% (34/61), run -0.2%, op +0.1%.
- **clock-v1/obs-clock** — lead (Claude), `57bb9df`. Span and log times read the scope's clock
  unless `observe.clock` is set (ADR 0034 follow-up done). Two new tests fail on main, pass here;
  core 518 tests; `vp check` 0 errors; core mutation alone 86.75. `pnpm validate`: only the
  `promises` lane fails, 19 on main too (the `core/tagged-promises` card).
- **tests/core-tag-read-split** — deepseek + opus review (one fix round); tag `tests/core-tag-read-split`.
  Two mixed `tag.read` tests became six one-cause tests, one README line each; the review restored
  the lost "skips another tag's binding" check. Core 515 tests.
- **docs/simplify-workflows** — Claude; `CLAUDE.md` 155 → 109 lines.
  ADR 0065: an impact block only across packages; a Jev label is the note.
  Proof: `vp check` green; `vp run prose` clean.

- **validate/red-lanes** — lead, direct (three stale checks). http's bundle check looked for the retired
  `httpClient`, process's for the retired `command`; the cast check matched "as JSON" in two example
  comments. `pnpm validate`: only the tagged promise count stays red (core/tagged-promises).
- **graph/t01 core step log line** — sol 6 + opus review; tag `graph/t01`. Core writes one line per
  observed operation; six hand-derived `ms` gone (hono, mcp, harness, sync). op +0.1%; mutation
  85.28. Proof: [graph-v1 landed](docs/roadmap/graph-v1/PROGRESS.md).
- **jev/unit-note** — deepseek flash + opus review (one fix round); tag `jev/unit-note`. The
  unit-kind note prints `ℹ`, never `⚠`; the brief, CLAUDE.md, and the coding skill say it owes no
  line or label. Gate green (1064 tests).
- **namespace-v1/t02b-2 `releaseNs` verb** — sol 6, lead review + N=61 bench; tag `namespace-v1/t02b-2`.
  Exact named links; closed sessions unlink (fixes a t02a leak); mutation 85.11; create +2.0%.
  The namespace track is complete. Proof: [namespace-v1 landed](docs/roadmap/namespace-v1/PROGRESS.md).
- **namespace-v1/t02b-1 one release protocol** — sol 6, lead review + N=61 bench; tag `namespace-v1/t02b-1`.
  Operation paths 5–13% faster; lifecycle/cold/create within noise; mutation 85.08. ADR 0063 accepted.

- **namespace-v1/t04 docs + ADR 0059 accepted** — sol 6, lead review; tag `namespace-v1/t04`.
  Namespace track built and documented except `releaseNs` (t02b, needs `bench`).
  Proof: [namespace-v1 status](docs/roadmap/namespace-v1/PROGRESS.md).

- **namespace-v1/t09 hono request namespace** — sol 6, lead review; tag `namespace-v1/t09`.
  `ns` hook on the per-request session; route = graph, session = lifetime, namespace = identity.
  Proof: [namespace-v1 landed](docs/roadmap/namespace-v1/PROGRESS.md).

- **namespace-v1/t05 drizzle onto ns** — sol 6, lead review; tag `namespace-v1/t05`.
  `target` default `"scope"`, opt-in `"namespace"` per tenant. Mutation 98.31.
  Proof: [namespace-v1 landed](docs/roadmap/namespace-v1/PROGRESS.md).

- **namespace-v1/t02c `namespace` resource target** — sol 6, lead review; tag `namespace-v1/t02c`.
  core 434 tests, mutation 85.50; lead probes confirmed no session or call tag reaches a tenant pool.

- **namespace-v1/t06, t07, t08 — sync, tinkerer, harness onto namespaces** — sol 6 writers, lead review;
  tags `namespace-v1/t06`, `t07`, `t08`. One frame, many instances by namespace; the A-to-B relay
  (ADR 0059's motivating case) proven in harness. Mutation 78.93 / 85.46 / 76.39.
  Proof: [namespace-v1 landed](docs/roadmap/namespace-v1/PROGRESS.md).

- **namespace-v1/t03 ns edges** — sol 6, lead review; tag `namespace-v1/t03`.
  Tests only; every edge already held. core 428 tests, mutation 85.40.
  Proof: [namespace-v1 landed](docs/roadmap/namespace-v1/PROGRESS.md).

- **namespace-v1/t02a ns resource build** — sol writers, lead review; tag `namespace-v1/t02a`.
  core 424 tests, mutation 85.30. Lead probe caught a fallback-contamination bug; fixed.
  Proof: [namespace-v1 landed](docs/roadmap/namespace-v1/PROGRESS.md).

- **docs/skills-prose** — Claude; plain words in all 7 skills.
  Stale paths fixed: `docs/decisions/`, `docs/glossary.md`, `TODO.md`.
  Proof: `vp check` green; prose lint 0 hits, 0 wide lines.

- **namespace-v1/t01 ns values** — sol + lead; tag `namespace-v1/t01`.
  core 418 tests, mutation 85.74; four astra xhigh rounds cleared every P1.
  Proof: [namespace-v1 landed](docs/roadmap/namespace-v1/PROGRESS.md).

- **graph/v1 t02–t06** — writers + lead; tags `graph/t02`…`graph/t06`.
  `check-graph` is a validate lane, 0 violations. t01 parked (bench).
  Proof: [graph-v1 landed](docs/roadmap/graph-v1/PROGRESS.md).

- **http/t07 + hono/ext** — muse writers, astra judged; tags `http/t07`, `hono/ext`.
  httpClient is declared units; hono is an extension the scope owns (ADR 0060).

- **playground/benchmark-batches** — Codex; shipped `917d950`.
  59 tests pass; live benchmark completes with results.
  Proof: [benchmark record](docs/roadmap/playground-v2/PROGRESS.md#benchmark-short-samples).

- **playground/reset-button** — Codex; shipped `478cfff`.
  Live phone reset and reload pass; image healthy.
  Proof: [reset record](docs/roadmap/playground-v2/PROGRESS.md#reset-demo-button).

- **playground/release** — Codex; released 2026-09-22.
  Main pushed; release `playground-2026.09.22` published.
  Live image healthy; desktop and phone checks pass.
  Proof: [release record](docs/roadmap/playground-v2/PROGRESS.md#playground-release).

- **playground/motion-polish** — complete: ocean theme,
  one motion clock, eased waves and turns, less layout work.
  56 tests pass; desktop and phone review pass.
  [Proof](docs/roadmap/playground-v2/PROGRESS.md#motion-follow-up-proof).

- **playground/tsunami** — complete: 3D waves, controls,
  full screen, source browsing, and scope tests.
  [Final proof](docs/roadmap/playground-v2/PROGRESS.md#final-proof).
- **playground/frames** — complete: frame tag and 12 engine
  tests without a browser; all 53 playground tests pass.
- **playground/source-links** — complete: real core/React
  links, file search, cursor history, and browser proof.
- **playground/page** — complete: one mounted game across
  views; native full screen and fit fallback both checked.
- **playground/visuals** — complete: solid tiles, wave lift,
  four turns, live controls, and phone frame scan pass.
- **writers/cinema-live** — fifth live gate trial (cinema seat map, `cinema-01`), DeepSeek only: accepted first try in 8 min, 41/41, gate pass, 0 blocks, no payload miss. [Results](docs/roadmap/writer-trial/CINEMA-LIVE.md). Trial cleaned up.
- **writers/input-rule** — two writer rules (read and check `ctx.rawInput`; exact payload types), checked against core first; fourth trial (parcel locker): DeepSeek, MiMo Flash, MiMo Pro accepted first try, 50/50, no payload miss (was 2 repairs per trial). GLM not scored (gateway credit), then dropped. `noOpRejected` reworded (creates/removes), bar 0.66. [Results](docs/roadmap/writer-trial/LOCKER-LIVE.md). Writers: DeepSeek v4.1 Flash only from 2026-09-25 (cost).
- **writers/kitchen-live** — third live gate trial (kitchen queue, `kitchen-01`): all four accepted; DeepSeek and MiMo Flash first try, GLM and MiMo Pro one repair each (non-text id in a string payload). 6 blocks, 5 real, 1 false (`cancelTicket`; `noOpRejected` bar 0.6 → 0.7). Image rebuilt and proven equal (f324d3e). [Results](docs/roadmap/writer-trial/KITCHEN-LIVE.md). Trial cleaned up.
- **jev/arrow-units** — top-level `const x = () => …` and function-expression helpers in `.ts` are units (before: `.tsx` only), with `uses`.
  Proof: 106/106 tool tests (4 new); both gate proofs pass; eval 27/27; sweep over 20 accepted apps: +23 units, 1 real catch (stock-01 DeepSeek `readId` → `""`), 0 false blocks.
- **jev/caller-context** — a helper function unit carries `uses` (its same-file calling lines); `inputDefaultMasks` judges the value at those lines. ballot-01 `idText` 0.84 → 0.36; loans-01 `idField` stays a hit.
  Proof: 102/102 tool tests (4 new extract tests); 34 caller-aware cases added; `inputDefaultMasks` proven, 32/61, sep 57, ordered 99%. A 0.8 bar caught more but blocked 5 clean units in 20 accepted apps, so 0.85 stays. Eval 27/27 twice (one earlier run 26/27: a noisy case). Cross-file callers are not seen yet.
- **writers/cast-rule** — plain rule S17 blocks a type assertion in writer source (except `as const` and `[] as T[]`); writer mode only, the repo's own lint is unchanged (~100 plain casts in packages).
  Proof: 98/98 tool tests (broker path blocks a planted cast); sweep over 20 accepted apps in 5 domains: 0 false blocks after exempting `[] as T[]`; GLM ballot-01 attempt 1 blocks on `value as string`. Not covered: widening a type to `unknown` without a cast (MiMo Pro). [Notes](docs/roadmap/writer-trial/BALLOT-LIVE.md#what-this-run-found).
- **writers/ballot-live** — second live gate trial (team poll, `ballot-01`): all four accepted. DeepSeek and MiMo Flash first try; GLM and MiMo Pro one repair each (same payload-type miss). 6 blocks, all `inputDefaultMasks`; the teacher gate now reuses the writer's answers for unchanged bytes (6db1985). [Results](docs/roadmap/writer-trial/BALLOT-LIVE.md). Trial cleaned up.
- **writers/gate-howto** — every blocking gate item carries a `fix` line: each Jev judge has one in the bank; a plain rule uses its message. The writer rules say: clear it that way, keep every task rule, report a conflict.
  Proof: 87/87 tool tests (two new: judge fix line and plain-rule fix reach `gate.blocking`). `inputDefaultMasks` fix names the MiMo Pro trap (keep payload types). Takes effect for trials frozen after this commit.
- **writers/gate-census** — the gate runs the style-census rules as parser-based plain code (`tools/jev/plain.mjs`; T01–T08, S02, S05, S06, S12, S13); every row blocks in the writer loop.
  Proof: 85/85 tool tests; planted `expect(isError(…))` blocks; sweep over 12 accepted apps in 3 domains: 0 false blocks, 1 real miss found; T04 no longer flags `../src/index`. [Results](docs/roadmap/writer-trial/GATE-LIVE.md#what-the-gate-missed-or-caused).
- **writers/gate-live** — first live trial with the Jev gate (tool library, `loans-01`): all four accepted.
  GLM and MiMo Flash first try; DeepSeek and MiMo Pro one repair each. The gate raised 9 blocking findings during writing; 2 teacher bugs fixed (34c25b2, a5b3d26). [Results](docs/roadmap/writer-trial/GATE-LIVE.md). Trial cleaned up.
- **writers/harden** — Jev questions hardened on trial code; the writer loop blocks on trusted findings.
  Proof: 835 blind labels + 5 seeded; `calibrate.mjs`: `inputDefaultMasks`, `noOpRejected`, `domainLogicInRender` `proven`; `evals/lint.mjs` 27/27; `titleVague` retired; gate tests 63/63; `vp check` 0 errors. [Results](docs/roadmap/writer-trial/HARDEN.md), [ADR 0068](docs/decisions/0068-in-the-writer-loop-a-proven-jev-hit-and-a-plain-shape-finding-block-done.md).
- **writers/transfer-plan** — all four learning-plan apps accepted.
  Same 13 Jev questions and rules; two first passes, two one-repair passes.
  All final apps pass 43 teacher cases plus the separate no-op check.
  Own tests, builds, and source review pass. Every attempt is kept.
  All four worker projects and containers removed after export.
  [Results, evidence, and limits](docs/roadmap/writer-trial/PLAN.md).
- **writers/repeat** — all four stock apps accepted.
  MiMo Pro passed first try; the other three needed two repairs.
  Each passes 44 teacher checks plus two notice checks and source review.
  Frozen rules, saved attempts, and the review loop are in place.
  New writable-view check: 48 tooling tests pass; repo check has no errors.
  All worker projects removed; every saved result kept.
  [Results and limits](docs/roadmap/writer-trial/REPEAT.md#final-call).
- **writers/learn** — all four pass repair and fresh work.
  Source review, 29 repair checks, 43 fresh checks, own tests/builds pass.
  Trial projects and workspaces are removed; every saved attempt is kept.
  Repo check: 0 errors; report prose check passes.
  [Results and cleanup](docs/roadmap/writer-trial/LEARNING.md#final-call).
- **writers/review** — owner: Codex.
  Jev comparison and source review saved; four new checks per writer.
  Seven failed cases found, plus state-rule gaps in all four apps.
  No app edits; probe containers removed.
  Proof: [code review](docs/roadmap/writer-trial/CODE-REVIEW.md).
- **writers/trial** — owner: Codex.
  All four final apps pass core, browser, type, test, and build checks.
  Saved five stages per writer, including capped attempts.
  Temporary projects and workspaces removed; cleanup checked.
  Proof: [results](docs/roadmap/writer-trial/REPORT.md).
- **writers/prep** — model routes, shell, Jev, browser,
  limits, file access, and cleanup checks passed.
  Four task packets and private teacher checks reviewed.
  The isolated teacher runner rejects an empty app.
  No scored rounds started.
  Proof: [readiness](docs/roadmap/writer-trial/readiness.json)
  and [review](docs/roadmap/writer-trial/PROGRESS.md).

- **random-v1/t03 — docs + ambient-read lint**
  Evidence: core README `### Random` (5 promise lines), glossary `random` + `TestRandom` rows, ADR 0062 → accepted, `scripts/check-ambient.mjs` + `pnpm validate` lane (package src/examples read time+random off ctx; only `systemClock`/`systemRandom` lines marked `ambient-source`). `vp check`/`vp run core#test` EXIT 0; `node scripts/check-ambient.mjs` exit 0 (negative test exit 1); `vp run prose` clean. [track](docs/roadmap/random-v1/PROGRESS.md)

- **random-v1/t01+t02 — ambient `random` capability + seeded `makeTestRandom` (ADR 0062, mirrors clock)**
  Evidence: branch `random-v1/t01` (contributor `ce3b0e5`/`b6178c5` + lead docs): `Random.Handle{next,uuid}`, `systemRandom` default, `Scope.Options.random`, session inheritance, `makeTestRandom({ seed })` (mulberry32; uuid from same stream). `vp run -r build`/`vp check` (0 errors)/`vp run core#test` EXIT 0, 392 tests (7 new); core mutation alone **86.30** ≥ 85 (8 min); validate: core lanes green (3 http/process FAILs pre-existing on base `c3a33ba`); Jev preflight blocked by provider 503 (advisory). [track](docs/roadmap/random-v1/PROGRESS.md)

- **tests/kill-check-in-brief — per-line kill check is the writer's proof**
  Evidence: brief updated (`docs/roadmap/contributor-brief.md` Setup); `vp run prose` 0 hits

- **jev/banks-registry — one `BANKS` registry + `judgeOf`**
  Evidence: `tools/jev/bank.mjs`; `label.mjs`, `calibrate.mjs`, `evals/lint.mjs` look a judge up there; `label nope` lists every bank; `calibrate --dry` unchanged (survivorMatters proven); eval 25/25; `vp check` 0 errors / 20 warnings

- **mutation/react-85 — react mutation lane, floor 85**
  Evidence: lane `a652a28` (Stryker over vitest browser mode, concurrency 2), floor `887ee5e`; lane alone **93.16** (202 killed, 43 timeout, 18 survived) from 79.47; 21 seam tests (contributor ac75e60, per-line kill checks: 34 rows killed, 17 equivalent, 1 timeout, 2 already dead); `packages/react/README.md` gains `## Promises`; `promises.mjs react` 0/69 gaps; `vp check` 0 errors / 20 warnings; 69 react tests

- **blueprint/integrity — `blueprint verify`: a node is the unit whose `label` matches; five plain checks; `body` templates ask Jev (ADR 0055)**
  Evidence: t06 + t07 landed 2026-09-21 (tags `blueprint/t06`, `t07`): 81 tests, 16216 B gzip, mutation 77.17 alone, validate 41/41; the binary verifies itself (`ok: 12 nodes, 12 units, 0 findings`); real `verify --key-file`: 8 `~` lines, exit 0; `bodyStraysFromWork` grades `noisy` (golden 7/12) — [track](docs/roadmap/blueprint-v1/PROGRESS.md#v11-complete-2026-09-21)

- **jev/review-0921 — calibration over all 147 cases; four noisy judges + `plan-check.mjs` + impact's Jev verdict retired; `helperAlone` reworded then retired (still noisy on its 30 cases); `titleVague` added; `proven` needs 5 cases a side (ADR 0054)**
  Evidence: `calibration.json` committed from a full run; `node tools/jev/tests.mjs blueprint` 12/62 `titleVague`; full `calibrate.mjs`: 1 proven (`survivorMatters`), 5 retired; `impact.mjs cli/t04` prints 3 discrepancies with no key; `vp check tools/jev` 0 errors

- **blueprint/v1 — `packages/blueprint`: a self-contained binary that judges a YAML blueprint of tinker units with Jev over question templates shipped in the package (ADR 0052)**
  Evidence: t01–t05 landed 2026-09-21 (tags `blueprint/t01`…`t05`): 62 tests, 11823 B gzip, mutation 77.22 alone, validate 41/41; real runs: `suggest` resource 96% / data 92%, `check` on the example 5 `~` lines exit 0; ADR 0052 §5 amended after the first real run; [track](docs/roadmap/blueprint-v1/PROGRESS.md#v1-complete-2026-09-21)

- **fix/fast-close-secondary — an idle scope's close reports an operation cleanup that threw**
  Evidence: `87aebcb`: `canFastClose` also requires `layer.secondary` empty; seam test fails on main (`teardownErrors` undefined), passes with the fix; README promise line; core lane alone **86.08** (break 85, exit 0); `vp check` 0 errors / 20 warnings; 385 core tests; lifecycle probe A/B min-of-3 938 → 943 ns (noise)

- **mutation/core-85 — core mutation floor 75 → 85**
  Evidence: `packages/core/stryker.config.json` `break: 85`; lane alone on the landed branch: **86.19** (exit 0; 1399 killed, 18 timeout, 212 survived, 15 never covered) from 78.64; 92 seam tests in 8 new files, one README promise line each; contributor d88056a, three batches (78.64 → 83.00 → 84.59 → 86.07); batch 3 used per-line kill checks (`npx stryker run --mutate "src/index.ts:L-L"`) — the only proof; `vp check` 0 errors / 20 warnings; 384 core tests; Jev: 1 pair flag explained, promise gaps only pre-existing titles

- **tracker/preset-seam — client tests preset the endpoint node; `patchIssue` raises `IssueConflict` from the 409 once**
  Evidence: `vp check` 0 errors; tracker 46 tests + browser proof 7 passed; `tools.test.ts` ×2 fail on the old `api.ts`; `backend(` in app tests → 0; [track](docs/roadmap/issue-tracker-v1/PROGRESS.md#trackerpreset-seam--landed-2026-09-21)

- **jev/promises-fixes — short lines kept, exact match skips Jev, tie reads as unsure, `label.mjs --merge`**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `e83e520`; ~75 min, 0 fix rounds; each fix proven before/after on a copy (the short line itself had already been folded away on main); tie never reproduced live in ~1,200 picks, catch proven by a throwaway; real bank merges idempotently (121 cases)

- **tests/core-titles — vague core test titles renamed; one split**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `79b1f13`; ~25 min, 0 fix rounds; 14 titles now name the promise (no "still"/"as before"/internals), one two-promise title split; the vacuous assert was already fixed by the other session (`19acf3e`); 296 core tests; lane 78.27

- **examples/standard-schema — every example parser is a zod schema passed as-is**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: 10 files, +25/−124 lines; `vp check` 0 errors; `vp test examples/` 6/6; `vp run -r test` green; the cli/hono/http/mcp/drizzle tours run and print their expected lines; `main.ts greet ada` → `hello ada`

- **core/size-diet — core ships minified; size cap 30,720 → 15,360 B**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `packages/core/vite.config.ts` `minify: true` + `sourcemap: true`; `vp run core#size` 25,901 → 8,056 B gzip (comments were 15 kB of it); `vp check` 0 errors; `vp run -r build` and `vp run -r test` green on the minified dist; budgets doc updated

- **core/standard-schema — every `parse` slot takes a Standard Schema object (zod, valibot, arktype) as-is; `parse(parser, raw)` exported for drivers**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `core/standard-schema` worktree; 3 new core seam tests with zod (cell type inferred, op input output, async schema refused); `vp check` 0 errors; `vp run -r test` 12/12 packages green; core size 25.90 kB gzip; core mutation alone 78.45; `examples/harness/tools.ts` drops its wrapper

- **docs/core-promises — `## Promises` appendix in the core README**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `e663679`; 16 README-only commits, ~60 min, 0 fix rounds; `promises.mjs core` 148 → 6 confident gaps (15 unsure); 105 promise lines in 8 unit groups; 14 title clusters merged as one promise; 8 titles judged not-a-promise

- **tests/core-many-causes — core's flagged tests split, deleted, or explained**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `3e5473a` from `../tinkered-land`; 11 commits, ~65 min, 0 fix rounds; 273 → 287 tests each naming one cause; `tests.mjs core` 28 → 15 (all explained); 39 labels; core lane alone 78.27; type-level tests kept and given a runtime half

- **tracker/observe — errors logged, not dropped; `Observe.Config` seam, JSON lines to stdout**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `67530a9`; `vp check` 0 errors; tracker 47 tests (5 new; publish-after-commit fails without the fix: 500 → 201); build + browser proof 7 passed; real boot: `listening`, `http request`, failed span, `boot failed` on a taken port (exit 1); [track](docs/roadmap/issue-tracker-v1/PROGRESS.md#trackerobserve--landed-2026-09-21-925854a)

- **tests/floor-75-cleanup — the mutation lift's superficial tests deleted or merged**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `78a1c16` from `../tinkered-land`; 58 min, 0 fix rounds; http flags 22 → 5 explained, lane 85.13 alone; harness 6 → 5, lane 75.95 alone; 27 labels; [speed reading](docs/roadmap/jev-loop/PLAN.md#speed-reading-2026-09-21-three-cards)

- **docs/harness-promises — the README states every seam-test promise**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: six README-only commits; 18 min launch→report, 0 fix rounds; `promises.mjs harness` 20 → 0 confident gaps; feedback row on the four unwritten promises closed

- **jev/reword-noisy — three judges reworded until proven**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `b6bc124`; 13 min launch→report, 0 fix rounds; `runForwardsToClosure` sep 29→91, `effectWithoutDefer` 42→60, `handRolledLifetime` 4→79; 24/24 fixtures still pass

- **jev/ast-extraction + `@tinker/jev` package**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `94e91ab` (workspace package under `tools/jev`, `ai` out of the root, `oxc-parser` in), `5d29c21` (`extract.mjs`: units, tests with causes/asserts/narrows, helpers, imports, exports; slicers and test rules on it). Found on first run: the regex slicer had skipped every `resource` const; core has 270 tests, not 272

- **core/bindings — `Tag.Bindings`: `meta`/`tags` take a binding, nothing, or a nested list**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `vp check` 0 errors; 277 core tests (3 new: meta, scope/session tags, call tags) + every package lane green; size 25603 B / 30720; drizzle/harness/http/hono widened, hono spread gone; README Tags, glossary, ADR 0022/0023 amended

- **jev/scan-0921 — whole-codebase scan + plain-words docs**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: tests 566 → 74 flagged, promises 9 packages, lint 238 units → ~0 actionable; `tools/jev/README.md` + `explain.mjs`; 17 verdicts labeled; [notes](docs/roadmap/jev-loop/PLAN.md#whole-codebase-scan-2026-09-21-and-the-parser-decision)

- **jev/tests — test-quality tool in the workflow**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `tools/jev/tests.mjs`; four per-test judges + one pairwise, labelable and calibratable; trial http 24/48, harness 3/49 (two deterministic rules tightened); [plan](docs/roadmap/jev-loop/PLAN.md#test-quality-2026-09-21-scriptsjevtestsmjs-pkg--file)

- **jev/calibrate — calibration in the workflow + promise gap**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `label.mjs` / `calibrate.mjs` / `promises.mjs`; bank seeded (13 cases); `calibration.json` written (1 proven, 3 noisy, 9 provisional); harness promise gap 20/48; [plan](docs/roadmap/jev-loop/PLAN.md#calibration-and-the-promise-gap-are-in-the-workflow-2026-09-21)

- **perf/ab-0051 — big-sample A/B after the drivers track**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: [table](docs/roadmap/core-v1/budgets.md#big-sample-ab-after-the-drivers-track-2026-09-20): 10 scenarios × 31 runs per tree, alternating, pinned; every median within ±2% (session −1.0%); runner kept as `bench/ab.sh`; browser proof end-to-end exit 0 after the full rebuild

- **drivers/t04 — cli as an extension + cli lift**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `5f037fd`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst04-cli--landed-2026-09-20-5f037fd--driverst07--done-by-the-lead): cli 30 + mcp 9 + harness 48 + tracker 42, validate, cli mutation alone 79.77 (two src bugs fixed by survivors)

- **drivers/t07 — the two-hands gate + docs**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `scripts/two-hands.sh` as validate lane 38 (fails on a planted leak); best-practices rules 2/6, glossary; every mutation lane ≥ 75 measured alone

- **mutation/floor-75 — all four lanes**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: http 90.77, harness 76.05, sync 79.67 (t06), cli 79.77 (t04); every package ≥ 75

- **drivers/t05 — mcp as an extension with `expose` rows**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `20e7531`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst05-mcp--landed-2026-09-20-20e7531): mcp 9 + harness 24 + cli 25 + tracker 42, `mcpServer`/`tools`/`serveIssues` none, mcp mutation alone 82.86

- **fix/subflow-run + fix/watch-prev — the two core one-liners**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `3dbedb8`; `watch(next, prev)` + one test; the `.then` typing did not reproduce (drafter 14 → 8 lines); 274 core tests; probe no move; core mutation alone 77.96

- **drivers/t06 — sync wiring rows; `connect` returns `Result`**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `b3567ac`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst06--lead-landing-2026-09-20-b3567ac): 30 sync + 42 tracker + browser, `sync`/`synced` none, sync mutation alone 79.67, jev pre-flight clean

- **jev/react — component kind + five React rules + `view` in the guide**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `5df0fb9`; [eval 24/24, client run 28 judged / 3 notes](docs/roadmap/jev-loop/PLAN.md#react-the-component-kind--five-rules-2026-09-20); `vp check` 0 errors / 13 existing warnings

- **drivers/t03 (+t02) — hono as an extension; tracker publishAfterCommit**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `0d17653`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst03-t02--landed-2026-09-20-0d17653): 34 hono + 42 tracker + browser, old symbols none, hono mutation alone 77.66

- **jev/toolset — Jev guide + lint in the coding-stage workflow**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `118ecce`; `CLAUDE.md` contributor brief, coding-convention Check step, `preflight.mjs` runs the per-unit lint, untracked files included; proof: preflight over a real range in [the Jev plan](docs/roadmap/jev-loop/PLAN.md#where-it-hooks-advisory-scripts-in-scriptsjev)

- **jev/lint — Jev lint + primitive guide over the examples and the tracker**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `8515ad3`; [bank, evals 17/17, run 174 judged / 41 notes](docs/roadmap/jev-loop/PLAN.md#lint--guide--the-eslint-shaped-bank-2026-09-20-scriptsjevbankmjs); `vp check` 0 errors / 13 existing warnings; advisory only, no gate touched

- **drivers/t01 — core `session` hook + extension as a dependency**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `d8bea8c`, tag `core/t36`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst01--landed-2026-09-20-d8bea8c-tag-coret36): 273 core tests, probe no move, core mutation alone 77.96

- **fix/stream-null, fix/serial-tx, docs/form-cells — three reshape one-liners**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `6c96adc` (http mutation alone 70.51, pre-floor), `ac99002`, `239f158`; feedback rows marked done

- **tracker/reshape — Rebuild the tracker on data / resource / operation**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `a098dc3`; [four slices with gates](docs/roadmap/issue-tracker-v1/PROGRESS.md#reshapeclient-b--landed-2026-09-20-trackerreshape-done): 0 lint errors, 40 app tests + browser proof, validate 37/37, hono mutation 79.38; `useState`/`useEffect`/`useRef` in src → 0; server 992 → 802 lines, client 1169 → 1941 (named, headless-tested)

- **tracker/audit — Usage audit against `@tinker/*` best practices**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: [Audit](docs/roadmap/issue-tracker-v1/audit-2026-09-20.md) (52 rows, 40 confirmed in §8), [server review](docs/roadmap/issue-tracker-v1/server-review-2026-09-20.md) (14 findings), [best-practices.md](docs/best-practices.md) (17 rules), 5 core-feedback rows; `vp check` clean on all five docs

- **tracker/t05 — Finish and show the app**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: [Complete and pushed](docs/roadmap/issue-tracker-v1/PROGRESS.md#t05-complete--2026-09-19): tag ab4b0f8, 25 app tests + 7 helper tests + process/browser proof, 37 lanes, SCIP, verified public two-tab preview; writer cleaned up

- **tracker/t04 — Optional triage draft**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: Code `db4f674`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t04-complete--2026-09-19): 25 tests, all 37 lanes, read-only tool composition, cancel/discard/Post, shutdown/reopen, malformed-stream safety, and SCIP

- **tracker/t03 — CLI and issue tools**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: Code `3303f5a`; [final proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t03-complete--2026-09-19): 15 app tests, all 37 lanes, CLI/MCP live browser saves, stale-save safety, EOF/signal shutdown, and SCIP

- **tracker/t02 — Edit, assign, and discuss issues**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: Code `1be5dfc`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t02-complete--2026-09-19): 11 app tests, 37 fresh validation lanes, 48 React tests, stale-draft regression, two tabs, reload/restart, and clean shutdown

- **tracker/t01 — Create an issue and see it live**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: Code `3490295`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t01-complete--2026-09-19): 3 app tests, 401 library tests, 37 lanes, two tabs, reload/restart, startup-drop error, clean shutdown, and app SCIP

- **authoring/next — Choose and scope the issue tracker**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: User chose the app; [plan and five working slices](docs/roadmap/issue-tracker-v1/PROGRESS.md) recorded; public API anchors indexed; doc links and `vp check` passed

- **sync/v1 — Complete sync and confirm the pushed result**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: [All seven tickets done](docs/roadmap/sync-v1/PROGRESS.md#completion-check--2026-09-19); remote `sync/t07` = `3a6ae72`; fresh 28 tests and 37 validation lanes passed; recorded mutation 78.06%; optional bench work parked by user choice

- **docs/parked-review — Review all blockers and parked work**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: [Findings and next steps](docs/roadmap/blocked-and-parked-review.md); 313 tests passed, `vp check` 0 errors/13 existing warnings; links and lane states verified; one false core proposal closed; two deferred React cards restored

- **docs/kanban — Convert TODO to a Kanban board**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: All 383 old lines preserved in the [archive](docs/roadmap/archive/todo-2026-09-19.md); links and lane states verified; `vp check` 0 errors; [agent rules](CLAUDE.md#execution-workflow-kanban) updated

- **docs/core-feedback — Close stale notes and fill verified doc gaps**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: `d6682e8` + `6fcc659`; 332 tests passed, `vp check` 0 errors. [Feedback and doc links](docs/roadmap/core-feedback.md)

- **extensions/v1 — Ship all hooks and sync follow-up**
  `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json`: [Track complete](docs/roadmap/extensions-v1/PROGRESS.md); core/t35 mutation 78.56%, sync/t07 mutation 78.06%; all gates passed

Older shipped tracks, ticket notes, and measurements are kept in the [dated archive](docs/roadmap/archive/todo-2026-09-19.md).
