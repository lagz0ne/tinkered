# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.

## Now — authoring (first-class integrations, ADR 0034 tiers)

Perf pursuit is closed (see archive). Next: production-ready "tinkered-first" components on the reusable
operation/resource model — glue without side effects, testable without mocks, the scope as the single
configuration point. Start with `grill-with-docs` (ADRs in `docs/decisions/`, terms in `docs/glossary.md`).

First integration shipped: **httpClient** (ADR 0035, archived below). Second shipped: the **Hono driver**
(ADR 0039/0040, archived below). Later candidates: app entrypoint with graceful
shutdown; TUI app — each starts with `grill-with-docs`.

**Authoring queue (user-ordered, 2026-09-17).** Each starts with `grill-with-docs` (ADR + glossary), then
tickets, then contributors with lead review:

1. **Drizzle** — **shipped** (ADR 0041, tags `drizzle/t01`, `drizzle/t02`; archived below).
2. **CLI entrypoint** — **shipped** (ADR 0042, tags `cli/t01`, `cli/t02`, core/t29; archived below). Was: commands are tag
   bindings on the scope (`command(name, load, { input?, respond? })`, `command.entry` for a server command that
   receives the scope), lazy loaders (help loads nothing), the command run is an inline op (span + `cli command`
   log line), exit codes 0/1/2/130, `run()` testable without the process, `runMain()` = run + signals + exit.
   - [x] **cli/t01 — package + `command` tag/builders + `run` + `runMain`.** _Done: tag `cli/t01` (3d92fd3 + lead nits), 16 tests incl. one real-process smoke test, size 3087 B, 21 validate lanes green, lead review SHIP (3 internal-proof tests cut); core feedback recorded (`resolve(tag.all)` and a lazy op unit now each have a likely second asker in hono/t05)._ Verify: tests through `run({ scope,
 argv, io })` — a command loads only when selected (a loader counter; `help`/unknown load nothing and exit
         0/2 with usage listing the bound names); the op's parse failure → exit 2 with usage; a throwing op → exit 1 + stderr; a void op prints nothing; `respond` overrides; an entry command receives the scope and can
         `scope.resolve` a resource; with `observe` the command span `app migrate` parents the op span and one
         `cli command` log line carries `{ command, code, ms }`; a session-target resource's `defer` sees `success`
         on exit 0 and `failed` on exit 1; `run` with an `AbortSignal` in `io` (the signal stand-in for tests) →
         exit 130 and `cancelled`; `runMain` is covered by a smoke test that spawns `node` on the example (real
         process, real exit code — the one process-level test).
   - [x] **cli/t02 — validation milestone.** _Done: tag `cli/t02`; 25 validate lanes green (cli lanes added), mutation 68.94, README + cast-free examples (`basic.ts` tour, `main.ts` real entrypoint). core/t29 landed alongside: `scope.resolve(tag.all)`._
   - [x] **hono/t05 — routes at the scope, eager mount (ADR 0042 policy).** _Done: tag `hono/t05`, `routes` tag +
         `route.get/post/put/patch/delete` bindings, `honoApp(scope)` mounts every route eagerly (loaders run once at
         boot, a rejecting loader fails boot), 30 hono tests, size 3376 B, mutation 82.10, lead review SHIP. Core feedback: a lazy
         operation unit now has TWO askers (cli, hono) → core/t30 queued below._
   - [x] **core/t30 — a lazy operation unit: NOT NEEDED.** _Closed 2026-09-18 by the user's observation: laziness is a
         resource whose factory imports (`resource({ factory: () => import("./x.ts").then((m) => m.op) })`) — built once
         per owner, cached, presettable, with a span; `drizzleStore.open` already is one. Drivers do
         `scope.run(await scope.resolve(module), …)`. Follow-up (optional): cli/hono tables accept a
         `Resource.Handle<Operation.Handle>` beside a loader so the load is cached per scope and observable._

