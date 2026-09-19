# Issue tracker v1 — build progress

**Active.** User-approved app direction: a realtime issue tracker that shows easy composition
and testing of the existing libraries. [Plan](PLAN.md). The create/live slice is complete; editing is next.

| Ticket      | Delivers                                                            | Blocked by | State   |
| ----------- | ------------------------------------------------------------------- | ---------- | ------- |
| tracker/t01 | [Create an issue and see it live](issues/01-create-and-see-live.md) | —          | Done    |
| tracker/t02 | [Edit, assign, and discuss issues](issues/02-edit-and-discuss.md)   | t01        | Doing   |
| tracker/t03 | [Use the same actions from CLI and MCP](issues/03-cli-and-tools.md) | t02        | Waiting |
| tracker/t04 | [Draft a summary with the harness](issues/04-triage-draft.md)       | t03        | Waiting |
| tracker/t05 | [Finish the demo and its test guide](issues/05-finish-and-show.md)  | t04        | Waiting |

Lead uses `/home/paseo/next/tinkered-sync-land` on `lead/sync-land`. Writers get private Git
worktrees but stay in Paseo workspace `wks_85042cce8c480929`. One writer per ticket; no writer
pushes or runs mutation. The lead reviews the actual diff and browser result, then lands and pushes.

## Active writer

`tracker/t02` uses `/home/paseo/next/tinkered-issue-t02`, branch `tracker/t02-edit-discuss`,
from verified `0050bbc`. All agents remain in workspace `wks_85042cce8c480929`.
Writer `0ebfe3e2-c0d7-4f80-8f84-bea2282f54b3` uses the discovered direct Muse route,
thinking max. The lead reviews in its private landing tree; the shared checkout is untouched.

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

## t01 complete — 2026-09-19

Code `3490295`: writer commits `e166a01` + `5b2e14f` cherry-picked as `5047be1` + `efef847`,
then a small lead cleanup. Shutdown is awaited in the main entrypoint. Pass-through helpers,
unused exports, and private comments were removed. The README builds public dependencies first.
One booted authority owns the save queue; its transaction finishes before root publication.

Independent lead checks on the landing tree:

- `vp run --filter '@tinker-issue-tracker...' build` — 8 build tasks passed.
  `/tmp/tracker-t01-lead-clean-build.log`.
- `vp run @tinker-issue-tracker#test` — 3 tests passed with real PGlite, routes, and memory sync.
  `/tmp/tracker-t01-final-test.log`.
- `vp check` — 0 errors, 13 existing warnings; strict app census passed.
  `/tmp/tracker-t01-final-check.log` and `/tmp/tracker-t01-final-census.log`.
- Uncached core/http/drizzle/hono/react/sync tests — 401 passed across 6 packages.
  `/tmp/tracker-t01-lead-package-tests.log`.
- `node scripts/validate.mjs` — all 37 lanes passed. `/tmp/tracker-t01-lead-validate.log`.
  Library source unchanged; no mutation rerun.
- Real Chromium: a unique issue from one tab reached the other without refresh. Reload and a
  full process restart restored the exact saved record. Both stops exited 0; a live tab showed
  the dropped-connection message. No browser exceptions. The 390px phone view fits; the lead
  inspected `/tmp/tracker-t01-mobile.png`. Proof:
  `/tmp/tracker-t01-browser-lead.mjs` and `/tmp/tracker-t01-browser-lead-result.json`.
- Startup-drop regression: real SSE opens, registration succeeds, then the stream ends before
  its first snapshot. The same probe that showed `Loading…` before now shows a connection error.
  `/tmp/tracker-t01-lead-startup-drop.log`. Preserve this proof in the final t05 test guide.
- No private library imports. Browser assets contain no PGlite, Drizzle, Node filesystem, or
  harness imports. Cast review found only the error registry and the typed empty issue array.
- `vp install` installs links/dependencies but still exits 1 for the existing esbuild policy
  placeholder. Build, tests, and server work. Shared dependency policy is unchanged.

[Core feedback](../core-feedback.md) records root publication, synchronous Hono input admission
(doc fixed in `8d8da92`), and app-owned transport lifecycle. Automatic reconnect, friendly
command-error wording, and 44px touch targets remain in t05. No preview is claimed for this slice.

Fresh SCIP covers all ten packages plus an explicit app index. Removed helper names:

```text
== issue-tracker
  definitions
  references (count  symbol  file)
    (none)
```

