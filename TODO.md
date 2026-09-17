# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.

## Now — authoring (first-class integrations, ADR 0034 tiers)

Perf pursuit is closed (see archive). Next: production-ready "tinkered-first" components on the reusable
operation/resource model — glue without side effects, testable without mocks, the scope as the single
configuration point. Start with `grill-with-docs` (ADRs in `docs/decisions/`, terms in `docs/glossary.md`).

First integration picked: **httpClient** as a frame of core primitives (ADR 0035; detail + verify +
reset recipes in `docs/roadmap/http-v1/PROGRESS.md`). Tickets `http/t01`…`http/t05`, each gated,
each lead-reviewed to SHIP before the next.

- [x] **core/t24 — verb alignment (ADR 0036), lands BEFORE http/t01.** _Done: tag `core/t24`, gate green, mutation 78.57, lead review SHIP (3 nits fixed)._ `scope.controller(x)`,
      `scope.resolve(x)` (data/resource/tag snapshot; op = type error), `scope.run(op, call?)`,
      `OperationController.run`, `Operation.Handle`, drop `DataController.read`; React `useRun`
      (`run`/`runAsync`). Docs, README, examples, benches, tests move together. **Verify:** `vp check`
      0 errors, `vp run -r test` green, `pnpm validate` green, no `getController|\.read\(\)|useResolve|
CommandController|Operation\.Command` left in packages/ bench/ README docs (grep = 0); lead review SHIP.
- [ ] **core/t25 — tests speak the everyday verbs (SCIP-driven, optional, strike if unwanted).** SCIP shows
      core tests call `scope.controller(op).run()` 128× and `scope.run(op)` 3×; migrate operation calls
      to `scope.run(op, call)` and resource reads to `scope.resolve(res)` where the controller is not
      otherwise used. **Verify:** `scripts/scip.sh refs` shows `Handle#…:run()` ≫ `OperationController…:run()`
      in tests; `vp run core#test` green; no behaviour change.
- [x] **core/t26 — inline operation + tagged calls (ADR 0037 + 0038).** _Done: tag `core/t26`, gate green (285 tests, validate PASS), lead review SHIP after one fix round (dispatch frames + session WeakMap removed; tests merged; tagged overload first on the controller). Residual +9 ns `op` / +12 ns `run` in-container recorded in ADR 0038 → core/t27._ Second `run` overload:
      `scope.run({ label?, depends?, run }, { input?, tags? }?)` → throwaway handle through the
      operation path (span `label ?? "inline"`, full ctx, owned work, deps in natural form, presets
      on deps apply), no cache/residue; probe scenario `inline` beside `op`. `tags` on ANY call
      (declared, inline, subflow) = a child session for that run; the shallow `TagOverlay` is
      removed. **Verify:** seam tests — deps + input delivered (`ctx.input === row`), no-arg form when
      void; span named and nested; forced close cancels an in-flight inline; a preset on a dep is
      seen; a tagged call's tag is seen by a subflow AND by a session-target resource built in the
      flow, not by a scope-target resource; the flow's session closes when the run settles (its
      session resource's `defer` runs with the run's outcome); untagged calls take the old path
      (probe `op`/`run` unchanged). `vp check` 0, `vp run -r test`, `pnpm validate` green; SCIP refs
      for `Scope/Handle#…:run()` before/after; lead review SHIP.
- [ ] **core/t27 — performance protection for the new call paths (later, after t26 lands).** The
      new shapes (tagged call = session per call, inline = handle per call) get their own guard
      rails, separate from the feature work: probe scenarios `inline`, `tagged`, `tagged_sync` in
      `bench/core-probe.mjs` with recorded floors in `docs/roadmap/core-v1/budgets.md`; a
      `promises` lane count for a tagged call (ADR 0016 style: N promises per tagged call, fixed);
      heap lane covers a tagged call; `op`/`run`/`warm` floors unchanged. **Verify:** `pnpm validate`
      has the new lanes green; `bench` sandbox numbers recorded in budgets.md; a regression on any
      floor fails the gate.
- [x] **http/t01 — package + frame + execute.** _Done: tag `http/t01` (b31ad3f), gate green, size 4312 B, lead review SHIP (3 should-fix + nits taken; client resource is session-target). Mutation 43.35 — below the t05 break line (60): 102 uncovered mutants in the unexercised request builders and the fetch body builder; t02 must lift it (SCIP map: `head/put/patch/del/options/modify/appendUrl/setHeader/setUrlParams/bodyBytes/bodyFormData/bodyUrlParams` have no test reference)._ `packages/http` scaffold (10 kB cap, errors registry,
      gate via `scripts/ticket.sh` with a package arg); `httpClient({ label })` → `config` tag,
      `client` resource; shared `backend` tag with `fetchBackend`; `HttpRequest.*` constructors +
      bodies; `HttpResponse.fromWeb/make`; `execute(request, ctx)` merges baseUrl/headers and
      forwards `ctx.signal`. **Verify:** seam test — an operation depending on `github.client`
      executes a GET through a closure backend bound on the tag; the backend sees the merged URL +
      headers; the body reads back; `InvalidUrl` when no baseUrl and a relative path. Gate green.
- [ ] **http/t02 — endpoint operations + preset seam + cancel.** `x.operation({...})` typed input
      (`parse`), `response` reader (`res.json(parse)`), raw response by default; `filterStatusOk`
      → `ResponseFailed/StatusCode`; `preset(x.client, …)` and `preset(endpoint, …)` swap;
      forced close aborts an in-flight request and the run settles `cancelled`. **Verify:** tests
      for each; gate green.
- [ ] **http/t03 — observation + logging.** A child span `http GET <url>` under the endpoint span
      with method/url/status attributes, failed on error, one `log` line on failure. **Verify:**
      `scope.spans()` + `observe.log` assertions; observation off costs nothing (no spans). Gate.
- [ ] **http/t04 — retry.** Frame slot `retry: { times, delay? }`, transient policy, backoff via
      `ctx.clock.sleep` under a `TestClock`; abort stops retrying; 404 never retries. **Verify:**
      deterministic tests with `makeTestClock`; gate green.
- [ ] **http/t05 — validation milestone.** Size ≤ 10 kB gzip, mutation ≥ 60, README + cast-free
      `packages/http/examples/basic.ts`, pure universal bundle (no `node:` imports), lead review SHIP.
      **Verify:** `vp run http#size`, `vp run http#mutate` isolated, `vp check`; archive here.

## Shipped — archived

Both v1 milestones are complete. Full ticket detail, budgets, and reset recipes live in the
durable trackers (this list is just the pointer):

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