3. **Harnesses (Claude Code, Codex)** — **decided (ADR 0043)**: `@tinker/harness`, one frame generic over the
   adapter's own SDK types; adapters are resources whose factories import the SDK; the thread is a session
   resource; ambient state as data cells; a turn is an operation. Plan: `docs/roadmap/harness-v1/PROGRESS.md`.
   - [ ] **harness/t01 — package + frame + Claude Code adapter + ambient cells + `turn` op.** Verify: with
         `preset(claudeCode.resource, () => fake)` — a session's `turn` runs one turn; `status` idle→running→done;
         `text` streams deltas; `items` records a tool call; `usage` carries tokens + cost; `id` set; `events` raw
         and ordered; the result is the SDK's result; two turns reuse the thread; `x.resume(id)` reaches `start`;
         options merge nearest-first with `includePartialMessages` forced; forced close → interrupt + close, turn
         `cancelled`, status `failed`; `mapClaudeMessage` proven with recorded `SDKMessage` fixtures; span attr
         `adapter` + one `harness turn` log line. Contributor running.
   - [ ] **harness/t02 — Codex adapter.** Same frame; `codex.options` = the SDK's `CodexOptions & ThreadOptions`;
         `runStreamed` events → cells; recorded `ThreadEvent` fixtures.
   - [ ] **harness/t03 — approvals as operations.** `canUseTool` (Claude) / approval mode (Codex) answered by a
         subflow; the decision visible in `items`.
   - [ ] **harness/t04 — tools as operations.** An operation exposed in-process (Claude `tool()` +
         `createSdkMcpServer`; Codex MCP config) whose run is a subflow of the turn op.
   - [ ] **harness/t05 — validation milestone.** Size, mutation ≥ 60 alone, README + cast-free example, harness
         lanes in `pnpm validate`; archive here.
4. **`@tinker/ai`** — the LLM layer over the AI SDK (the model is the swappable slot; generateText/streamText as
   ops; tools as operations; `MockLanguageModelV4` as the test seam). Deferred until a driver asks.

Perf follow-up when the sandbox `bench` is available: `op` parity (budgets.md "Call paths (t27)").

## Shipped — archived

Both v1 milestones are complete. Full ticket detail, budgets, and reset recipes live in the
durable trackers (this list is just the pointer):

- **cli v1 (2026-09-18)** — complete: `@tinker/cli` — the entrypoint driver (ADR 0042): `runMain({ name,
version, scope })` creates and closes the scope; commands are tag bindings on it (`command(name, load, {
input?, respond? })`, `command.entry` for a server command that receives the scope); loaders are lazy
  (help loads nothing); the command runs as an inline op in a session (span + one `cli command` log line);
  exit codes 0/1/2/130; `run()` is the process-free seam. Gate: 25 validate lanes green (cli lanes added),
  size 3087 B, mutation 68.94, 16 tests incl. one real-process smoke test. **core/t29** (found by cli +
  hono/t05): `scope.resolve(tag.all | .optional | .required)` delivers the depends form — no more
  smuggling a table out through an inline op. Core feedback: a lazy operation unit (two askers now).

- **drizzle v1 (2026-09-18)** — complete: `@tinker/drizzle` — `drizzleStore({ label, open, close? })`: a
  required `config` tag, a scope-target `db` resource (`open` once with a logger bound to `ctx.log`, `close`
  by `defer`), a session-target `tx` resource that holds `db.transaction(cb)` open for the session and
  commits on `success` / rolls back on `failed`/`cancelled`/`released` (the session outcome, ADR 0028 paying
  off), one `db query` log line per statement with no params, PGlite as the real test database. Gate: 21
  validate lanes green (drizzle lanes added), size 1959 B, mutation 96.49, 8 seam tests. Core feedback
  recorded (savepoints need "inherit the parent session's instance"; a `defer` TSDoc note; build counts
  via spans). Detail: `docs/roadmap/drizzle-v1/PROGRESS.md`.

- **hono v1 (2026-09-17)** — complete: `@tinker/hono` as a session-level driver (ADR 0039, 0040; tags
  `hono/t01`…`hono/t04`): the entrypoint owns the scope, `tinker(scope, { tags?, onError? })` opens a session per
  request (graceful close = commit after the handler, forced = rollback on client abort), `handle(op, { input?,
respond? })` runs the request as an inline operation (span `GET /users/:id`, one `http request` log line, the
  route op as a nested subflow), error mapping inside the request (400 / 499 / 500 / rethrow), `stream(c, write)`
  keeps the session open until the body ends (the writer is an inline op), `request` tag, `NoSession`. Gate: 17
  validate lanes green (hono tests/size/cast-free/pure bundle added), size 2838 B, mutation 83.33, 24 seam tests
  through `app.request`, every ticket lead-reviewed (found: a forced close after a good request rolled resources
  back; a parse re-run hack → core/t28). core/t28: an operation's `parse` failure is `DataValidationFailed`.
  Census S09 skips import lines. Detail: `docs/roadmap/hono-v1/PROGRESS.md`.

