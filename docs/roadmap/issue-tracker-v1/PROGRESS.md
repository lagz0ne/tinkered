# Issue tracker v1 — build progress

**Active.** User-approved app direction: a realtime issue tracker that shows easy composition
and testing of the existing libraries. [Plan](PLAN.md). Create, edit, discussion, CLI, and MCP tools are complete. The optional helper and final browser polish remain.

| Ticket      | Delivers                                                            | Blocked by | State   |
| ----------- | ------------------------------------------------------------------- | ---------- | ------- |
| tracker/t01 | [Create an issue and see it live](issues/01-create-and-see-live.md) | —          | Done    |
| tracker/t02 | [Edit, assign, and discuss issues](issues/02-edit-and-discuss.md)   | t01        | Done    |
| tracker/t03 | [Use the same actions from CLI and MCP](issues/03-cli-and-tools.md) | t02        | Done    |
| tracker/t04 | [Draft a summary with the harness](issues/04-triage-draft.md)       | t03        | Doing   |
| tracker/t05 | [Finish the demo and its test guide](issues/05-finish-and-show.md)  | t04        | Waiting |

Lead uses `/home/paseo/next/tinkered-sync-land` on `lead/sync-land`. Writers get private Git
worktrees but stay in Paseo workspace `wks_85042cce8c480929`. One writer per ticket; no writer
pushes or runs mutation. The lead reviews the actual diff and browser result, then lands and pushes.

## Completed t02 writer

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

## t02 early server review — 2026-09-19

The writer is still building the slice. Early source review corrected timestamp columns too small
for epoch milliseconds, a null-assignee fallback that prevented clearing, and detail reads outside
the save queue. The first queue fix also published on reads; that was corrected before UI testing
so a detail GET cannot trigger a list-update/detail-reload loop. These are app composition fixes,
not new core requests.

The lead ran `/tmp/tracker-t02-http-lead.mjs` against the saved server draft after building its
public dependencies. It passed: real-clock create, edit/assignment, stale 409 with current saved
state and unchanged history, revision-free comments, invalid 400 with unchanged detail, explicit
assignment clearing, and exact detail restoration after closing and reopening the database.
It also opened an actual t01 database made before the new schema and preserved its existing issue.
Evidence: `/tmp/tracker-t02-http-draft.log` and `/tmp/tracker-t02-http-lead-result.json`.

This is early server evidence only. Browser behavior, final tests/checks, code review, and landing
remain open. The old-schema fixture is now migrated; do not claim a later reopen repeats migration.

## t02 draft browser review — 2026-09-19

Lead `d99c8199-fd3a-4af8-b57d-9728e6f5fc96` owns the private landing. The same t02 writer
continues. A two-tab browser probe reproduced a stale-draft bug: after one tab saved, the other
tab retained its old fields but adopted the incoming revision. Its next save could overwrite the
newer issue. The writer has saved a local draft-revision fix; final proof is pending.
Before-fix evidence: `/tmp/tracker-t02-stale-draft-before.log`.

The same review requires an issue-id-owned detail view, snapshot-driven comment refresh even when
timestamps match, and visible refresh errors without losing drafts. The independent process probe
is `/tmp/tracker-t02-browser-lead.mjs`; it checks edits, conflict/history, comments, clear assignment,
filtering, switching issues, phone fit, reload, restart, and live-SSE shutdown. No preview exists yet.

## t02 complete — 2026-09-19

Code `1be5dfc` is the reviewed cherry-pick of writer `df4c197`. App source and tests are identical
to the writer commit. One authority queue owns writes and detail reads. Only successful writes
publish. Detail uses HTTP after a list snapshot; a family added no value here. Local draft revision
advances only after its own save or explicit reload-current.

Independent checks by lead `d99c8199-fd3a-4af8-b57d-9728e6f5fc96` in the final private tree:

- Fresh dependency-first build: `vp run --no-cache --filter '@tinker-issue-tracker...' build` —
  all 8 tasks passed with zero cache hits. `/tmp/tracker-t02-final-build.log`.
  The guide now uses this observed command because the writer saw stale cached client output.
