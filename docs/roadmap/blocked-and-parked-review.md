# Blocked and parked review — 2026-09-19

Reviewed against `b143305`, after extensions/v1 and the core feedback doc cleanup.
The live state stays in [TODO.md](../../TODO.md). This is the evidence behind that state.

## Findings

1. **Close a core proposal based on a false premise.** Failed extension startup calls
   structural cleanup directly. It runs `ctx.defer`, but does not automatically enter the
   extension `close` hook chain. A later explicit `scope.close()` does enter that chain.
   The proposed rule to skip the failing extension's close hook therefore does not fix the
   reported automatic path. Source inspection and public-entry probes agree (below).
   This does not make sync's guard against repeated transport shutdown unnecessary.
2. **Two React deferrals were missing from the live board.** The React track still defers its
   browser mutation lane and a design for pending/component activity. Both are now Parked.
   The later performance commit `9c5c84f` explicitly confirms React has no mutation lane;
   its 48 browser tests are not mutation evidence. Old marker emission was reverted.
3. **Two descriptions were stale.** Sync registers requested cell identities; it no longer
   publishes whole families to each client. First/last watcher cleanup remains an idea.
   CLI already creates and closes its scope and handles process signals; Hono documents
   graceful shutdown. The next authoring card now asks for a concrete unmet use case,
   rather than treating all app startup/shutdown as missing.

No source changes, new feature tickets, timing claims, or deferred implementation work came
from this review. Ready stays empty: one card is Blocked and six are Parked.

## Every blocked or parked card

