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

| Card                                                                 | Owner         | Next                                                                                                                                                                              | Verify                                                                                                            |
| -------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| tracker/reshape — Rebuild the tracker on data / resource / operation | lead (Claude) | Brief one contributor per slice, starting with [server/routes](docs/roadmap/issue-tracker-v1/PROGRESS.md#trackerreshape--rebuild-the-tracker-on-the-three-units-ready-2026-09-20) | `useState`, `useEffect`, `Scope.Handle` outside the two roots grep to zero; tests green; source under 1,800 lines |

## Doing

| Card | Owner | Next | Verify |
| ---- | ----- | ---- | ------ |

## Review

| Card | Owner | Next | Verify |
| ---- | ----- | ---- | ------ |

## Blocked

| Card | Waiting for | Next | Verify |
| ---- | ----------- | ---- | ------ |

## Parked

| Card                                                    | Resume when                                                                  | Next                                                                                                                                 | Verify                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| perf/op-parity — Compare operation call cost            | User revisits timing work and a suitable runner is available                 | Pin baseline/current SHAs and run the [budget recipe](docs/roadmap/core-v1/budgets.md) if resumed; no runner provisioning needed now | Record measured results if resumed; current off-host comparison remains unverified |
| jev/calibrate — Calibrate the advisory checks           | User resumes this deferred work                                              | Label three positive and three negative cases per question, following [the Jev plan](docs/roadmap/jev-loop/PLAN.md)                  | A separation report for each question; thresholds set from the data                |
| ai/v1 — `@tinker/ai`                                    | A real driver needs the AI layer                                             | Start from that driver's use case and write the scope and tickets                                                                    | Driver need and acceptance checks recorded before implementation                   |
| core/ideas — Remaining core feedback                    | A second integration asks, or the existing workaround misrepresents behavior | Use the [reviewed ideas](docs/roadmap/blocked-and-parked-review.md#core-ideas-one-by-one), name the caller, and scope one need       | Evidence of the real need before creating a core ticket                            |
| react/mutation — Mutation checks in the browser         | This deferred test-tool integration is scheduled                             | Set up Stryker with the existing browser tests; [track note](docs/roadmap/react-v1/PROGRESS.md#v1-complete)                          | Prove browser tests exercise mutants; record an isolated mutation run              |
| react/observation — Pending work and component activity | A concrete UI/debugging need asks for these facts                            | Design the needed events and their lifetime; [reverted r16](docs/roadmap/react-v1/issues/16-react-span-emission.md)                  | Clear event contract and behavior checks before implementation                     |

[All blockers and parked work reviewed 2026-09-19](docs/roadmap/blocked-and-parked-review.md).

## Done

| Card                                                              | Evidence                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tracker/audit — Usage audit against `@tinker/*` best practices    | [Audit](docs/roadmap/issue-tracker-v1/audit-2026-09-20.md) (52 rows, 40 confirmed in §8), [server review](docs/roadmap/issue-tracker-v1/server-review-2026-09-20.md) (14 findings), [best-practices.md](docs/best-practices.md) (17 rules), 5 core-feedback rows; `vp check` clean on all five docs |
| tracker/t05 — Finish and show the app                             | [Complete and pushed](docs/roadmap/issue-tracker-v1/PROGRESS.md#t05-complete--2026-09-19): tag ab4b0f8, 25 app tests + 7 helper tests + process/browser proof, 37 lanes, SCIP, verified public two-tab preview; writer cleaned up                                                                   |
| tracker/t04 — Optional triage draft                               | Code `db4f674`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t04-complete--2026-09-19): 25 tests, all 37 lanes, read-only tool composition, cancel/discard/Post, shutdown/reopen, malformed-stream safety, and SCIP                                                                       |
| tracker/t03 — CLI and issue tools                                 | Code `3303f5a`; [final proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t03-complete--2026-09-19): 15 app tests, all 37 lanes, CLI/MCP live browser saves, stale-save safety, EOF/signal shutdown, and SCIP                                                                                         |
| tracker/t02 — Edit, assign, and discuss issues                    | Code `1be5dfc`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t02-complete--2026-09-19): 11 app tests, 37 fresh validation lanes, 48 React tests, stale-draft regression, two tabs, reload/restart, and clean shutdown                                                                     |
| tracker/t01 — Create an issue and see it live                     | Code `3490295`; [lead proof](docs/roadmap/issue-tracker-v1/PROGRESS.md#t01-complete--2026-09-19): 3 app tests, 401 library tests, 37 lanes, two tabs, reload/restart, startup-drop error, clean shutdown, and app SCIP                                                                              |
| authoring/next — Choose and scope the issue tracker               | User chose the app; [plan and five working slices](docs/roadmap/issue-tracker-v1/PROGRESS.md) recorded; public API anchors indexed; doc links and `vp check` passed                                                                                                                                 |
| sync/v1 — Complete sync and confirm the pushed result             | [All seven tickets done](docs/roadmap/sync-v1/PROGRESS.md#completion-check--2026-09-19); remote `sync/t07` = `3a6ae72`; fresh 28 tests and 37 validation lanes passed; recorded mutation 78.06%; optional bench work parked by user choice                                                          |
| docs/parked-review — Review all blockers and parked work          | [Findings and next steps](docs/roadmap/blocked-and-parked-review.md); 313 tests passed, `vp check` 0 errors/13 existing warnings; links and lane states verified; one false core proposal closed; two deferred React cards restored                                                                 |
| docs/kanban — Convert TODO to a Kanban board                      | All 383 old lines preserved in the [archive](docs/roadmap/archive/todo-2026-09-19.md); links and lane states verified; `vp check` 0 errors; [agent rules](CLAUDE.md#execution-workflow-kanban) updated                                                                                              |
| docs/core-feedback — Close stale notes and fill verified doc gaps | `d6682e8` + `6fcc659`; 332 tests passed, `vp check` 0 errors. [Feedback and doc links](docs/roadmap/core-feedback.md)                                                                                                                                                                               |
| extensions/v1 — Ship all hooks and sync follow-up                 | [Track complete](docs/roadmap/extensions-v1/PROGRESS.md); core/t35 mutation 78.56%, sync/t07 mutation 78.06%; all gates passed                                                                                                                                                                      |

Older shipped tracks, ticket notes, and measurements are kept in the [dated archive](docs/roadmap/archive/todo-2026-09-19.md).