Final app symbols and callers (paths relative to `apps/issue-tracker`):

```text
== issue-tracker
  definitions
    /createIssue.  ->  src/server/operations.ts:7
    /issueList.  ->  src/shared/issues.ts:60
    /listIssues.  ->  src/server/operations.ts:24
    bootScope().  ->  src/server/bridge.ts:40
    buildApp().  ->  src/server/app.ts:24
    connectTab().  ->  src/client/sync.ts:53
    createSaveQueue().  ->  src/server/bridge.ts:27
    parseCreateInput().  ->  src/shared/issues.ts:44
    parseIssue().  ->  src/shared/issues.ts:25
    parseIssueList().  ->  src/shared/issues.ts:38
  references (count  symbol  file)
        1  /createIssue.  src/index.ts
        2  /createIssue.  src/server/bridge.ts
        2  /issueList.  src/client/App.tsx
        2  /issueList.  src/client/sync.ts
        1  /issueList.  src/index.ts
        2  /issueList.  src/server/app.ts
        4  /issueList.  src/server/bridge.ts
        2  /issueList.  src/server/operations.ts
        9  /issueList.  tests/issues.test.ts
        1  /listIssues.  src/index.ts
        3  /listIssues.  src/server/bridge.ts
        1  bootScope().  src/index.ts
        2  bootScope().  src/server/main.ts
        5  bootScope().  tests/issues.test.ts
        1  buildApp().  src/index.ts
        3  buildApp().  src/server/main.ts
        2  buildApp().  tests/issues.test.ts
        3  connectTab().  src/client/main.tsx
        1  createSaveQueue().  src/server/bridge.ts
        2  parseCreateInput().  src/client/api.ts
        1  parseCreateInput().  src/index.ts
        2  parseCreateInput().  src/server/app.ts
        2  parseCreateInput().  src/server/operations.ts
        2  parseIssue().  src/client/api.ts
        1  parseIssue().  src/index.ts
        2  parseIssue().  src/server/operations.ts
        1  parseIssue().  src/shared/issues.ts
        2  parseIssueList().  src/client/api.ts
        1  parseIssueList().  src/index.ts
        1  parseIssueList().  src/shared/issues.ts
        2  parseIssueList().  tests/issues.test.ts
```

## t02 started — 2026-09-19

The contributor brief `/tmp/issue-tracker-t02-brief.md` contains the actual t01 app caller table
above and the type table below before edits. The work adds saved detail, revision checks, comments,
and activity; one authority still owns every short write and publishes after commit. The expected
changed files are the shared model, store, operations, bridge, routes, HTTP operations, sync viewer,
UI, public entry, and their behavior tests. New detail members may add app-local files/callers.

The advisory impact tool assumes `packages/<name>`, so its source diff and evidence paths do not
cover `apps/issue-tracker`. Explicit app SCIP remains the review source of truth. The block records
existing public app symbols whose shapes will grow; compare final callers manually and record new
symbols at review. No public library symbol changes are authorized by this slice.

```impact tracker/t02
issue-tracker Booted/Composed# src/server/bridge.ts src/server/app.ts
issue-tracker Booted/Save# src/server/bridge.ts
issue-tracker Issues/Issue# src/shared/issues.ts src/server/bridge.ts src/server/operations.ts
issue-tracker bootScope(). src/server/bridge.ts src/index.ts src/server/main.ts tests/issues.test.ts
issue-tracker buildApp(). src/server/app.ts src/index.ts src/server/main.ts tests/issues.test.ts
issue-tracker connectTab(). src/client/sync.ts src/client/main.tsx
```

Type definitions and callers from the explicit baseline app index:

```text
== issue-tracker
  definitions
    Booted/Composed#  ->  src/server/bridge.ts:13
    Booted/Save#  ->  src/server/bridge.ts:9
    Issues/CreateInput#  ->  src/shared/issues.ts:14
    Issues/Issue#  ->  src/shared/issues.ts:7
  references (count  symbol  file)
        1  Booted/Composed#  src/server/app.ts
        1  Booted/Composed#  src/server/bridge.ts
        2  Booted/Save#  src/server/bridge.ts
        2  Issues/CreateInput#  src/server/bridge.ts
        1  Issues/CreateInput#  src/shared/issues.ts
        2  Issues/Issue#  src/server/bridge.ts
        1  Issues/Issue#  src/server/operations.ts
        3  Issues/Issue#  src/shared/issues.ts
```