- App tests: 11 passed; `/tmp/tracker-t02-final-tests.log`. Strict census: all enforced hits zero;
  `/tmp/tracker-t02-final-census.log`. `vp check`: zero errors and 13 existing warnings;
  `/tmp/tracker-t02-final-check.log`. Writer-side baseline errors are not the lead gate evidence.
- `node scripts/validate.mjs` on the final t02 tree: all 37 lanes passed;
  `/tmp/tracker-t02-final-validate.log`. This is a fresh t02 run by this lead, not t01 evidence
  and not a claim from either parent. React: 48 tests passed uncached;
  `/tmp/tracker-t02-lead-react-tests.log`. Library source did not change; no mutation run.
- Real HTTP/PGlite probe passed on the final tree: edit, stale 409/current saved state, exact
  unchanged history after rejection, independent comment, invalid 400, clear assignment, and
  exact detail restoration after reopen. `/tmp/tracker-t02-final-http.log` and
  `/tmp/tracker-t02-http-lead-result.json`. Actual t01-schema migration was proven in the early
  probe; `/tmp/tracker-t02-http-early-result.json` preserves that result. The final run only
  reopens that already migrated fixture; it does not repeat the old-schema migration claim.
- Real Chromium, fresh owned process/port/database: two tabs, retained draft/revision under
  remote edits, stale 409 with unchanged full history, comments while stale, reload-current,
  clear assignment, status filter, and switching issue drafts. Reload and full process restart
  restored exact detail/comments/activity. SIGTERM with live SSE exited 0 twice; no page errors.
  `/tmp/tracker-t02-final-browser.log`, `/tmp/tracker-t02-browser-lead-result.json`.
  The same probe failed on the old draft revision behavior before the fix:
  `/tmp/tracker-t02-stale-draft-before.log`. The 390px screenshot was inspected; no sideways scroll.
- Public-import and built-client inspection found no private library entries, database driver,
  Node filesystem, MCP, or model SDK in browser assets. Core feedback and its two small doc gaps
  are recorded in [the feedback table](../core-feedback.md).
- `vp install` still exits 1 for the pre-existing esbuild build-policy placeholder. No policy edit;
  installed links, uncached builds, tests, and real processes work.

The app is not complete yet. CLI/MCP, optional harness, recovery, touch targets, and the verified
public preview remain t03–t05. No preview exists. t03 is ready for its own private contributor.

SCIP: all ten package indexes plus the final explicit app index passed. No library symbols changed.
Removed `createSaveQueue` has no references:

```text
== issue-tracker
  definitions
  references (count  symbol  file)
    (none)
```

Current app definitions and callers match the brief: server authority stays in bridge/routes;
new detail/edit/comment readers reach shared model, HTTP client, operations, and public entry.
`IssueConflict.current` adds the expected `errors.ts` reference. UI/types/tests grow with the slice;
`connectTab` remains in its existing client files. No caller escapes the app.