- **http v1 (2026-09-17)** — complete: `@tinker/http` as a frame of core primitives (ADR 0035; tags
  `http/t01`…`http/t05`): shared `backend` tag (default `fetchBackend`), per-client `config` tag read
  per call and merged nearest-wins, session-target `client` resource with `execute(request, ctx)`,
  pure endpoint operations (`x.operation`), `filterStatus` slot + `filterStatus/filterStatusOk/
matchStatus`, one child span per attempt + one log line on transport failure, `retry` slot with a
  fixed transient policy and backoff on `ctx.clock`, `preset` as the test seam. Gate: 13 validate
  lanes green (`pnpm validate` now covers http tests/size/cast-free/pure bundle), size 6203 B of
  10240, mutation 69.87 (break 60), 27 seam tests, every ticket lead-reviewed. Detail:
  `docs/roadmap/http-v1/PROGRESS.md`.
- **verbs + inline + tagged calls (2026-09-17)** — core/t24 (`controller`/`resolve`/`run`, ADR 0036,
  mutation 78.57), core/t26 (inline `scope.run({ depends, run }, call?)`, ADR 0037; `tags` on a call
  open a child session, always async, ADR 0038; mutation 78.39; +9 ns on `op` recorded → core/t27),
  core/t27 (call-path floors, exact tagged promise census 17), core/t25 (tests speak the everyday verbs).

- **clock v1** — complete and shipped (t20–t23, tags `core/t20`…`core/t23`, ADR 0034): ambient `Clock`
  on every ctx, `makeTestClock` (now/advance/setTime), virtual + real `sleep` with signal abort, forced
  close cancels an in-flight sleep; validation milestone green (validate lanes, mutation 79.13%, cast-free
  README + example). Detail: `docs/roadmap/clock-v1/PROGRESS.md`.
- **perf batch (2026-09-16)** — ctx classes with prototype `signal`, shared obs/trap objects, one record
  lookup per build, lazy deps without a per-build Map (astra SHIP after 4 rounds); cold make+resolve
  3353 → ~715 ns, op run 532 → ~134 ns. Rules: coding-convention "Performance" + census P01–P04.
  Notes: `research/learnings/2026-09-16-core-vs-inferdi.md`.
- **react/store perf vs the field (2026-09-16)** — six-library bench (`bench/react-stores.mjs`,
  `bench/stores-probe.mjs`); tinker first on mount (535 µs) and update (69.5 µs) vs Zustand, Jotai,
  Legend v2/v3, Preact Signals. Landed: per-cell watchers, 3-hook `useData`, data controller record
  fast path, op run path trims (op 134→79 ns), always-valid effective entry (read 9.8→0.54 ns), one eq
  per layer per flush (1000-way fan-out 30→8.4 µs, Zustand 12). Gate 70c7924: validate PASS, mutation 78.52%.
  Notes: `research/learnings/2026-09-16-react-stores.md`.
- **react options (2026-09-16)** — `useResolve` in react-query mutation shape; `useData({ writable })`
  and `useResource({ suspense: false })` as options, not new hooks (ADR 0032 amended).
- **core v1** — complete: packaged scope, data (read/write/watch), operations, tags, sessions,
  structured close, sync/async resources + targets, outcome hooks + `session(fn)`, release +
  cascade, observation, presets, static meta (t01–t18); teardown/lifetime redesign lt1–lt4
  (`ctx.defer`/`ctx.signal`, reverse-registration LIFO, `close()` returns a `Result` and never
  throws, close is a shutdown MODE — ADRs 0024–0029); v1 validation gate green (t19).
  Detail: `docs/roadmap/core-v1/PROGRESS.md`; budgets `budgets.md`; teardown `teardown-redesign.md`.
- **react v1** — complete: `ScopeProvider`/`SessionProvider`, `useScope`, `useData` (+ selector),
  `useController`, `useResource`, `useResolve`, `useRelease`, `useSpans` (r01–r17, all
  astra-reviewed to SHIP; r16 span emission reverted post-v1). Detail:
  `docs/roadmap/react-v1/PROGRESS.md`.
