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

| Card                                    | Owner         | Next          | Verify                                                                        |
| --------------------------------------- | ------------- | ------------- | ----------------------------------------------------------------------------- |
| drivers/t07 — the two-hands gate + docs | lead (Claude) | After t03–t06 | validate lane fails on any `Scope.Handle` outside roots and `Extension.start` |

## Doing

| Card                                                           | Owner                                                                                                                                                                                           | Next                                                                                                                                             | Verify                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| drivers/t04 + t05 — cli and mcp as extensions with wiring rows | lead (Claude); contributor in `../tinkered-t04-cli-mcp`                                                                                                                                         | Expand, migrate tracker tools + tours, contract; [impact](docs/roadmap/drivers-v1/PLAN.md#driverst04--t05--impact-block-import-sites-2026-09-20) | `run({ scope })`, `runMain` scope creation, `commands`/`tools` tags, `mcpServer` refs `(none)`; tracker tools tests green; cli + mcp mutation alone ≥ 75 |
| mutation/floor-75 — lift http, cli, harness, sync to ≥ 75      | lead (Claude); part 1 (http, harness) contributor in `../tinkered-floor-75` from the on-disk reports (90/270 and 109/363 survivors/killed); part 2 (cli only; sync reached 79.67 via t06) after | First agent died twice on provider drops with nothing on disk; fresh agent commits per package                                                   | Each lane alone ≥ 75; no internals asserted; survivors triaged observable / unobservable in the plan                                                     |

## Review

| Card                                                       | Owner         | Next                                                                                                                                                                                                                      | Verify                                                                    |
| ---------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| fix/subflow-run + fix/watch-prev — the two core one-liners | lead (Claude) | Landed `3dbedb8` (`watch(next, prev)`; the `.then` typing did not reproduce — only the app wrapper was real, `drafter.ts` 14 → 8 lines). Remaining: core mutation lane alone once `mutation/floor-75` stops running lanes | 274 core tests, probe `op`/`run`/`warm` no move; core mutation alone ≥ 75 |

## Blocked

| Card | Waiting for | Next | Verify |
| ---- | ----------- | ---- | ------ |

## Parked

| Card                                                    | Resume when                                                                  | Next                                                                                                                                 | Verify                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| drivers/t08 — remove `meta` from core units             | t03–t06 landed and no driver reads `meta`                                    | SCIP refs table for `meta` across core, react, sync, harness, tours; then one contract ticket                                        | `meta` refs `(none)`; core mutation alone                                          |
| perf/op-parity — Compare operation call cost            | User revisits timing work and a suitable runner is available                 | Pin baseline/current SHAs and run the [budget recipe](docs/roadmap/core-v1/budgets.md) if resumed; no runner provisioning needed now | Record measured results if resumed; current off-host comparison remains unverified |
| jev/calibrate — Calibrate the advisory checks           | User resumes this deferred work                                              | Label three positive and three negative cases per question, following [the Jev plan](docs/roadmap/jev-loop/PLAN.md)                  | A separation report for each question; thresholds set from the data                |
| ai/v1 — `@tinker/ai`                                    | A real driver needs the AI layer                                             | Start from that driver's use case and write the scope and tickets                                                                    | Driver need and acceptance checks recorded before implementation                   |
| core/ideas — Remaining core feedback                    | A second integration asks, or the existing workaround misrepresents behavior | Use the [reviewed ideas](docs/roadmap/blocked-and-parked-review.md#core-ideas-one-by-one), name the caller, and scope one need       | Evidence of the real need before creating a core ticket                            |
| react/mutation — Mutation checks in the browser         | This deferred test-tool integration is scheduled                             | Set up Stryker with the existing browser tests; [track note](docs/roadmap/react-v1/PROGRESS.md#v1-complete)                          | Prove browser tests exercise mutants; record an isolated mutation run              |
| react/observation — Pending work and component activity | A concrete UI/debugging need asks for these facts                            | Design the needed events and their lifetime; [reverted r16](docs/roadmap/react-v1/issues/16-react-span-emission.md)                  | Clear event contract and behavior checks before implementation                     |

[All blockers and parked work reviewed 2026-09-19](docs/roadmap/blocked-and-parked-review.md).

## Done

| Card                                                                       | Evidence                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| drivers/t06 — sync wiring rows; `connect` returns `Result`                 | `b3567ac`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst06--lead-landing-2026-09-20-b3567ac): 30 sync + 42 tracker + browser, `sync`/`synced` none, sync mutation alone 79.67, jev pre-flight clean                                                                                                                                   |
| jev/react — component kind + five React rules + `view` in the guide        | `5df0fb9`; [eval 24/24, client run 28 judged / 3 notes](docs/roadmap/jev-loop/PLAN.md#react-the-component-kind--five-rules-2026-09-20); `vp check` 0 errors / 13 existing warnings                                                                                                                                                       |
| drivers/t03 (+t02) — hono as an extension; tracker publishAfterCommit      | `0d17653`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst03-t02--landed-2026-09-20-0d17653): 34 hono + 42 tracker + browser, old symbols none, hono mutation alone 77.66                                                                                                                                                               |
| jev/toolset — Jev guide + lint in the coding-stage workflow                | `118ecce`; `CLAUDE.md` contributor brief, coding-convention Check step, `preflight.mjs` runs the per-unit lint, untracked files included; proof: preflight over a real range in [the Jev plan](docs/roadmap/jev-loop/PLAN.md#where-it-hooks-advisory-scripts-in-scriptsjev)                                                              |
| jev/lint — Jev lint + primitive guide over the examples and the tracker    | `8515ad3`; [bank, evals 17/17, run 174 judged / 41 notes](docs/roadmap/jev-loop/PLAN.md#lint--guide--the-eslint-shaped-bank-2026-09-20-scriptsjevbankmjs); `vp check` 0 errors / 13 existing warnings; advisory only, no gate touched                                                                                                    |
| drivers/t01 — core `session` hook + extension as a dependency              | `d8bea8c`, tag `core/t36`; [proof](docs/roadmap/drivers-v1/PLAN.md#driverst01--landed-2026-09-20-d8bea8c-tag-coret36): 273 core tests, probe no move, core mutation alone 77.96                                                                                                                                                          |
| fix/stream-null, fix/serial-tx, docs/form-cells — three reshape one-liners | `6c96adc` (http mutation alone 70.51, pre-floor), `ac99002`, `239f158`; feedback rows marked done                                                                                                                                                                                                                                        |
| tracker/reshape — Rebuild the tracker on data / resource / operation       | `a098dc3`; [four slices with gates](docs/roadmap/issue-tracker-v1/PROGRESS.md#reshapeclient-b--landed-2026-09-20-trackerreshape-done): 0 lint errors, 40 app tests + browser proof, validate 37/37, hono mutation 79.38; `useState`/`useEffect`/`useRef` in src → 0; server 992 → 802 lines, client 1169 → 1941 (named, headless-tested) |
| tracker/audit — Usage audit against `@tinker/*` best practices             | [Audit](docs/roadmap/issue-tracker-v1/audit-2026-09-20.md) (52 rows, 40 confirmed in §8), [server review](docs/roadmap/issue-tracker-v1/server-review-2026-09-20.md) (14 findings), [best-practices.md](docs/best-practices.md) (17 rules), 5 core-feedback rows; `vp check` clean on all five docs                                      |
| tracker/t05 — Finish and show the app                                      | [Complete and pushed](docs/roadmap/issue-tracker-v1/PROGRESS.md#t05-complete--2026-09-19): tag ab4b0f8, 25 app tests + 7 helper tests + process/browser proof, 37 lanes, SCIP, verified public two-tab preview; writer cleaned up                                                                                                        |
| tracker/t04 — Optional triage draft                                        | Code `db4f674`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t04-complete--2026-09-19): 25 tests, all 37 lanes, read-only tool composition, cancel/discard/Post, shutdown/reopen, malformed-stream safety, and SCIP                                                                                                            |
| tracker/t03 — CLI and issue tools                                          | Code `3303f5a`; [final proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t03-complete--2026-09-19): 15 app tests, all 37 lanes, CLI/MCP live browser saves, stale-save safety, EOF/signal shutdown, and SCIP                                                                                                                              |
| tracker/t02 — Edit, assign, and discuss issues                             | Code `1be5dfc`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t02-complete--2026-09-19): 11 app tests, 37 fresh validation lanes, 48 React tests, stale-draft regression, two tabs, reload/restart, and clean shutdown                                                                                                          |
| tracker/t01 — Create an issue and see it live                              | Code `3490295`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t01-complete--2026-09-19): 3 app tests, 401 library tests, 37 lanes, two tabs, reload/restart, startup-drop error, clean shutdown, and app SCIP                                                                                                                   |
| authoring/next — Choose and scope the issue tracker                        | User chose the app; [plan and five working slices](docs/roadmap/issue-tracker-v1/PROGRESS.md) recorded; public API anchors indexed; doc links and `vp check` passed                                                                                                                                                                      |
| sync/v1 — Complete sync and confirm the pushed result                      | [All seven tickets done](docs/roadmap/sync-v1/PROGRESS.md#completion-check--2026-09-19); remote `sync/t07` = `3a6ae72`; fresh 28 tests and 37 validation lanes passed; recorded mutation 78.06%; optional bench work parked by user choice                                                                                               |
| docs/parked-review — Review all blockers and parked work                   | [Findings and next steps](docs/roadmap/blocked-and-parked-review.md); 313 tests passed, `vp check` 0 errors/13 existing warnings; links and lane states verified; one false core proposal closed; two deferred React cards restored                                                                                                      |
| docs/kanban — Convert TODO to a Kanban board                               | All 383 old lines preserved in the [archive](docs/roadmap/archive/todo-2026-09-19.md); links and lane states verified; `vp check` 0 errors; [agent rules](CLAUDE.md#execution-workflow-kanban) updated                                                                                                                                   |
| docs/core-feedback — Close stale notes and fill verified doc gaps          | `d6682e8` + `6fcc659`; 332 tests passed, `vp check` 0 errors. [Feedback and doc links](docs/roadmap/core-feedback.md)                                                                                                                                                                                                                    |
| extensions/v1 — Ship all hooks and sync follow-up                          | [Track complete](docs/roadmap/extensions-v1/PROGRESS.md); core/t35 mutation 78.56%, sync/t07 mutation 78.06%; all gates passed                                                                                                                                                                                                           |

Older shipped tracks, ticket notes, and measurements are kept in the [dated archive](docs/roadmap/archive/todo-2026-09-19.md).