```text
== issue-tracker
  definitions
    /addComment.  ->  src/server/operations.ts:134
    /createIssue.  ->  src/server/operations.ts:86
    /editIssue.  ->  src/server/operations.ts:111
    /getDetail.  ->  src/client/api.ts:45
    /getIssues.  ->  src/client/api.ts:53
    /issueList.  ->  src/shared/issues.ts:307
    /listIssues.  ->  src/server/operations.ts:184
    /patchIssue.  ->  src/client/api.ts:25
    /postComment.  ->  src/client/api.ts:34
    /postIssue.  ->  src/client/api.ts:17
    /readDetail.  ->  src/server/operations.ts:156
    Booted/Composed#  ->  src/server/bridge.ts:22
    Booted/Save#  ->  src/server/bridge.ts:12
    Issues/CommentInput#  ->  src/shared/issues.ts:59
    Issues/Detail#  ->  src/shared/issues.ts:39
    Issues/EditInput#  ->  src/shared/issues.ts:53
    Issues/Issue#  ->  src/shared/issues.ts:17
    bootScope().  ->  src/server/bridge.ts:62
    buildApp().  ->  src/server/app.ts:52
    connectTab().  ->  src/client/sync.ts:53
    createSerial().  ->  src/server/bridge.ts:39
    parseCommentInput().  ->  src/shared/issues.ts:275
    parseCreateInput().  ->  src/shared/issues.ts:210
    parseEditInput().  ->  src/shared/issues.ts:227
    parseIssue().  ->  src/shared/issues.ts:101
    parseIssueDetail().  ->  src/shared/issues.ts:198
  references (count  symbol  file)
        1  /addComment.  src/index.ts
        2  /addComment.  src/server/bridge.ts
        1  /createIssue.  src/index.ts
        2  /createIssue.  src/server/bridge.ts
        1  /editIssue.  src/index.ts
        2  /editIssue.  src/server/bridge.ts
        2  /getDetail.  src/client/App.tsx
        3  /issueList.  src/client/App.tsx
        2  /issueList.  src/client/sync.ts
        1  /issueList.  src/index.ts
        2  /issueList.  src/server/app.ts
        3  /issueList.  src/server/bridge.ts
        2  /issueList.  src/server/operations.ts
       15  /issueList.  tests/issues.test.ts
        1  /listIssues.  src/index.ts
        2  /listIssues.  src/server/bridge.ts
        2  /listIssues.  tests/issues.test.ts
        2  /patchIssue.  src/client/App.tsx
        2  /postComment.  src/client/App.tsx
        2  /postIssue.  src/client/App.tsx
        1  /readDetail.  src/index.ts
        2  /readDetail.  src/server/bridge.ts
        5  Booted/Composed#  src/server/app.ts
        1  Booted/Composed#  src/server/bridge.ts
        1  Booted/Composed#  src/server/main.ts
       44  Booted/Composed#  tests/issues.test.ts
        3  Booted/Save#  src/server/app.ts
        5  Booted/Save#  src/server/bridge.ts
       20  Booted/Save#  tests/issues.test.ts
        1  Issues/CommentInput#  src/client/api.ts
        1  Issues/CommentInput#  src/server/bridge.ts
        7  Issues/CommentInput#  src/server/operations.ts
        4  Issues/CommentInput#  src/shared/issues.ts
       12  Issues/CommentInput#  tests/issues.test.ts
       12  Issues/Detail#  src/client/App.tsx
        2  Issues/Detail#  src/server/bridge.ts
        4  Issues/Detail#  src/server/operations.ts
        4  Issues/Detail#  src/shared/issues.ts
       22  Issues/Detail#  tests/issues.test.ts
        1  Issues/EditInput#  src/client/api.ts
        1  Issues/EditInput#  src/server/bridge.ts
       13  Issues/EditInput#  src/server/operations.ts
        7  Issues/EditInput#  src/shared/issues.ts
       21  Issues/EditInput#  tests/issues.test.ts
       34  Issues/Issue#  src/client/App.tsx
        1  Issues/Issue#  src/errors.ts
        2  Issues/Issue#  src/server/bridge.ts
       38  Issues/Issue#  src/server/operations.ts
       12  Issues/Issue#  src/shared/issues.ts
       51  Issues/Issue#  tests/issues.test.ts
        1  bootScope().  src/index.ts
        1  bootScope().  src/server/bridge.ts
        2  bootScope().  src/server/main.ts
       14  bootScope().  tests/issues.test.ts
        1  buildApp().  src/index.ts
        2  buildApp().  src/server/app.ts
        3  buildApp().  src/server/main.ts
        4  buildApp().  tests/issues.test.ts
        3  connectTab().  src/client/main.tsx
        2  connectTab().  src/client/sync.ts
        9  createSerial().  src/server/bridge.ts
        2  parseCommentInput().  src/client/api.ts
        1  parseCommentInput().  src/index.ts
        2  parseCommentInput().  src/server/app.ts
        2  parseCommentInput().  src/server/operations.ts
        4  parseCommentInput().  src/shared/issues.ts
        2  parseCreateInput().  src/client/api.ts
        1  parseCreateInput().  src/index.ts
        2  parseCreateInput().  src/server/app.ts
        2  parseCreateInput().  src/server/operations.ts
        8  parseCreateInput().  src/shared/issues.ts
        2  parseEditInput().  src/client/api.ts
        1  parseEditInput().  src/index.ts
        2  parseEditInput().  src/server/app.ts
        2  parseEditInput().  src/server/operations.ts
       11  parseEditInput().  src/shared/issues.ts
        2  parseIssue().  src/client/App.tsx
        3  parseIssue().  src/client/api.ts
        1  parseIssue().  src/index.ts
        4  parseIssue().  src/server/operations.ts
       17  parseIssue().  src/shared/issues.ts
        2  parseIssueDetail().  src/client/api.ts
        1  parseIssueDetail().  src/index.ts
        6  parseIssueDetail().  src/shared/issues.ts
```

