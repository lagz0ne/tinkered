# Issue tracker v1 — build progress

**Active.** User-approved app direction: a realtime issue tracker that shows easy composition
and testing of the existing libraries. [Plan](PLAN.md). No application code has landed yet.

| Ticket      | Delivers                                                            | Blocked by | State   |
| ----------- | ------------------------------------------------------------------- | ---------- | ------- |
| tracker/t01 | [Create an issue and see it live](issues/01-create-and-see-live.md) | —          | Doing   |
| tracker/t02 | [Edit, assign, and discuss issues](issues/02-edit-and-discuss.md)   | t01        | Waiting |
| tracker/t03 | [Use the same actions from CLI and MCP](issues/03-cli-and-tools.md) | t02        | Waiting |
| tracker/t04 | [Draft a summary with the harness](issues/04-triage-draft.md)       | t03        | Waiting |
| tracker/t05 | [Finish the demo and its test guide](issues/05-finish-and-show.md)  | t04        | Waiting |

Lead uses `/home/paseo/next/tinkered-sync-land` on `lead/sync-land`. Writers get private Git
worktrees but stay in Paseo workspace `wks_85042cce8c480929`. One writer per ticket; no writer
pushes or runs mutation. The lead reviews the actual diff and browser result, then lands and pushes.

## Active writer

`tracker/t01`: Paseo agent `e00bd12d-94f9-49c9-af99-b61c5970e92f`, provider
`pi/meta-muse/muse-spark-1.3-contributor`, thinking max (switched from the Vercel Gateway route
after repeated HTTP 503; same agent and files). Current workspace only:
`wks_85042cce8c480929`. Explicit shell cwd `/home/paseo/next/tinkered-issue-t01`, branch
`tracker/t01-live-create`, cut from plan commit `a15b49b`. Brief `/tmp/issue-tracker-t01-brief.md`;
report target `/tmp/issue-tracker-t01-report.md`. No application completion claim yet.

## Anchors

Baseline `2f31491`; all packages indexed 2026-09-19. These are function-symbol definitions from
`scripts/scip.sh refs '(name1|name2)\(\)\.$' <package>`, not guessed source locations.

| Package | Definitions in `src/index.ts`                                                                    |
| ------- | ------------------------------------------------------------------------------------------------ |
| core    | `data`:553; `tag`:573; `operation`:604; `resource`:647; `makeTestClock`:1053; `createScope`:2883 |
| sync    | `family`:66; `source`:187; `subscribe`:288; `memoryPair`:445                                     |
| drizzle | `drizzleStore`:48                                                                                |
| hono    | `tinker`:66; `stream`:113; `honoApp`:207; `handle`:232                                           |

Raw baseline tables: `/tmp/issue-tracker-{core,sync,drizzle,hono}-refs.txt`.
The baseline changes no public library symbols, so it needs no removal/rename impact block.
SCIP's standard script indexes packages, not apps. Index the new app explicitly at review if
possible and record its refs; do not claim the package-only index covers app callers. Any library
API change needs its own brief, impact block, caller table, review, and relevant mutation gate.

## Gate and review notes

Pending implementation. Do not claim completion from a writer report alone. Per slice: app tests
and build, `vp check`, relevant repo tests/validation, strict style census, public-import/cast review,
and Core feedback. Add browser proof where the slice changes user behavior. A new app mutation
lane, if used, must run alone; never rerun all library mutations for unchanged library source.

The known `vp install` esbuild build-policy placeholder remains; do not change shared dependency
policy for this app. App-scoped dependencies and their lockfile entries may be added as needed.

## t01 draft review and recovery — 2026-09-19

The writer saved the app scaffold before its provider returned HTTP 503. No code commit or final
report exists yet. The lead preserved the private writer tree and resumed the same agent with a
finish-only prompt; no duplicate writer or new Paseo workspace was created.

Observed draft checks: `vp check` in the app has two type errors; `vp test` has four passing and
two failing tests. Sync tries to resolve a newly-created source identity; the valid HTTP request
passes the unresolved JSON-body promise to a synchronous input reader and gets 400. The writer
has exact corrections plus the missing frontend-serving, stream-handshake, ownership, browser,
and convention checks. Logs: `/tmp/tracker-t01-draft-{check,test}.log`. These are draft failures,
not completion evidence. The ticket remains Doing.

During the read-through, the lead fixed stale Drizzle wording: resource dependencies arrive as
built values, and commit cleanup must finish before publication. Pushed `fabb7db`; `vp check`
passed with zero errors and the same 13 warnings. Library source did not change. Fresh package
SCIP indexes passed; review refs are `/tmp/tracker-t01-lead-{core,sync,drizzle,hono}-refs.txt`.
App indexing and final code gates still wait for the finished slice.

The Vercel Gateway retry also failed before saving a fix. The same writer now uses the configured
direct Muse route, still thinking max, and has saved the source-identity and JSON-input corrections.
The lead sent one collected review round in `/tmp/issue-tracker-t01-review-fixes.md`: browser
transport close must notify listeners and settle failed readiness; loss of sync needs visible UI
state; network messages need real admission; startup/shutdown errors cannot be swallowed; the
browser proof needs unique data so old rows cannot pass it; GET tests need saved values. Finish
conventions, gates, browser proof, and report before landing. Recovery detail is preserved in
`/tmp/issue-tracker-t01-recovery.md`. No code has landed and no completion claim is made.

## t01 saved commit reviewed — 2026-09-19

Writer commit `e166a01` is saved in `tracker/t01-live-create`, not landed. Its report claims
four tests, browser create/reload/restart proof, checks, census, and 37 validation lanes passed.
The lead independently reproduced two remaining failures against this saved code/build:

- A real HTTP fixture opens SSE, accepts registration, then closes before the first snapshot.
  The browser remains on `Loading…`: `stream.onerror` only switches to the owned close path
  after `scope.ready`, leaving the readiness wait unsettled. Proof:
  `/tmp/tracker-startup-drop-proof.mjs`, `/tmp/tracker-startup-drop-proof.log`.
- A real app process with a registered live SSE connection exits 1 on a normal SIGTERM.
  The shutdown maps expected forced cancellation to failure and uses the same error callback
  on success. Proof: `/tmp/tracker-stop-proof.mjs`, `/tmp/tracker-stop-proof-result.json`.

The same writer is fixing these observations; no new writer or workspace. Review also requires
one save queue owned by the booted authority, typed input admission once, and final conventions.
No application code is on main yet. The ticket remains Doing until independent checks pass.

The lead package SCIP run succeeded for all ten packages (`/tmp/tracker-t01-review-index.log`).
Library refs are `/tmp/tracker-t01-review-{core,sync,drizzle,hono}-refs.txt`. This resolves the
writer-side package indexing failure; it does not substitute for indexing app callers.

Explicit app indexing also succeeded (713 ms) using
`/home/paseo/.local/share/pnpm/bin/scip-typescript index --output <landing>/.scip/issue-tracker.scip`
from the writer app cwd. Draft refs: `/tmp/tracker-t01-app-draft-refs.txt`. Definitions are
`bootScope`:39 and `createSaver`:19 in `src/server/bridge.ts`, `buildApp`:31 in
`src/server/app.ts`, and `connectTab`:52 in `src/client/sync.ts`. The writer received the
actual caller table before further authority/connection changes. Reindex the final code at landing.