| Card                | State and evidence                                                                                                                                                                                                       | What makes it ready                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perf/op-parity`    | **Blocked.** No usable off-host `bench` command or runner is available in this workspace. [Budgets](core-v1/budgets.md) still require that environment. Local timing rows are historical evidence, not the missing gate. | Identify the runner/endpoint, pin baseline and current SHAs, and run alternating probes on the same host. Record repeatable results and the budget comparison.          |
| `jev/calibrate`     | **Parked by user choice.** `plan-check.mjs` still calls itself uncalibrated (0.5 threshold); review routing uses 0.6. The repo has impact fixtures, not the planned plan-check/route corpus.                             | User resumes it. Label three positive and three negative cases per question, report separation, then choose thresholds. Existing impact evals do not replace this work. |
| `ai/v1`             | **Parked by user choice.** No `packages/ai` or recorded product consumer of `@tinker/ai` was found. The root `ai` dev dependency serves tooling; it does not establish a driver need.                                    | A real driver needs a shared AI layer. Record that use case and its acceptance checks before making tickets.                                                            |
| `authoring/next`    | **Parked for a use case.** CLI `runMain` handles process entry/signals; `run` owns the scope lifetime. Hono already shows graceful SIGTERM cleanup. A terminal UI remains an idea.                                       | Pick a user-facing need that those paths do not cover, then scope the integration.                                                                                      |
| `core/ideas`        | **Parked.** The candidates and tooling notes below have no new qualifying caller or proven dishonest workaround. One false-premise candidate is closed.                                                                  | A second integration asks, an existing workaround misrepresents behavior, or a measured tooling problem warrants a scoped change.                                       |
| `react/mutation`    | **Parked, restored to the board.** The [React track](react-v1/PROGRESS.md#v1-complete) explicitly defers Stryker with browser tests. The package has a `mutate` script but no Stryker config or recorded React score.    | Schedule the browser/Stryker integration. Prove mutants execute through real browser tests and record an isolated run; no score is claimed today.                       |
| `react/observation` | **Parked, restored to the board.** [r16](react-v1/issues/16-react-span-emission.md) was reverted because its markers added no useful React facts. Pending work and component lifecycle need a fresh design.              | A concrete UI/debugging need asks for these facts. Define events, ownership, and behavior tests before choosing a mechanism.                                            |

## Core ideas, one by one

These are requests to retain, not an approved implementation queue. The two onMount notes
describe one request from sync, not two independent integrations.

| Candidate                                        | Review and next step                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reuse a parent session's built resource          | Still first asker: Drizzle savepoints. `ownerOf` selects the current session for session-target resources. Wait for a second caller or a concrete savepoint requirement that cannot be represented honestly.       |
| One resource publishes a record of cells         | Harness uses explicit controller dependencies for its cells. This works; the request is ergonomic. Wait for another integration with the same need.                                                                |
| Run a tag-selected operation as a nested subflow | Harness still builds approval/tool dependencies when constructing the frame. Its dynamic-tag limitation remains; no second request is recorded.                                                                    |
| Public resource/operation type guards            | `isResource` and `isOperation` are private. CLI already uses the row's `kind` field to distinguish its union. Revisit when a real caller cannot express the distinction cleanly.                                   |
| Per-tool session cost                            | MCP still creates a session per call. No new bottleneck was measured. Use the off-host runner before proposing an optimization; keep the session's ownership semantics.                                            |
| Core cell family                                 | Sync implements a family with a Map and ordinary data cells. React can consume the returned cell without a core family primitive. No second core requirement is recorded.                                          |
| First/last watcher hook and unregister           | Requested identities already register, including late family members through `family.onMember`. Last-watcher unregister is still absent. Correct the old whole-family claim; keep this single sync request parked. |
| Skip a failing extension's close hook            | **Closed: false premise.** Automatic failed-start cleanup already bypasses that hook chain. See the probe below.                                                                                                   |
| Session-aware run/resolve hooks                  | `extendHandle` wraps the root; sessions use the plain handle path. This is the documented v1 boundary. Wait for a driver that needs per-request hooks.                                                             |
| Dependency/session write hooks                   | `writeThrough` wraps root controller writes. Operation dependency and session writes still use the plain path. Wait for a driver that needs those writes intercepted.                                              |
| Complexity-lint exceptions                       | The adapter mapping note and the `handleFor` note are tooling tradeoffs. Do not split the hot handle body or relax global lint just to remove warnings. Require a concrete change and measurements.                |

## Other retained notes

- **SCIP root examples:** indexes remain per package, so root examples are outside the impact
  table's view. A root index stays an idea until an impact review needs it; do not list invisible
  files as if SCIP covered them.
- **Stryker recipe imports:** reviewed the package test imports. Only sync imports a root example,
  and its config already has `inPlace: true`. The old request to check other recipe tests is
  satisfied for the current tree; future recipe imports must preserve this rule.
- **Jev evidence:** keep the artifact being judged in the model's input. The plan already records
  the diff-hunk result. Its broader calibration work remains under `jev/calibrate`.
- **SDK typing, overloads, naming, and README duplication:** these are existing adapter/language
  or writing conventions, not new core blockers. No fresh change is warranted by this review.
- **Accepted teardown limits:** [ADR 0029](../decisions/0029-teardown-v1-accepted-limitations.md)
  keeps escalation, late failure/order cases, async self-reentry/cycles, cooperative cancellation,
  hostile objects, and deep build recursion outside the v1 work queue. Old lt2/lt3 deferrals were
  resolved or explicitly accepted by lt4. A real caller hitting a limit is the trigger to reopen
  it; this review does not re-prove every accepted edge case.

## Proof and source anchors

Public-entry startup probe: an extension registers a deferred cleanup, rejects its start with a
known value, and has a close hook that records its call. Await `scope.ready`'s rejection, allow
the cleanup turn to finish, then explicitly call `scope.close()`. Both source and built entries
produced the same result:

```json
{ "automatic": ["defer"], "afterExplicitClose": ["defer", "close-hook"], "status": "failed" }
```

Fresh SCIP indexes covered all ten packages. No public symbols changed; old/new symbol removal
checks and an impact block are not applicable to these doc edits. Definition anchors below came
from `scripts/scip.sh refs`, not guessed source lines. Reference counts are per file.

| Package | Definitions in `src/index.ts`                                                                                                 | References                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| core    | `isOperation`:480; `isResource`:482; `addWatcher`:926; `ownerOf`:1547                                                         | 3, 14, 7, 7 respectively, all in `src/index.ts`        |
| core    | `writeThrough`:1721; `closeThrough`:1770; `runStartChain`:1792; `extendHandle`:2694; `resolveThrough`:2727; `runThrough`:2759 | 9, 5, 10, 17, 9, 5 respectively, all in `src/index.ts` |
| cli     | `isRow`:230; `readRun`:278; `wireSignal`:348; `runMain`:535                                                                   | 3, 8, 7, 1 respectively, all in `src/index.ts`         |
| harness | `readTurnOperation`:350                                                                                                       | 31 in `src/index.ts`                                   |
| mcp     | `readCall`:64                                                                                                                 | 7 in `src/index.ts`                                    |
| sync    | `family`:70; `source`:187; `subscribe`:288                                                                                    | source refs 19/1/8; `tests/sync.test.ts` refs 39/14/16 |

Observed checks: core 260, CLI 25, sync 28 tests passed (313 total); strict source style census
passed for core, CLI, harness, MCP, sync, and Drizzle. `vp check` passed with 0 errors and 13
existing warnings. Relative doc links/anchors and the board's lane states passed checks.
No mutation or wall-clock lane ran.

Local logs: `/tmp/parked-review-{core,cli,sync}-tests.log`, `/tmp/parked-review-census.log`,
`/tmp/parked-review-index.log`, and `/tmp/parked-review-*-refs.txt`.
`vp install` still reports the pre-existing esbuild build-policy placeholder; the installed
toolchain ran the checks. This review did not change that policy.
