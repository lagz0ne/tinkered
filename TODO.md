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

- **perf/op-parity** — Compare operation call cost. The runner it waited for is here: `bench/queued.sh`
  sends `bench/ab.sh` through `benchd`, this box's benchmark queue, so one job runs at a time on one
  core with no network and no secrets. Next: pin the baseline and current SHAs, build the baseline
  tree, then `N=61 A=../tinkered-base bench/queued.sh` (the baseline must live under /home/paseo: the host cannot see /tmp). Verify: ten scenarios × two trees in
  `.bench/ab.csv`, each gap taken from `benchctl ab`'s verdict, recorded in the
  [budget table](docs/roadmap/core-v1/budgets.md).

- **harness/approve-real-sdk** — the README (`packages/harness/README.md:204`) says a throwing approve op rejects the turn, and the fake-SDK test proves it; the real Claude SDK catches a throwing `canUseTool` and writes an error control response, so the turn goes on (same on main). Under t03 an approve panic fails the session instead. Next: decide the promise (settle the approve op and deny, or document the SDK behavior) and test against the real SDK's handling. Verify: README and a test agree with the real SDK.

- **repo/lint-staged-no-stash** — the commit hook's lint-staged backs up through `git stash`, and every
  worktree shares one stash list, so parallel writers' commits collide ("automatic backup is
  missing"). Next: run lint-staged without its stash backup (it only formats staged files), or give
  each worktree its own. Verify: two worktrees commit at once, 5 times, no collision.

- **tests/busy-host-flake** — a core test fails when the host is busy (a mutation run beside the
  gate): landers saw `cache.bench.test.ts` at 41 ms vs a 13 ms limit, and one unnamed core failure in
  `pnpm validate`. Next: find the test(s), make timing tests measure relative cost or move them to
  the bench lane. Verify: the core lane passes 5 of 5 beside a mutation run.

| Card                                                                                                                  | Owner         | Next                                                                                                                                                            | Verify                                        |
| --------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| docs/vertical — phone-readable docs: lists over tables, fences ≤ 60 chars (`docs/writing-style.md` → Vertical layout) | lead (Claude) | `node scripts/prose-lint.mjs --wide` lists 47 files; convert each when next touched, `TODO.md` and `docs/glossary.md` first; one contributor per package README | `--wide` prints 0 files; `vp run prose` clean |

- **ext/start-order** — two servers of a kind fail with `NotResolved {"label":"mcp"}` when the serving extension is listed after the server: `start` runs in the extension onion, so a `start` can only read extensions listed after it. Next: a core README line saying so, and `mcp()` / `hono()` extension labels that carry the server's name. Verify: the error names the server; README line present.

- **core/slot-guard** — a deterministic `pnpm validate` lane: parse the built `packages/core/dist/index.mjs` (oxc-parser), count module-scope declarations in order, and fail when any top-level name declared before the release block (source line of `invalidateResource`, via the source map) sits above slot 255; print the count and the headroom (5 names today). Pure count, no timing. Verify: the lane fails if one name is added before the block, passes on main.

## Doing

Pairs since 2026-09-25: an Opus 5.5 (high) writer and a Fable 5.1 (medium) reviewer per card; a
lander runs mutation, timing, and `pnpm validate` alone, one core card at a time.