## t03 started — 2026-09-19

The t02 code tag `tracker/t02` is `1be5dfc8fc7162406f3ba038a994975ac91b667c`;
remote main was verified at `a87cef8abcca250c3ef3f9c620724fad46661449` after the atomic push.
The clean t02 writer tree and branch were removed; the finished writer was archived.

The new private tree is `/home/paseo/next/tinkered-issue-t03`, branch `tracker/t03-cli-tools`,
from that verified main. Its single contributor stays in workspace `wks_85042cce8c480929`.
The brief `/tmp/issue-tracker-t03-brief.md` includes the final t02 SCIP table above before changes.
Expected new callers are Node CLI/tool declarations and public tests using the existing HTTP
operations and shared readers. No existing library signature change is authorized. CLI/MCP
must call the running HTTP authority; only that server owns PGlite and live publication.

Profiles were empty. Provider/model discovery confirmed the direct Muse contributor route with
max thinking. Active writer: `1fce876f-955e-4f43-b45a-1be85fada3a2`.
No t03 code has been claimed ready.

## t03 lead review in progress — 2026-09-19

Lead ownership is now `6b8ee55a-f1da-47d1-85f5-54af81262102`, in the same private landing
and workspace. The existing writer remains the only t03 writer. No t03 app code is claimed ready.

Independent public driver tests passed: CLI 25 and MCP 8, both with the task cache disabled.
Logs: `/tmp/tracker-t03-lead-cli-tests.log`, `/tmp/tracker-t03-lead-mcp-tests.log`.
Install still hits the known ignored esbuild build-script policy; no policy or tooling changed.

The MCP README's CLI entry exited 0 with stdin still open. The lead reproduced that exact
example using the public built packages, then verified an owned lifetime through real
stdio initialization and EOF/SIGTERM exit. The doc now shows that tested lifetime.
Proof: `/tmp/tracker-t03-mcp-doc-before.log`, `/tmp/tracker-t03-mcp-doc-after.log`.
This closes a doc defect only; the full tracker slice still needs its saved implementation
and independent app/browser/process checks.

### t03 saved source review

The first Node CLI/tool declarations now exist. A separate lead process/browser probe
passed offline help, real stdio initialize/list/create/update/comment/get, browser live
updates from both CLI and MCP, stale MCP rejection with exact unchanged detail, EOF exit 0,
SIGTERM exit 130, and web shutdown with a live SSE connection. This is preliminary source
proof, not final slice acceptance. Log: `/tmp/tracker-t03-first-stdio-browser.log`.

The bad-input check then failed: omitted revision returns only `Error: BadEditInput`
and code 1. It must enter the operation parse door and show usage/code 2. The saved tests
also test parser/config helpers and cast JSON instead of reading saved values through the
public readers. These remain writer fixes before final gates.

Before removing the new pass-through config export and making input/env readers private,
the lead indexed the app and recorded every caller below. The Node main and tests must
use the existing exported `api.config({ baseUrl })`; the get operation keeps its input reader.
The real CLI and MCP behavior tests replace helper tests. No library API change is involved.
App indexes are explicit; the package-only Jev/SCIP runner does not cover them.

