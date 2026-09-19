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

_None._

## Doing

_None._

## Review

_None._

## Blocked

| Card                                         | Waiting for              | Next                                                                                      | Verify                                                                                  |
| -------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| perf/op-parity — Compare operation call cost | Off-host `bench` sandbox | Run the call-path probes there using [the budget recipe](docs/roadmap/core-v1/budgets.md) | Record repeatable before/after results against the budget; no in-container timing claim |

## Parked

| Card                                                   | Resume when                                                                  | Next                                                                                                                | Verify                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| jev/calibrate — Calibrate the advisory checks          | User resumes this deferred work                                              | Label three positive and three negative cases per question, following [the Jev plan](docs/roadmap/jev-loop/PLAN.md) | A separation report for each question; thresholds set from the data |
| ai/v1 — `@tinker/ai`                                   | A real driver needs the AI layer                                             | Start from that driver's use case and write the scope and tickets                                                   | Driver need and acceptance checks recorded before implementation    |
| authoring/next — App startup/shutdown or a terminal UI | User picks the next integration                                              | Work through the chosen use case and record its design                                                              | A scoped plan and tickets with clear acceptance checks              |
| core/ideas — Remaining core feedback                   | A second integration asks, or the existing workaround misrepresents behavior | Review the specific [feedback row](docs/roadmap/core-feedback.md) and its callers                                   | Evidence of the real need before creating a core ticket             |

## Done

| Card                                                              | Evidence                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| docs/kanban — Convert TODO to a Kanban board                      | All 383 old lines preserved in the [archive](docs/roadmap/archive/todo-2026-09-19.md); links and lane states verified; `vp check` 0 errors; [agent rules](CLAUDE.md#execution-workflow-kanban) updated |
| docs/core-feedback — Close stale notes and fill verified doc gaps | `d6682e8` + `6fcc659`; 332 tests passed, `vp check` 0 errors. [Feedback and doc links](docs/roadmap/core-feedback.md)                                                                                  |
| extensions/v1 — Ship all hooks and sync follow-up                 | [Track complete](docs/roadmap/extensions-v1/PROGRESS.md); core/t35 mutation 78.56%, sync/t07 mutation 78.06%; all gates passed                                                                         |

Older shipped tracks, ticket notes, and measurements are kept in the [dated archive](docs/roadmap/archive/todo-2026-09-19.md).