| Card                                                                                                                                                                                                                      | Owner                                                                           | Next                                                                                                                                                                                                                                                                                                                                      | Verify                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| blueprint/v1 — `packages/blueprint`: a self-contained binary that judges a YAML blueprint of tinker units with Jev over question templates shipped in the package; built on `@tinker/core` + `@tinker/process` (ADR 0052) | lead (Claude, session blueprint); next contributor for t04                      | t01–t03 landed (34 tests, 7155 B gzip, mutation 75.09 alone; one real Jev run: 7 provisional findings on the example; [track](docs/roadmap/blueprint-v1/PROGRESS.md#landed)). Next: the t04 brief (evals, `status: proven`, reword `needsDefer` and `whyUnfulfilled`) to one contributor in `../tinkered-blueprint-t04` off `origin/main` | t01–t05 in the track; `blueprint check <file>` prints one line per plain check and per (node, template); evals gate which hits may block; `vp check` clean; mutation alone ≥ 75; no import from `tools/jev` |
| docs/core-promises — a `Promises` appendix in the core README, one line per seam-test promise, grouped by unit                                                                                                            | lead (Claude); contributor in `../tinkered-core-promises` (launched ~03:55 UTC) | Decision (user, 2026-09-21): an appendix, not prose — 151 gaps do not fit the sections; `promises.mjs core` is the check                                                                                                                                                                                                                  | `promises.mjs core` confident gaps → under 20; README-only diff                                                                                                                                             |
| tests/core-many-causes — the 31 core test flags: split, delete, or explain                                                                                                                                                | lead (Claude); contributor in `../tinkered-core-tests` (launched ~03:50 UTC)    | `tests.mjs core`: 18 manyCauses, 4 typeGuarantee, 4 helperAlone, 4 negativeTwin, 3 pairs, 1 `Object.isFrozen`; act on each, label each; core lane alone ≥ 75                                                                                                                                                                              | flags gone or explained; 270 → N tests each naming one promise; core mutation alone ≥ 75                                                                                                                    |

## Review

| Card | Owner | Next | Verify |
| ---- | ----- | ---- | ------ |

## Blocked

| Card | Waiting for | Next | Verify |
| ---- | ----------- | ---- | ------ |

## Parked

- **errors/errorMap** — an `errorMap` field on an operation that turns its panics into managed
  errors in one place (user idea, 2026-09-26; parked by the user). Not needed now: 9 catch-then-raise
  spots in 4 packages each wrap one call with details only that spot has, and drivers (hono,
  process, mcp) already `settle` each op and turn a panic into a 500, exit 1, or a tool error —
  Go's `recover` at the request edge. Resume when: two packages want every throw in an op
  converted and neither `try/catch` + `ctx.raise` nor `settle` can do it. Next: the three open
  questions (panics only? return `{ kind, payload }`? any depth?). Verify: both askers drop their
  workaround.

| Card                                                                                                                                      | Resume when                                                                  | Next                                                                                                                                                                                                                                                                                                 | Verify                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| blueprint/devtool — a devtool extension that draws and edits a blueprint graph from the YAML (nodes, `depends` edges, `why` on each node) | blueprint/t05 landed and the YAML shape has held for two apps                | Decide the host (browser devtool vs a Paseo plugin); the file stays the truth, the tool only reads and writes it                                                                                                                                                                                     | A blueprint round-trips through the tool with no diff                 |
| drivers/t08 — remove `meta` from core units                                                                                               | `mutation/core-85` lands (both touch core)                                   | [Impact list written](docs/roadmap/drivers-v1/PLAN.md#driverst08--impact-list-2026-09-21-grep-on-main-after-manyt-scip-does-not-index-apps): expand (harness takes `expose` rows) → migrate (tracker, tour) → contract (core drops the field, mcp drops `tool`/`readTool`); one contributor per step | `meta` grep → only row fields; every lane ≥ its break                 |
| ai/v1 — `@tinker/ai`                                                                                                                      | A real driver needs the AI layer                                             | Start from that driver's use case and write the scope and tickets                                                                                                                                                                                                                                    | Driver need and acceptance checks recorded before implementation      |
| core/ideas — Remaining core feedback                                                                                                      | A second integration asks, or the existing workaround misrepresents behavior | Use the [reviewed ideas](docs/roadmap/blocked-and-parked-review.md#core-ideas-one-by-one), name the caller, and scope one need                                                                                                                                                                       | Evidence of the real need before creating a core ticket               |
| react/mutation — Mutation checks in the browser                                                                                           | This deferred test-tool integration is scheduled                             | Set up Stryker with the existing browser tests; [track note](docs/roadmap/react-v1/PROGRESS.md#v1-complete)                                                                                                                                                                                          | Prove browser tests exercise mutants; record an isolated mutation run |
| react/observation — Pending work and component activity                                                                                   | A concrete UI/debugging need asks for these facts                            | Design the needed events and their lifetime; [reverted r16](docs/roadmap/react-v1/issues/16-react-span-emission.md)                                                                                                                                                                                  | Clear event contract and behavior checks before implementation        |

[All blockers and parked work reviewed 2026-09-19](docs/roadmap/blocked-and-parked-review.md).

## Done

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

| Card | Evidence |
| random-v1/t03 — docs + ambient-read lint | core README `### Random` (5 promise lines), glossary `random` + `TestRandom` rows, ADR 0062 → accepted, `scripts/check-ambient.mjs` + `pnpm validate` lane (package src/examples read time+random off ctx; only `systemClock`/`systemRandom` lines marked `ambient-source`). `vp check`/`vp run core#test` EXIT 0; `node scripts/check-ambient.mjs` exit 0 (negative test exit 1); `vp run prose` clean. [track](docs/roadmap/random-v1/PROGRESS.md) |
| random-v1/t01+t02 — ambient `random` capability + seeded `makeTestRandom` (ADR 0062, mirrors clock) | branch `random-v1/t01` (contributor `ce3b0e5`/`b6178c5` + lead docs): `Random.Handle{next,uuid}`, `systemRandom` default, `Scope.Options.random`, session inheritance, `makeTestRandom({ seed })` (mulberry32; uuid from same stream). `vp run -r build`/`vp check` (0 errors)/`vp run core#test` EXIT 0, 392 tests (7 new); core mutation alone **86.30** ≥ 85 (8 min); validate: core lanes green (3 http/process FAILs pre-existing on base `c3a33ba`); Jev preflight blocked by provider 503 (advisory). [track](docs/roadmap/random-v1/PROGRESS.md) |
| tests/kill-check-in-brief — per-line kill check is the writer's proof | brief updated (`docs/roadmap/contributor-brief.md` Setup); `vp run prose` 0 hits |
| jev/banks-registry — one `BANKS` registry + `judgeOf` | `tools/jev/bank.mjs`; `label.mjs`, `calibrate.mjs`, `evals/lint.mjs` look a judge up there; `label nope` lists every bank; `calibrate --dry` unchanged (survivorMatters proven); eval 25/25; `vp check` 0 errors / 20 warnings |
| mutation/react-85 — react mutation lane, floor 85 | lane `a652a28` (Stryker over vitest browser mode, concurrency 2), floor `887ee5e`; lane alone **93.16** (202 killed, 43 timeout, 18 survived) from 79.47; 21 seam tests (contributor ac75e60, per-line kill checks: 34 rows killed, 17 equivalent, 1 timeout, 2 already dead); `packages/react/README.md` gains `## Promises`; `promises.mjs react` 0/69 gaps; `vp check` 0 errors / 20 warnings; 69 react tests |
| blueprint/integrity — `blueprint verify`: a node is the unit whose `label` matches; five plain checks; `body` templates ask Jev (ADR 0055) | t06 + t07 landed 2026-09-21 (tags `blueprint/t06`, `t07`): 81 tests, 16216 B gzip, mutation 77.17 alone, validate 41/41; the binary verifies itself (`ok: 12 nodes, 12 units, 0 findings`); real `verify --key-file`: 8 `~` lines, exit 0; `bodyStraysFromWork` grades `noisy` (golden 7/12) — [track](docs/roadmap/blueprint-v1/PROGRESS.md#v11-complete-2026-09-21) |
| jev/review-0921 — calibration over all 147 cases; four noisy judges + `plan-check.mjs` + impact's Jev verdict retired; `helperAlone` reworded then retired (still noisy on its 30 cases); `titleVague` added; `proven` needs 5 cases a side (ADR 0054) | `calibration.json` committed from a full run; `node tools/jev/tests.mjs blueprint` 12/62 `titleVague`; full `calibrate.mjs`: 1 proven (`survivorMatters`), 5 retired; `impact.mjs cli/t04` prints 3 discrepancies with no key; `vp check tools/jev` 0 errors |
| blueprint/v1 — `packages/blueprint`: a self-contained binary that judges a YAML blueprint of tinker units with Jev over question templates shipped in the package (ADR 0052) | t01–t05 landed 2026-09-21 (tags `blueprint/t01`…`t05`): 62 tests, 11823 B gzip, mutation 77.22 alone, validate 41/41; real runs: `suggest` resource 96% / data 92%, `check` on the example 5 `~` lines exit 0; ADR 0052 §5 amended after the first real run; [track](docs/roadmap/blueprint-v1/PROGRESS.md#v1-complete-2026-09-21) |
| fix/fast-close-secondary — an idle scope's close reports an operation cleanup that threw | `87aebcb`: `canFastClose` also requires `layer.secondary` empty; seam test fails on main (`teardownErrors` undefined), passes with the fix; README promise line; core lane alone **86.08** (break 85, exit 0); `vp check` 0 errors / 20 warnings; 385 core tests; lifecycle probe A/B min-of-3 938 → 943 ns (noise) |
| mutation/core-85 — core mutation floor 75 → 85 | `packages/core/stryker.config.json` `break: 85`; lane alone on the landed branch: **86.19** (exit 0; 1399 killed, 18 timeout, 212 survived, 15 never covered) from 78.64; 92 seam tests in 8 new files, one README promise line each; contributor d88056a, three batches (78.64 → 83.00 → 84.59 → 86.07); batch 3 used per-line kill checks (`npx stryker run --mutate "src/index.ts:L-L"`) — the only proof; `vp check` 0 errors / 20 warnings; 384 core tests; Jev: 1 pair flag explained, promise gaps only pre-existing titles |

| tracker/preset-seam — client tests preset the endpoint node; `patchIssue` raises `IssueConflict` from the 409 once | `vp check` 0 errors; tracker 46 tests + browser proof 7 passed; `tools.test.ts` ×2 fail on the old `api.ts`; `backend(` in app tests → 0; [track](docs/roadmap/issue-tracker-v1/PROGRESS.md#trackerpreset-seam--landed-2026-09-21) |

| jev/survivors — `tools/jev/survivors.mjs <pkg>`: one `survivorMatters` judge over Stryker's surviving mutants                                     | `622c5ab` (10 commits, contributor f49c34d + lead); `vp check` 0 errors / 20 warnings; eval bad 78%, clean 19%/8%, separation 59; `calibrate.mjs`: **proven** (10 lead labels: true 6 med 83%, false 7 med 18%, sep 66, ordered 100%); real run on core: 198/355 at or above 70%, 56 never covered (`node tools/jev/survivors.mjs core --top 20`); threshold 0.7 from the labels; `json` reporter on all 9 `stryker.config.json` |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| jev/promises-fixes — short lines kept, exact match skips Jev, tie reads as unsure, `label.mjs --merge`                                            | `e83e520`; ~75 min, 0 fix rounds; each fix proven before/after on a copy (the short line itself had already been folded away on main); tie never reproduced live in ~1,200 picks, catch proven by a throwaway; real bank merges idempotently (121 cases)                                                                                                                                                                         |
| tests/core-titles — vague core test titles renamed; one split                                                                                     | `79b1f13`; ~25 min, 0 fix rounds; 14 titles now name the promise (no "still"/"as before"/internals), one two-promise title split; the vacuous assert was already fixed by the other session (`19acf3e`); 296 core tests; lane 78.27                                                                                                                                                                                              |
| examples/standard-schema — every example parser is a zod schema passed as-is                                                                      | 10 files, +25/−124 lines; `vp check` 0 errors; `vp test examples/` 6/6; `vp run -r test` green; the cli/hono/http/mcp/drizzle tours run and print their expected lines; `main.ts greet ada` → `hello ada`                                                                                                                                                                                                                        |
| core/size-diet — core ships minified; size cap 30,720 → 15,360 B                                                                                  | `packages/core/vite.config.ts` `minify: true` + `sourcemap: true`; `vp run core#size` 25,901 → 8,056 B gzip (comments were 15 kB of it); `vp check` 0 errors; `vp run -r build` and `vp run -r test` green on the minified dist; budgets doc updated                                                                                                                                                                             |
| core/standard-schema — every `parse` slot takes a Standard Schema object (zod, valibot, arktype) as-is; `parse(parser, raw)` exported for drivers | `core/standard-schema` worktree; 3 new core seam tests with zod (cell type inferred, op input output, async schema refused); `vp check` 0 errors; `vp run -r test` 12/12 packages green; core size 25.90 kB gzip; core mutation alone 78.45; `examples/harness/tools.ts` drops its wrapper                                                                                                                                       |
| docs/core-promises — `## Promises` appendix in the core README                                                                                    | `e663679`; 16 README-only commits, ~60 min, 0 fix rounds; `promises.mjs core` 148 → 6 confident gaps (15 unsure); 105 promise lines in 8 unit groups; 14 title clusters merged as one promise; 8 titles judged not-a-promise                                                                                                                                                                                                     |
| tests/core-many-causes — core's flagged tests split, deleted, or explained                                                                        | `3e5473a` from `../tinkered-land`; 11 commits, ~65 min, 0 fix rounds; 273 → 287 tests each naming one cause; `tests.mjs core` 28 → 15 (all explained); 39 labels; core lane alone 78.27; type-level tests kept and given a runtime half                                                                                                                                                                                          |
| tracker/observe — errors logged, not dropped; `Observe.Config` seam, JSON lines to stdout                                                         | `67530a9`; `vp check` 0 errors; tracker 47 tests (5 new; publish-after-commit fails without the fix: 500 → 201); build + browser proof 7 passed; real boot: `listening`, `http request`, failed span, `boot failed` on a taken port (exit 1); [track](docs/roadmap/issue-tracker-v1/PROGRESS.md#trackerobserve--landed-2026-09-21-925854a)                                                                                       |
| tests/floor-75-cleanup — the mutation lift's superficial tests deleted or merged                                                                  | `78a1c16` from `../tinkered-land`; 58 min, 0 fix rounds; http flags 22 → 5 explained, lane 85.13 alone; harness 6 → 5, lane 75.95 alone; 27 labels; [speed reading](docs/roadmap/jev-loop/PLAN.md#speed-reading-2026-09-21-three-cards)                                                                                                                                                                                          |
| docs/harness-promises — the README states every seam-test promise                                                                                 | six README-only commits; 18 min launch→report, 0 fix rounds; `promises.mjs harness` 20 → 0 confident gaps; feedback row on the four unwritten promises closed                                                                                                                                                                                                                                                                    |
| jev/reword-noisy — three judges reworded until proven                                                                                             | `b6bc124`; 13 min launch→report, 0 fix rounds; `runForwardsToClosure` sep 29→91, `effectWithoutDefer` 42→60, `handRolledLifetime` 4→79; 24/24 fixtures still pass                                                                                                                                                                                                                                                                |
| jev/ast-extraction + `@tinker/jev` package                                                                                                        | `94e91ab` (workspace package under `tools/jev`, `ai` out of the root, `oxc-parser` in), `5d29c21` (`extract.mjs`: units, tests with causes/asserts/narrows, helpers, imports, exports; slicers and test rules on it). Found on first run: the regex slicer had skipped every `resource` const; core has 270 tests, not 272                                                                                                       |
| core/bindings — `Tag.Bindings`: `meta`/`tags` take a binding, nothing, or a nested list                                                           | `vp check` 0 errors; 277 core tests (3 new: meta, scope/session tags, call tags) + every package lane green; size 25603 B / 30720; drizzle/harness/http/hono widened, hono spread gone; README Tags, glossary, ADR 0022/0023 amended                                                                                                                                                                                             |
| jev/scan-0921 — whole-codebase scan + plain-words docs                                                                                            | tests 566 → 74 flagged, promises 9 packages, lint 238 units → ~0 actionable; `tools/jev/README.md` + `explain.mjs`; 17 verdicts labeled; [notes](docs/roadmap/jev-loop/PLAN.md#whole-codebase-scan-2026-09-21-and-the-parser-decision)                                                                                                                                                                                           |
| jev/tests — test-quality tool in the workflow                                                                                                     | `tools/jev/tests.mjs`; four per-test judges + one pairwise, labelable and calibratable; trial http 24/48, harness 3/49 (two deterministic rules tightened); [plan](docs/roadmap/jev-loop/PLAN.md#test-quality-2026-09-21-scriptsjevtestsmjs-pkg--file)                                                                                                                                                                           |
| jev/calibrate — calibration in the workflow + promise gap                                                                                         | `label.mjs` / `calibrate.mjs` / `promises.mjs`; bank seeded (13 cases); `calibration.json` written (1 proven, 3 noisy, 9 provisional); harness promise gap 20/48; [plan](docs/roadmap/jev-loop/PLAN.md#calibration-and-the-promise-gap-are-in-the-workflow-2026-09-21)                                                                                                                                                           |
| perf/ab-0051 — big-sample A/B after the drivers track                                                                                             | [table](docs/roadmap/core-v1/budgets.md#big-sample-ab-after-the-drivers-track-2026-09-20): 10 scenarios × 31 runs per tree, alternating, pinned; every median within ±2% (session −1.0%); runner kept as `bench/ab.sh`; browser proof end-to-end exit 0 after the full rebuild                                                                                                                                                   |
| drivers/t04 — cli as an extension + cli lift                                                                                                      | `5f037fd`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst04-cli--landed-2026-09-20-5f037fd--driverst07--done-by-the-lead): cli 30 + mcp 9 + harness 48 + tracker 42, validate, cli mutation alone 79.77 (two src bugs fixed by survivors)                                                                                                                                                                                      |
| drivers/t07 — the two-hands gate + docs                                                                                                           | `scripts/two-hands.sh` as validate lane 38 (fails on a planted leak); best-practices rules 2/6, glossary; every mutation lane ≥ 75 measured alone                                                                                                                                                                                                                                                                                |
| mutation/floor-75 — all four lanes                                                                                                                | http 90.77, harness 76.05, sync 79.67 (t06), cli 79.77 (t04); every package ≥ 75                                                                                                                                                                                                                                                                                                                                                 |
| drivers/t05 — mcp as an extension with `expose` rows                                                                                              | `20e7531`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst05-mcp--landed-2026-09-20-20e7531): mcp 9 + harness 24 + cli 25 + tracker 42, `mcpServer`/`tools`/`serveIssues` none, mcp mutation alone 82.86                                                                                                                                                                                                                        |
| fix/subflow-run + fix/watch-prev — the two core one-liners                                                                                        | `3dbedb8`; `watch(next, prev)` + one test; the `.then` typing did not reproduce (drafter 14 → 8 lines); 274 core tests; probe no move; core mutation alone 77.96                                                                                                                                                                                                                                                                 |
| drivers/t06 — sync wiring rows; `connect` returns `Result`                                                                                        | `b3567ac`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst06--lead-landing-2026-09-20-b3567ac): 30 sync + 42 tracker + browser, `sync`/`synced` none, sync mutation alone 79.67, jev pre-flight clean                                                                                                                                                                                                                           |
| jev/react — component kind + five React rules + `view` in the guide                                                                               | `5df0fb9`; [eval 24/24, client run 28 judged / 3 notes](docs/roadmap/jev-loop/PLAN.md#react-the-component-kind--five-rules-2026-09-20); `vp check` 0 errors / 13 existing warnings                                                                                                                                                                                                                                               |
| drivers/t03 (+t02) — hono as an extension; tracker publishAfterCommit                                                                             | `0d17653`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst03-t02--landed-2026-09-20-0d17653): 34 hono + 42 tracker + browser, old symbols none, hono mutation alone 77.66                                                                                                                                                                                                                                                       |
| jev/toolset — Jev guide + lint in the coding-stage workflow                                                                                       | `118ecce`; `CLAUDE.md` contributor brief, coding-convention Check step, `preflight.mjs` runs the per-unit lint, untracked files included; proof: preflight over a real range in [the Jev plan](docs/roadmap/jev-loop/PLAN.md#where-it-hooks-advisory-scripts-in-scriptsjev)                                                                                                                                                      |
| jev/lint — Jev lint + primitive guide over the examples and the tracker                                                                           | `8515ad3`; [bank, evals 17/17, run 174 judged / 41 notes](docs/roadmap/jev-loop/PLAN.md#lint--guide--the-eslint-shaped-bank-2026-09-20-scriptsjevbankmjs); `vp check` 0 errors / 13 existing warnings; advisory only, no gate touched                                                                                                                                                                                            |
| drivers/t01 — core `session` hook + extension as a dependency                                                                                     | `d8bea8c`, tag `core/t36`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst01--landed-2026-09-20-d8bea8c-tag-coret36): 273 core tests, probe no move, core mutation alone 77.96                                                                                                                                                                                                                                                  |
| fix/stream-null, fix/serial-tx, docs/form-cells — three reshape one-liners                                                                        | `6c96adc` (http mutation alone 70.51, pre-floor), `ac99002`, `239f158`; feedback rows marked done                                                                                                                                                                                                                                                                                                                                |
| tracker/reshape — Rebuild the tracker on data / resource / operation                                                                              | `a098dc3`; [four slices with gates](docs/roadmap/issue-tracker-v1/PROGRESS.md#reshapeclient-b--landed-2026-09-20-trackerreshape-done): 0 lint errors, 40 app tests + browser proof, validate 37/37, hono mutation 79.38; `useState`/`useEffect`/`useRef` in src → 0; server 992 → 802 lines, client 1169 → 1941 (named, headless-tested)                                                                                         |
| tracker/audit — Usage audit against `@tinker/*` best practices                                                                                    | [Audit](docs/roadmap/issue-tracker-v1/audit-2026-09-20.md) (52 rows, 40 confirmed in §8), [server review](docs/roadmap/issue-tracker-v1/server-review-2026-09-20.md) (14 findings), [best-practices.md](docs/best-practices.md) (17 rules), 5 core-feedback rows; `vp check` clean on all five docs                                                                                                                              |
| tracker/t05 — Finish and show the app                                                                                                             | [Complete and pushed](docs/roadmap/issue-tracker-v1/PROGRESS.md#t05-complete--2026-09-19): tag ab4b0f8, 25 app tests + 7 helper tests + process/browser proof, 37 lanes, SCIP, verified public two-tab preview; writer cleaned up                                                                                                                                                                                                |
| tracker/t04 — Optional triage draft                                                                                                               | Code `db4f674`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t04-complete--2026-09-19): 25 tests, all 37 lanes, read-only tool composition, cancel/discard/Post, shutdown/reopen, malformed-stream safety, and SCIP                                                                                                                                                                                                    |
| tracker/t03 — CLI and issue tools                                                                                                                 | Code `3303f5a`; [final proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t03-complete--2026-09-19): 15 app tests, all 37 lanes, CLI/MCP live browser saves, stale-save safety, EOF/signal shutdown, and SCIP                                                                                                                                                                                                                      |
| tracker/t02 — Edit, assign, and discuss issues                                                                                                    | Code `1be5dfc`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t02-complete--2026-09-19): 11 app tests, 37 fresh validation lanes, 48 React tests, stale-draft regression, two tabs, reload/restart, and clean shutdown                                                                                                                                                                                                  |
| tracker/t01 — Create an issue and see it live                                                                                                     | Code `3490295`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t01-complete--2026-09-19): 3 app tests, 401 library tests, 37 lanes, two tabs, reload/restart, startup-drop error, clean shutdown, and app SCIP                                                                                                                                                                                                           |
| authoring/next — Choose and scope the issue tracker                                                                                               | User chose the app; [plan and five working slices](docs/roadmap/issue-tracker-v1/PROGRESS.md) recorded; public API anchors indexed; doc links and `vp check` passed                                                                                                                                                                                                                                                              |
| sync/v1 — Complete sync and confirm the pushed result                                                                                             | [All seven tickets done](docs/roadmap/sync-v1/PROGRESS.md#completion-check--2026-09-19); remote `sync/t07` = `3a6ae72`; fresh 28 tests and 37 validation lanes passed; recorded mutation 78.06%; optional bench work parked by user choice                                                                                                                                                                                       |
| docs/parked-review — Review all blockers and parked work                                                                                          | [Findings and next steps](docs/roadmap/blocked-and-parked-review.md); 313 tests passed, `vp check` 0 errors/13 existing warnings; links and lane states verified; one false core proposal closed; two deferred React cards restored                                                                                                                                                                                              |
| docs/kanban — Convert TODO to a Kanban board                                                                                                      | All 383 old lines preserved in the [archive](docs/roadmap/archive/todo-2026-09-19.md); links and lane states verified; `vp check` 0 errors; [agent rules](CLAUDE.md#execution-workflow-kanban) updated                                                                                                                                                                                                                           |
| docs/core-feedback — Close stale notes and fill verified doc gaps                                                                                 | `d6682e8` + `6fcc659`; 332 tests passed, `vp check` 0 errors. [Feedback and doc links](docs/roadmap/core-feedback.md)                                                                                                                                                                                                                                                                                                            |
| extensions/v1 — Ship all hooks and sync follow-up                                                                                                 | [Track complete](docs/roadmap/extensions-v1/PROGRESS.md); core/t35 mutation 78.56%, sync/t07 mutation 78.06%; all gates passed                                                                                                                                                                                                                                                                                                   |

Older shipped tracks, ticket notes, and measurements are kept in the [dated archive](docs/roadmap/archive/todo-2026-09-19.md).