```text
== issue-tracker
  definitions
    baseConfig().  ->  src/tools/issues.ts:50
    parseGetInput().  ->  src/tools/issues.ts:93
    readBaseUrl().  ->  src/tools/issues.ts:42
  references (count  symbol  file)
        1  baseConfig().  src/index.ts
        2  baseConfig().  src/tools/main.ts
        4  baseConfig().  tests/tools.test.ts
        1  parseGetInput().  src/index.ts
        1  parseGetInput().  src/tools/issues.ts
        4  parseGetInput().  tests/tools.test.ts
        1  readBaseUrl().  src/index.ts
        2  readBaseUrl().  src/tools/main.ts
```

### t03 candidate proof and remaining gate

The missing-revision regression now passes: CLI usage/code 2 gives the required flag;
stale CLI/code 1 and MCP/isError preserve exact saved detail/history.
The extended real process/browser probe passed again, including offline help, the five
stdio tools, live browser changes from both CLI and MCP, EOF 0, SIGTERM 130, and web
shutdown with live SSE. Logs: `/tmp/tracker-t03-revision-usage-before.log` (failed),
`/tmp/tracker-t03-revision-usage-after.log` (passed).

The lead ran all 15 app tests successfully on the candidate source
(`/tmp/tracker-t03-lead-candidate-tests.log`). Later test cleanups removed a private API
import and unnecessary casts, and added exact saved detail equality. Those final edits
still need the final test/check/census pass. Census targets are the app plus the changed
`examples/mcp/cli.ts`; the unchanged basic example has an existing census hit outside this task.
The corrected real CLI/MCP example also passed a search call and EOF/SIGTERM shutdown:
`/tmp/tracker-t03-example-after.log`.

The writer delivered commit `e8ddeefb3030203538acb9085d8e57d80af1d4cb`, based on
`a87cef8abcca250c3ef3f9c620724fad46661449`; its tree is clean. t03 is now Review.
The writer retracted its first report of 20 root errors and one failed validation lane.
Its fresh saved logs show 0 errors/13 warnings and all 37 lanes passing; this lead read
both logs and checked the listed lanes. The writer attributes the earlier report to
reads during its own build, while dist files were being replaced.
Logs: `/tmp/tracker-t03-root-check.log`, `/tmp/tracker-t03-validate.log`.
The lead's own pre-landing root check also passed 0 errors/13 warnings
(`/tmp/tracker-t03-handoff-root-check.log`). Final checks in the landed tree still remain.

The writer is finished and its tree is clean. Its own demo server PID 189512 was stopped;
the lead confirmed that PID is gone. The initial report remains at
`/tmp/issue-tracker-t03-report.md`; the fresh logs supersede its failed-gate claims.

The README now removes the forwarded CLI separator and says the conflict prints the
current revision. Its MCP example uses direct Node but still has an absolute-path
placeholder, so the final guide must explain replacing it or give a concrete command.
The next lead receives this immutable writer commit and all source/proof. The writer tree has a recorded 37-lane pass; final lead landing is still pending; t04/t05 and the temporary public browser preview remain
required.

## t03 complete — 2026-09-19

Code `3303f5a` is the reviewed cherry-pick of `e8ddeef`. The lead personally reviewed the
saved diff and the final tests, then ran all checks below in the private landing tree.
Node-only CLI/MCP declarations delegate to the existing HTTP operations. The running server
still owns all database writes. The browser imports no Node tool declarations.

- Fresh build passed all nine tasks with zero cache hits: `/tmp/tracker-t03-final-build.log`.
- All 15 app tests passed after the final test cleanup: `/tmp/tracker-t03-final-tests.log`.
- `vp check` passed with 0 errors/13 existing warnings; exact app + changed MCP example census
  passed: `/tmp/tracker-t03-final-check.log`, `/tmp/tracker-t03-final-census.log`.
- Fresh `node scripts/validate.mjs` passed all 37 lanes, including the real CLI/MCP library
  tests: `/tmp/tracker-t03-final-validate.log`. Library source is unchanged; no mutation run.
- Independent real stdio/Chromium proof passed against the landed tree. Five tools; live MCP
  create/edit/comment/get and CLI create reached the browser; stale CLI and MCP saves left
  exact detail/history unchanged. Missing revision returned usage/code 2. EOF exited 0,
  tool SIGTERM exited 130, and the web server exited 0 with live SSE. No browser page errors.
  `/tmp/tracker-t03-final-browser.log`, `/tmp/tracker-t03-stdio-browser-lead-result.json`.
- The fixed real MCP example served search and exited correctly on EOF/SIGTERM:
  `/tmp/tracker-t03-final-example.log`. Its earlier failing process proof remains recorded above.
- Public import and built-client scans found no private library entry or database/filesystem/
  MCP/model SDK marker in browser JavaScript. The README now explains its absolute MCP path.
- Install still reports the existing ignored esbuild build-script policy (exit 1); no policy
  change. Fresh builds, tests, and actual processes all passed.

All ten package SCIP indexes and the explicit app index passed. The removed `baseConfig`
has no refs. Retained private readers have only their owning module as callers; their old
public-index/test uses are gone. New tool/config callers match Node entry, public entry, and
public tests. Jev reported no impact block for t03; it is package-only and provides no app
coverage. Explicit app refs are the review evidence.

Removed helper:

```text
== issue-tracker
  definitions
  references (count  symbol  file)
    (none)
```

Retained private readers:

```text
== issue-tracker
  definitions
    parseGetInput().  ->  src/tools/issues.ts:73
    readBaseUrl().  ->  src/tools/main.ts:5
  references (count  symbol  file)
        3  parseGetInput().  src/tools/issues.ts
        1  readBaseUrl().  src/tools/main.ts
```

New public callers:

```text
== issue-tracker
  definitions
    /api.  ->  src/client/api.ts:14
    /commentRemote.  ->  src/tools/issues.ts:177
    /createRemote.  ->  src/tools/issues.ts:134
    /getRemote.  ->  src/tools/issues.ts:198
    /issueCommands.  ->  src/tools/issues.ts:216
    /issueTools.  ->  src/tools/issues.ts:225
    /listRemote.  ->  src/tools/issues.ts:117
    /updateRemote.  ->  src/tools/issues.ts:155
    serveIssues().  ->  src/tools/issues.ts:237
  references (count  symbol  file)
        5  /api.  src/client/api.ts
        2  /api.  src/client/sync.ts
        1  /api.  src/index.ts
        2  /api.  src/tools/main.ts
        4  /api.  tests/tools.test.ts
        1  /commentRemote.  src/index.ts
        2  /commentRemote.  src/tools/issues.ts
        1  /createRemote.  src/index.ts
        2  /createRemote.  src/tools/issues.ts
        1  /getRemote.  src/index.ts
        2  /getRemote.  src/tools/issues.ts
        1  /issueCommands.  src/index.ts
        2  /issueCommands.  src/tools/main.ts
        4  /issueCommands.  tests/tools.test.ts
        1  /issueTools.  src/index.ts
        2  /issueTools.  src/tools/main.ts
        5  /issueTools.  tests/tools.test.ts
        1  /listRemote.  src/index.ts
        2  /listRemote.  src/tools/issues.ts
        1  /updateRemote.  src/index.ts
        2  /updateRemote.  src/tools/issues.ts
        1  serveIssues().  src/index.ts
        2  serveIssues().  src/tools/issues.ts
        2  serveIssues().  src/tools/main.ts
```

## t04 caller brief — 2026-09-19

Prerequisite t03 is verified and pushed: code tag `tracker/t03` = `3303f5a`, main = `ba359e1`.
The finished t03 writer tree/branch were removed after an identical range-diff and clean check.
One private Muse contributor will implement t04 after this caller map is committed. The lead
owns final review, gates, notes, and landing. No library source changes are planned.

```text
Saved issue + discussion → read tools → owned harness session → draft stream
Person clicks Post → existing comment action → saved discussion
```

The optional run owns a session and bridges progress to its requesting view. No database
transaction spans a model turn. Only read tools reach the model. SDK presets belong in tests;
the normal app and preview keep the helper off and need no account. Stop/join the turn before
cleanup; keep local edit/comment drafts and saved history intact. Exact implementation scope
and gates are in `/tmp/issue-tracker-t04-brief.md`.

The following app callers must be preserved if optional setup extends their signatures.
New callers are expected only in app-owned triage server/client files, the public app entry,
and public behavior tests. A further public signature change requires its refs before editing.
The advisory impact tool is package-only; the explicit app index is authoritative.

```impact tracker/t04
issue-tracker buildApp(). src/server/app.ts src/index.ts src/server/main.ts tests/issues.test.ts tests/tools.test.ts
issue-tracker bootScope(). src/server/bridge.ts src/index.ts src/server/main.ts tests/issues.test.ts tests/tools.test.ts
issue-tracker Booted/Composed# src/server/bridge.ts src/server/app.ts src/server/main.ts tests/issues.test.ts tests/tools.test.ts
issue-tracker App(). src/client/App.tsx src/client/main.tsx
```

```text
== issue-tracker
  definitions
    /api.  ->  src/client/api.ts:14
    /getRemote.  ->  src/tools/issues.ts:198
    /listRemote.  ->  src/tools/issues.ts:117
    /postComment.  ->  src/client/api.ts:34
    App().  ->  src/client/App.tsx:427
    Booted/Composed#  ->  src/server/bridge.ts:22
    Booted/Save#  ->  src/server/bridge.ts:12
    bootScope().  ->  src/server/bridge.ts:62
    buildApp().  ->  src/server/app.ts:52
  references (count  symbol  file)
        5  /api.  src/client/api.ts
        2  /api.  src/client/sync.ts
        1  /api.  src/index.ts
        2  /api.  src/tools/main.ts
        4  /api.  tests/tools.test.ts
        1  /getRemote.  src/index.ts
        2  /getRemote.  src/tools/issues.ts
        1  /listRemote.  src/index.ts
        2  /listRemote.  src/tools/issues.ts
        2  /postComment.  src/client/App.tsx
        2  /postComment.  src/tools/issues.ts
        4  App().  src/client/App.tsx
        3  App().  src/client/main.tsx
        5  Booted/Composed#  src/server/app.ts
        1  Booted/Composed#  src/server/bridge.ts
        1  Booted/Composed#  src/server/main.ts
       44  Booted/Composed#  tests/issues.test.ts
        6  Booted/Composed#  tests/tools.test.ts
        3  Booted/Save#  src/server/app.ts
        5  Booted/Save#  src/server/bridge.ts
       20  Booted/Save#  tests/issues.test.ts
        1  bootScope().  src/index.ts
        1  bootScope().  src/server/bridge.ts
        2  bootScope().  src/server/main.ts
       14  bootScope().  tests/issues.test.ts
        3  bootScope().  tests/tools.test.ts
        1  buildApp().  src/index.ts
        2  buildApp().  src/server/app.ts
        3  buildApp().  src/server/main.ts
        4  buildApp().  tests/issues.test.ts
        3  buildApp().  tests/tools.test.ts
```

### t04 writer launched

Sole writer 257f478e-50bb-460e-bcfb-0ab45b1d6759, private tree
/home/paseo/next/tinkered-issue-t04, branch tracker/t04-triage-draft, base
4b0c609f8d112b8a60d48d00ac48f24032a7745f. Same workspace wks_85042cce8c480929.
Profiles were empty; fresh provider/model discovery confirmed
pi/meta-muse/muse-spark-1.3-contributor, max thinking. No reviewer agent.
The complete brief is /tmp/issue-tracker-t04-brief.md. t04 is Doing; no implementation
or live credentialed run is claimed verified. t05 and public preview remain required.
