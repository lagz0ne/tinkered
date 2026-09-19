# Issue tracker v1 — build progress

**Complete and pushed.** The realtime issue tracker is built and checked: create, edit, comments,
CLI/MCP tools, optional draft helper, reconnect, and phone use. [Plan](PLAN.md).
The [public preview](https://p-363cfc8f40e8.preview.tini.works) passed real two-tab browser checks;
it is temporary (normally eight hours). All five tickets are Done. Tag/push and writer cleanup
are verified in the [completion record](#t05-complete--2026-09-19).

| Ticket      | Delivers                                                            | Blocked by | State |
| ----------- | ------------------------------------------------------------------- | ---------- | ----- |
| tracker/t01 | [Create an issue and see it live](issues/01-create-and-see-live.md) | —          | Done  |
| tracker/t02 | [Edit, assign, and discuss issues](issues/02-edit-and-discuss.md)   | t01        | Done  |
| tracker/t03 | [Use the same actions from CLI and MCP](issues/03-cli-and-tools.md) | t02        | Done  |
| tracker/t04 | [Draft a summary with the harness](issues/04-triage-draft.md)       | t03        | Done  |
| tracker/t05 | [Finish the demo and its test guide](issues/05-finish-and-show.md)  | t04        | Done  |

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

Acceptance requires observed lead results, not a writer report alone. Per slice: app tests
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

### t05 recovery regression captured while t04 builds

The independent real-process probe /tmp/tracker-t05-reconnect-lead.mjs reproduced the
known missing reconnect behavior on the landed t03 app. After five saved edits, a tab
typed a local title/comment; the server stopped cleanly with live SSE, restarted the same
database, and accepted a new HTTP edit. The tab showed its dropped-wire alert but never
showed the new saved title. The 8-second observable browser wait failed:
/tmp/tracker-t05-reconnect-before.log.

This is before-fix evidence only. The same probe checks retained title/comment and
baseRevision 5 plus stale-save 409 once recovery works. It owns and cleans up its exact
child processes, fresh port/database, and Chromium. t05 remains blocked by t04; no fix or
preview is claimed here. The final repo test suite must preserve this behavior check.

## t05 mobile and error baseline — 2026-09-19

Lead browser probe on `0181aba` used its own temporary database, port, server,
and Chromium at 390 × 844. `/tmp/tracker-t05-mobile-lead.mjs` recorded
`/tmp/tracker-t05-mobile-before.log` and
`/tmp/tracker-t05-mobile-before-result.json`:

- Selects are 19px tall; common buttons and text inputs are 39px tall.
  t05 must make touch targets at least 44px tall.
- Stopping the actual server and submitting a create draft displays
  `RequestFailed`. t05 must give a useful plain message and retry action.
- The unsaved create title remains intact. Preserve this behavior.
- No sideways scroll or browser page errors were observed at this viewport.

The screenshot is `/tmp/tracker-t05-mobile-before.png`. The probe stopped
only its owned server and browser. This records baseline findings; t05
remains waiting for reviewed t04.

## t04 partial checkpoint — 2026-09-19

Sole contributor `257f478e-50bb-460e-bcfb-0ab45b1d6759` saved commit
`1f26f41e28c1d20493ad0f2ef31fed608e108779` in its existing private tree.
It adds the harness dependency, draft event/input types, and a draft input
error. The app dependency is linked; the required lockfile entry is saved
but not yet committed. The known ignored esbuild build policy still makes
`vp install` exit 1 after linking.

Lead `73d730b1` read this first commit. No whole-feature review or behavior
claim is made: the server draft runner, screen, and tests remain unfinished.
The same contributor is continuing in small saved steps. t04 stays Doing;
t05 still waits for a verified t04 landing.

An independent test fixture is ready at `/tmp/tracker-t04-lead-sdk.mjs`.
Its own smoke run, `/tmp/tracker-t04-lead-sdk-smoke.log`, called the real
get/list callbacks through the public harness adapter and observed abort.
This proves the review fixture only; it does not prove the unfinished t04 app.

## t04 runner review checkpoint — 2026-09-19

Contributor commits `7c2299c`, `87aeb6a`, and `6f23c3b` add the read-only
triage frame, required app lockfile link, and an owned draft runner. The
lead read all saved source. Nothing from t04 is landed or accepted yet.
There are still no draft HTTP routes, client UI, or app draft tests.

The frame correctly uses only the existing get/list tools, disables built-in
tools and filesystem settings, restricts MCP configuration, and denies
unexpected approvals. A review finding that SDK error results became empty
successful drafts was corrected in the saved source; public regression proof
is still required once the app route is wired.

The latest inspected runner (`6f23c3b`) remains in review:

- An unexpected SDK error or root-abort error can escape `settleRun` before
  watch removal, abort-listener removal, and session close. Cleanup must run
  through `finally`, with the close result inspected before any rethrow.
- A cancelled close result can also carry teardown errors. Check those errors
  for every close status, before classifying cancellation as a clean outcome.

Both findings were sent to the same writer as one bounded correction turn.
Earlier issues (already-aborted signal, unowned close promise, cast, and
success advertised before cleanup) were corrected in the inspected source.
These are source-review observations, not passing app behavior claims.

After the correction, continue with route/config wiring, the draft screen,
public SDK-preset tests, full gates and personal lead proof before landing.
The original t04 brief and pre-code caller table still apply. The writer's
small partial-turn reports are not a final implementation report.

The next source review read `d915279`: watch/listener cleanup now runs after
unexpected turn errors, the close is joined before a rethrow, and teardown
errors are checked for every close status. These two source issues are
corrected, but still await app-level proof. One related issue remains:
`runDraft` unconditionally rethrows the captured error before it uses the
inspected close outcome. Root shutdown with a live caller signal can
therefore still escape as an error even when the close result says cancelled.
The next bounded writer step must classify that close outcome first. The
app route must also show a normal failed outcome for a provider error.

## t04 lead continuation — 2026-09-19

The next lead personally read contributor commit `162853f`. The runner now
returns an inspected cancelled or failed close outcome before rethrowing an
unknown turn error. This fixes the remaining source finding; no public app
behavior is yet proven. The same sole contributor is implementing the server
composition, HTTP stream, and opt-in configuration as the next bounded step.

The lead also found that the harness status watcher forwards `done` before
cleanup is inspected. The writer will limit it to live progress and publish
terminal status only after close. UI and public adapter tests still remain.
No t04 code is landed; t05 and the temporary preview are still unfinished.
The resumed lead install recorded the known ignored esbuild build-script
policy failure in `/tmp/tracker-t04-resumed-lead-install.log`; no policy
change or provisioning was attempted.

### t04 server wiring review — not accepted

Contributor `4c4b024` limits live harness status to `running`, and `c99f729`
adds draft composition, routes, and environment opt-in. The lead read both.
The contributor reported a clean touched-file type check and client build,
but the lead's actual public Node import failed before starting a server:
`settleRun` lost `async` while still containing `await`. The full app command
`./node_modules/.bin/tsc --noEmit`, from its private app directory, exited 1
with 11 diagnostics. These also identify an input read before declaration
and an invalid Hono context type. Evidence:
`/tmp/tracker-t04-resumed-http-before.log` and
`/tmp/tracker-t04-resumed-tsc-before.log`.

The same writer is correcting these failures, stream headers/error admission,
abort-listener ownership, and an unused returned preset field. It must run
the unfiltered type check and the prepared real HTTP proof before reporting.
The lead's prepared `/tmp/tracker-t04-resumed-http-proof.mjs` and browser
probe are review aids, not passing proof or durable app tests. No t04 code
has been landed, and UI/tests remain outstanding.

### t04 server correction independently verified

The lead personally read correction `4fbd07f` and observed these commands
pass on the writer tree, with no builds running during the proof:

- App `./node_modules/.bin/tsc --noEmit`: exit 0,
  `/tmp/tracker-t04-resumed-tsc-after.log`.
- `timeout 60s node --experimental-strip-types /tmp/tracker-t04-resumed-http-proof.mjs /home/paseo/next/tinkered-issue-t04`:
  exit 0, `/tmp/tracker-t04-resumed-http-after.log` and
  `/tmp/tracker-t04-resumed-http-result.json`.

The public app entry composed real HTTP, the actual harness adapter with
a test-only SDK preset, and real get/list tool callbacks. The proof checked
read-only options and denied unexpected approvals; streamed text and final
success; SDK error results and thrown errors as failed runs with no success;
HTTP abort reaching the model; independent text for two issues; ordinary
saves while a draft waits; and full saved detail/history unchanged until
explicit comment Post. Root shutdown signalled the model and settled the
stream while the caller signal stayed live. Reopening the same database
preserved the exact saved detail. Root close reported cancelled with no
teardown errors. These are actual partial server checks, not whole t04 gates.

The same sole writer is now implementing the selected-issue draft UI.
Durable app tests, README, full gates, final lead review and landing remain.
t05 and the public preview remain unfinished.

### t04 UI checkpoint and next lead handoff

The lead personally read `b10a11d` and `e87719f`. The selected issue now
mounts `DraftView`; the shared event admission includes the terminal event.
The contributor's browser attempt initially failed in the lead probe's
Playwright import, before opening a page. The lead fixed the probe to use
Playwright's ESM entry; no app change was needed for that test setup issue.

The actual browser probe then passed on the writer tree at 390px:
`/tmp/tracker-t04-resumed-browser-first.log` and
`/tmp/tracker-t04-resumed-browser-result.json`. Cancel preserved both the
exact saved detail/history and typed edit/comment fields. Discard saved
nothing. Explicit Post used the normal comment route and appeared in a
second tab. Switching the selected issue signalled the active draft to stop
and showed no text from the previous issue. No page errors or sideways
scroll were observed. The lead inspected the phone screenshot at
`/tmp/tracker-t04-resumed-browser-phone.png`; touch-size polish is still t05.

Source/style work still remains: `DraftView` throws two bare errors, so the
strict app census failed S05 (`/tmp/tracker-t04-resumed-ui-census.log`). Its
stream reader also catches malformed frames as empty lines, and does not
explicitly release the reader lock; the next bounded writer step must use
managed errors, show a plain failure, abort a failed stream, and release
the reader. Disable Discard during an in-flight Post so a later completion
cannot clear a newly started draft. These fixes and public adapter tests
are still required. The existing 15 app tests are unchanged at this point.

No t04 commits have been cherry-picked or pushed from the writer branch.
No final t04 report or full gates exist. Continue the same writer, then
review and land t04, finish t05, and publish a verified temporary preview.
No preview or lead-owned process is left running at this checkpoint.

### t04 durable-test continuation — 2026-09-19

The next lead read the saved server, client, and composition source while the
same writer resumed the bounded public-test and UI correction step. No
second writer was created. The private landing remains at `c6c583d` before
this note; no t04 source is accepted or landed yet.

A new independent browser regression supplies malformed draft data through a
real HTTP response while the real app adapter is held in an active turn. The
old built client ignores the malformed event and never shows an alert:
`/tmp/tracker-t04-malformed-before.log`, exit 1 at the five-second alert
wait. The captured old client is `/tmp/tracker-t04-malformed-before-client`;
`/tmp/tracker-t04-malformed-lead.mjs` will check the corrected client shows
a plain error, aborts the model, and preserves exact saved detail. This is
before evidence only, not a passing result or durable test coverage.

The lead install again recorded the known ignored esbuild build-script
policy failure in `/tmp/tracker-t04-new-lead-install.log`. No install policy
was changed. t04 tests, full gates, README, landing, t05, and the public
preview remain outstanding.

### t04 corrected UI checked in the private lead tree

The lead personally reviewed `3340060` and cherry-picked the reviewed
server/UI series into the private landing tree, through `51c0a46`. These
commits are still unpublished; t04 stays Doing until durable tests, README,
full checks, and the final caller review pass.

Independent checks on this exact private landing source passed:

- Fresh ten-task app/dependency build: `/tmp/tracker-t04-ui-lead-build.log`.
- Full app type check: `/tmp/tracker-t04-ui-lead-tsc.log`, exit 0.
- Real HTTP/adapter/read-tool/cancel/shutdown/persistence proof:
  `/tmp/tracker-t04-ui-lead-http.log`, exit 0.
- Real two-tab 390px cancel/discard/post/switch proof:
  `/tmp/tracker-t04-ui-lead-browser.log`, exit 0, no page errors or overflow.
- The same malformed-stream regression that failed with the old captured
  client now passes: `/tmp/tracker-t04-malformed-after.log`, exit 0. It shows
  the plain unreadable-update alert, observes model abort, and compares
  exact saved detail unchanged. No Post button is offered for the bad run.
- Strict app style census: `/tmp/tracker-t04-ui-lead-census.log`, exit 0.

The writer is still completing the durable tests. An early review of the
unfinished fixture caught HTTP reads pointing at a closed seed scope and
lost registered tool callbacks; both findings were sent to the same writer.
The unfinished tests are not accepted and are not in the private landing.
No t04 tag, public push, t05 completion, or preview is claimed.

The later full `vp check` exited 1 on formatting in `server/app.ts`,
`server/main.ts`, and `shared/draft.ts`
(`/tmp/tracker-t04-ui-lead-check.log`). The writer must format these during
its final gate step; strict census success is not a full-check success.
The private-source/public-entry scan and built-browser scan found no private
library imports, model/database SDK markers, Node filesystem import, or
server credential/config variable in the client assets.

### t04 saved public-test review — corrections required

The lead read contributor `5c71766` and its eight new public app tests.
The tests now retain actual SDK tool callbacks and route reads to the live
app; the earlier closed-seed fixture bug is corrected. The writer reports
23 tests passing, but the lead has not rerun or accepted this commit.

The same writer received a concrete correction/finalization step:

- Add the required durable active disconnect/cancel and live-caller root
  shutdown tests. The existing already-aborted test does not prove them.
- Give each SDK registration a fresh config identity; remove casts, bare
  fixture errors, unused stored state, and excess test helpers.
- Prove overlapping issue runs through one app, with cleanup that stops held
  turns even when an assertion fails.
- Post the generated value and compare exact saved state plus the one append.
- Finish the opt-in README, app formatting, full gates, and final report.

The lead's HTTP/browser checks already prove these important lifetime paths
at the real public seam, but temporary review scripts do not replace the
missing durable regressions. `5c71766` is not cherry-picked. The source
through writer `3340060` remains staged privately through lead `51c0a46`.

### t04 finalization checkpoint at the requested context handoff

The same writer saved `e780e90` (fixture/tests and UI lint extraction),
`bc3cf45` (optional-helper README), `d641897` (fixture/cancel/root-close
corrections), and `4832118` (formatting and test dependency order). None of
these, nor `5c71766`, has been cherry-picked into the private lead tree.
The writer is still making the last review corrections; no final report
exists at this checkpoint.

The lead read the new test/UI source and observed the writer logs reporting
25 passing app tests and all 37 validation lanes passing. These are writer
logs, not an independent final gate run. Latest corrections requested are:
remove the redundant setter/runner bags passed into an already nested UI
helper; post the actual generated draft in the test; compare the issue with
the normal comment timestamp update; clean temporary databases; check an
already-aborted fixture signal; and name server-only credential setup in
the README. The writer must rerun affected checks after its final edits.

All ten package SCIP indexes and an explicit app index were refreshed in
the private lead tree. Current source callers stay within the declared app
files. Final app/test refs must be refreshed after landing the remaining
commits. Use path-delimited symbol patterns: `/App\(\)\.$` avoids matching
the suffix of `buildApp`. The t05 caller-map draft is in
`/tmp/tracker-t05-before-refs-draft.txt`; t05 is not launched.

At this checkpoint remote main is still `c6c583d`; no t04 tag or push exists.
The private lead tree is clean after this note is committed. No lead-owned
server, browser, preview, gate command, or probe is left running. The next
lead must continue the same writer and finish t04, t05, and the verified
temporary preview. The app is not complete.

### t04 resumed lead review — 2026-09-19

The writer report is saved at `/tmp/issue-tracker-t04-report.md`, with writer
HEAD `9a7906e`. The lead read the remaining source, fixture, tests, README,
and dependency diff. Source still follows the agreed public composition;
no library changes or credentialed model call are involved.

Acceptance still needs a passing normal app test command, cleanup for two
remaining temporary database paths, exact comment timestamp comparison,
and owned fetch/body outcomes in held tests. The same writer is correcting
these bounded gaps. The lead has not landed the remaining range or pushed
t04. Independent final gates follow the saved correction.

The remaining reviewed series through writer `db14d96` is now staged
privately at lead `5ba5fb2`. Fresh ten-task build and full app TypeScript
check passed. The lead's normal test run failed five 5-second timeouts
across all three app test files (including old CLI/MCP/reopen cases),
recorded in `/tmp/tracker-t04-final-tests-before-timeout-config.log`.
The same writer is adding app-scoped integration test headroom and
finishing the explicit held-request joins. No acceptance or push yet.

## t04 complete — 2026-09-19

Lead source `db4f674` matches the complete writer app/lock range through
`7228d75` exactly. The lead personally read the source, test fixture,
tests, and README before acceptance. All changes use public library
entries; browser code stays separate from Node/model/database code.
No library source or credentials were changed or exercised.

Independent checks on the private lead tree:

- Fresh dependency/app build: ten tasks, zero cache hits, exit 0.
- Full app `tsc --noEmit`: exit 0.
- Normal app test command: 25/25, exit 0. The final app config gives
  real DB/HTTP tests 30 seconds; the earlier five timeouts are preserved
  in `/tmp/tracker-t04-final-tests-before-timeout-config.log`.
- `vp check`: exit 0, zero errors and 13 existing warnings.
- Strict app style census: exit 0.
- `node scripts/validate.mjs`: all 37 deterministic lanes pass, exit 0.
- Actual HTTP/adapter tests: existing get/list callbacks and read-only
  guardrails, model failures, overlapping issue isolation, writes during
  a held run, disconnect abort, live-caller root close, joined stream,
  and unchanged saved detail after reopening: exit 0.
- Actual Chromium at 390px, two tabs: cancel/discard keep saved and local
  work; explicit Post uses the normal comment path and appears in the
  other tab; switching issues aborts the run. No page errors or overflow.
- Corrupted draft frame: visible plain error, model aborted, exact saved
  state unchanged, no Post offered. The earlier failing browser capture
  remains `/tmp/tracker-t04-malformed-before.log`. Final proof exits 0.
- Source public-import and built-client marker scans: zero violations.

Logs: `/tmp/tracker-t04-final-{build,tsc,tests,check,census,validate,http,browser,malformed,import-scan}.log`;
JSON results use `/tmp/tracker-t04-final-{http,browser,malformed}-result.json`.
`vp install` still exits 1 only for the known ignored esbuild build policy;
linking/build/checks pass. No policy change, timing claim, or mutation run.
The README names server-only opt-in and explicitly says the credentialed
live model path was not verified. Core feedback is recorded in
[the feedback ledger](../core-feedback.md).

### t04 final caller review

All ten package indexes and the explicit app index were refreshed.
Package/app logs: `/tmp/tracker-t04-final-{package,app}-scip.log`.
No old public name was removed or renamed: a removed-name `(none)` query
is not applicable. Retained names extend only the declared app callers
and public tests. New names stay in app composition/browser admission.
Exact path-delimited symbol patterns avoid the prior App/buildApp suffix
collision. Final retained table:

```text
== issue-tracker
  definitions
    /App().  ->  src/client/App.tsx:429
    /Booted/Composed#  ->  src/server/bridge.ts:24
    /Booted/Save#  ->  src/server/bridge.ts:11
    /api.  ->  src/client/api.ts:14
    /bootScope().  ->  src/server/bridge.ts:71
    /buildApp().  ->  src/server/app.ts:56
    /getRemote.  ->  src/tools/issues.ts:198
    /listRemote.  ->  src/tools/issues.ts:117
    /postComment.  ->  src/client/api.ts:34
  references (count  symbol  file)
        2  /App().  src/client/main.tsx
        4  /Booted/Composed#  src/server/app.ts
        1  /Booted/Composed#  src/server/bridge.ts
        2  /Booted/Save#  src/server/bridge.ts
        5  /api.  src/client/api.ts
        2  /api.  src/client/sync.ts
        1  /api.  src/index.ts
        2  /api.  src/server/bridge.ts
        2  /api.  src/tools/main.ts
        4  /api.  tests/tools.test.ts
        1  /bootScope().  src/index.ts
        2  /bootScope().  src/server/main.ts
       18  /bootScope().  tests/draft.test.ts
       14  /bootScope().  tests/issues.test.ts
        3  /bootScope().  tests/tools.test.ts
        1  /buildApp().  src/index.ts
        3  /buildApp().  src/server/main.ts
       10  /buildApp().  tests/draft.test.ts
        4  /buildApp().  tests/issues.test.ts
        3  /buildApp().  tests/tools.test.ts
        1  /getRemote.  src/index.ts
        2  /getRemote.  src/server/draft.ts
        2  /getRemote.  src/tools/issues.ts
        1  /listRemote.  src/index.ts
        2  /listRemote.  src/server/draft.ts
        2  /listRemote.  src/tools/issues.ts
        2  /postComment.  src/client/App.tsx
        2  /postComment.  src/client/DraftView.tsx
        2  /postComment.  src/tools/issues.ts
```

New-name table:

```text
== issue-tracker
  definitions
    /Booted/Draft#  ->  src/server/bridge.ts:16
    /Draft/Event#  ->  src/shared/draft.ts:8
    /Draft/Outcome#  ->  src/shared/draft.ts:5
    /Draft/Status#  ->  src/shared/draft.ts:3
    /DraftView().  ->  src/client/DraftView.tsx:146
    /RunDraft/Done#  ->  src/server/draft.ts:44
    /draftGuardrails.  ->  src/server/draft.ts:20
    /draftTurn.  ->  src/server/draft.ts:32
    /parseDraftCapability().  ->  src/shared/draft.ts:71
    /parseDraftEvent().  ->  src/shared/draft.ts:19
    /parseDraftId().  ->  src/shared/draft.ts:81
    /parseDraftInput().  ->  src/shared/draft.ts:91
    /runDraft().  ->  src/server/draft.ts:56
    /triage.  ->  src/server/draft.ts:13
  references (count  symbol  file)
        5  /Booted/Draft#  src/server/bridge.ts
        3  /Draft/Event#  src/client/DraftView.tsx
        1  /Draft/Event#  src/server/draft.ts
        6  /Draft/Event#  src/shared/draft.ts
        6  /Draft/Outcome#  src/client/DraftView.tsx
        4  /Draft/Outcome#  src/server/draft.ts
        2  /Draft/Outcome#  src/shared/draft.ts
        2  /DraftView().  src/client/App.tsx
        1  /DraftView().  src/client/DraftView.tsx
        2  /RunDraft/Done#  src/server/app.ts
        1  /RunDraft/Done#  src/server/draft.ts
        1  /draftGuardrails.  src/index.ts
        1  /draftGuardrails.  src/server/draft.ts
        1  /draftTurn.  src/index.ts
        1  /draftTurn.  src/server/draft.ts
        2  /parseDraftCapability().  src/client/DraftView.tsx
        2  /parseDraftEvent().  src/client/DraftView.tsx
        1  /parseDraftId().  src/index.ts
        1  /parseDraftId().  src/shared/draft.ts
        1  /parseDraftInput().  src/index.ts
        2  /parseDraftInput().  src/server/app.ts
        2  /parseDraftInput().  src/server/draft.ts
        1  /runDraft().  src/index.ts
        2  /runDraft().  src/server/app.ts
        2  /runDraft().  tests/draft.test.ts
        1  /triage.  src/index.ts
        3  /triage.  src/server/draft.ts
```

`env -u AI_GATEWAY_API_KEY JEV_TOKEN_FILE=/dev/null node scripts/jev/impact.mjs tracker/t04 4b0c609..HEAD`
ran advisory-only, without credentials or a model request. Its
package-relative path/name handling reports missing app symbols; direct
app refs above prove those definitions/callers exist. Full output is
`/tmp/tracker-t04-final-impact.log`; the lead did not accept its false
missing-name claims or claim a clean advisory result.

## t05 caller brief — before implementation

Baseline source `db4f674`; t05 may extend the app connection shape and
retry props without remounting local issue/create/comment draft owners.
The writer must edit from this app map and obtain a fresh map before
changing any additional exported signature. No library signature change
is planned.

```impact tracker/t05
issue-tracker /App(). src/client/App.tsx src/client/main.tsx
issue-tracker /connectTab(). src/client/sync.ts src/client/main.tsx
issue-tracker /TabSync/Connected# src/client/sync.ts src/client/App.tsx
```

```text
== issue-tracker
  definitions
    /App().  ->  src/client/App.tsx:429
    /TabSync/Connected#  ->  src/client/sync.ts:9
    /connectTab().  ->  src/client/sync.ts:53
  references (count  symbol  file)
        2  /App().  src/client/main.tsx
        2  /TabSync/Connected#  src/client/App.tsx
        1  /TabSync/Connected#  src/client/sync.ts
        3  /connectTab().  src/client/main.tsx
```

### t04 remote proof and t05 launch

Remote main and tag `tracker/t04` both resolve to
`ea73244c0612dc0d85f6449ee9809c1cbad3fb66`. The finished t04 writer was
archived only after its clean app/lock tree matched the landed source.
Its worktree and branch were then removed. No registered checkout was
changed.

One t05 writer `ade1b488-b3f8-4c59-a198-004a9bf5551d` now works in
`/home/paseo/next/tinkered-issue-t05`, branch `tracker/t05-finish`, from
`ea73244`. Profile discovery found no profiles; provider/model discovery
confirmed `pi/meta-muse/muse-spark-1.3-contributor`, thinking `max`.
The same existing Paseo workspace is used. Full brief:
`/tmp/issue-tracker-t05-brief.md`. Lead owns review, gates, landing, and
the verified temporary public preview. No preview exists yet.

### t05 independent recovery baselines

At accepted t04, `/tmp/tracker-t05-retry-lead.mjs` uses the actual app
HTTP server plus Chromium and returns HTTP 503 at the transport boundary.
The startup case exits 1 waiting for a visible Reconnect button; the
capability case exits 1 waiting for a failure alert because the failed
helper check currently appears as off. Logs:
`/tmp/tracker-t05-startup-before.log` and
`/tmp/tracker-t05-capability-before.log`. Both are already-scoped t05
recovery promises. The same writer has the probes; final runs must use
separate output paths. These baselines own and close their servers,
browsers, and roots; no lead process remains running.

### t05 lead handoff checkpoint

At the user's requested context handoff point, t04 is accepted and pushed.
T05 remains Doing with the same writer `ade1b488`. Its last inspected tree
was clean at base `ea73244`; no t05 report or saved implementation was
available yet. The new lead must continue that writer, personally review
its final source, independently run gates, land/push, and verify the
actual temporary public preview. No new writer or reviewer is needed.

The outgoing lead has no running server, browser, gate, probe, or preview.
The exact continuation is in `/tmp/issue-tracker-t05-lead-handoff.md`,
which supersedes the t04 finalization handoff. Parked lanes stay parked.

### t05 lead continuation

The handoff completed with the same running writer `ade1b488` and the
same private lead tree at `6713434`. The new lead read the active brief,
recovery probes, browser proof, and preview workflow. Source review and
final acceptance remain pending; no t04 re-review is needed. Initial
`vp install` again exits 1 only for the known esbuild build-policy entry
(`/tmp/tracker-t05-lead-setup-install.log`); policy was not changed.

The new lead's real-browser offline probe covers create, edit, comment,
and detail in one page. Accepted t04 retains all typed drafts but shows
RequestFailed in all four notices. The decisive failure is
/tmp/tracker-t05-errors-baseline.log with
/tmp/tracker-t05-errors-baseline-result.json; the same writer received
it. Earlier diagnostic runs hit an exact-label locator issue, fixed by
using the textbox role. No app failure claim rests on those locator runs.
Final proof must use separate AFTER output.

### t05 saved reconnect checkpoint

The lead reviewed the actual source from writer commits a579d37 and
0c0e08e and staged them in its private branch as 1331d29 and a27bf2c.
Nothing from t05 is pushed or accepted yet. App, provider, and issue-form
owners stay mounted as the scope changes. Close joins the transport tail;
the startup catch inspects the close result. Review corrected a hidden
close notice and an empty rejection handler before staging.

The fresh 10-task build (zero cache hits) and full app TypeScript check
both exit 0 in the private lead tree:
/tmp/tracker-t05-checkpoint-build.log and
/tmp/tracker-t05-checkpoint-tsc.log.

The writer stopped at a partial checkpoint; the same agent received a
concrete follow-up to finish helper retry, mobile controls/times, durable
browser proof, final docs, gates, and report. No new writer or workspace.
The reported earlier 720 missing-dist errors are writer observations,
not a lead baseline finding. Lead source builds succeeded before its checks.

Independent lead AFTER checks at a27bf2c all exit 0:

- Reconnect after real process restart shows revision 6, keeps the local
  title and comment, sends the original baseRevision 5, and receives 409.
  Both server shutdowns exit 0; no browser page errors.
- Real browser offline create/edit/comment/detail now show plain errors
  and retain all typed work. Online edit and comment retries succeed.
- Initial HTTP 503 shows Reconnect; retry loads the real saved list.

Logs and result JSON share these prefixes:
/tmp/tracker-t05-reconnect-checkpoint,
/tmp/tracker-t05-errors-checkpoint,
/tmp/tracker-t05-startup-checkpoint.
Their failing BEFORE artifacts remain unchanged. Helper capability retry,
phone layout, durable proof, and final gates are still pending.

### t05 saved phone/helper checkpoint

Writer 51f9fc5 is staged as e24bfad. The lead's phone probe and
helper-capability HTTP 503/retry probe both exit 0; the phone screenshot
was inspected. All controls meet 44px height, no horizontal overflow or
page errors were seen, failed capability is distinct from disabled, and
the typed edit survives Retry.

Proof prefixes: /tmp/tracker-t05-mobile-checkpoint and
/tmp/tracker-t05-capability-checkpoint. Fresh app build exits 0 at
/tmp/tracker-t05-phone-checkpoint-build.log.

The first lead check failed only on its two changed Markdown files;
targeted formatting fixed that. The next check exits 0 with 15 warnings
(/tmp/tracker-t05-phone-checkpoint-check-after-format.log). Two are NEW
floating capability promises in DraftView.tsx, already returned to the
same writer with the visible loading/unmount ownership correction. Do not
call them pre-existing or accept this as the final clean gate.

### t05 durable proof review

Writer 7bd7772 fixes visible helper loading and its two floating-promise
warnings, but is not staged yet. The lead found the first browser proof
used direct HTTP for its claimed CLI step, bypassed browser Save for the
reconnect revision check, and arranged a stale form as the conflict winner.
Its child/process/temp ownership and unsafe casts also need correction.
The same writer has the collected review at
/tmp/issue-tracker-t05-browser-review.md. Required helper lifecycle and
keyboard scenarios must be durable in the committed command, not only in
older temporary lead probes. Capability request cancellation also remains
in that review.

The app recovery probes already pass; these findings concern the accuracy
and completeness of the durable proof plus pending request ownership.
No final t05 acceptance, push, tag, or public preview exists yet.

### t05 second lead handoff checkpoint

At the requested context handoff point, the private lead source is e24bfad
(writer 51f9fc5); writer 7bd7772 and ec4b2d4 remain UNSTAGED and unaccepted.
The actual ec4b2d4 browser source still contains wrong exact row selectors,
a wait for detail before opening it after reload, a toggle that closes the
second detail, an incorrect pre/post-winner revision comparison, two
OwnedServer casts/early ownership clearing, and a shutdown block that has
no client route or held SDK turn. The same active writer has the precise
follow-up /tmp/issue-tracker-t05-browser-review-2.md. Do not accept its
earlier claims that these are already resolved; inspect later actual source
and a real passing command.

Fresh normal app tests at staged e24bfad pass 25/25
(/tmp/tracker-t05-checkpoint-tests.log); strict app census passes
(/tmp/tracker-t05-checkpoint-census.log). These do not accept the unlanded
browser proof or replace final gates. No lead probe/server/browser remains
running. No public preview exists. T04 is done and needs no re-review.

The next lead must finish the SAME writer, review fixes and all durable
helper cases, then complete final gates, SCIP, Core feedback, README,
landing/tag/push and verified public preview. Self-contained continuation:
/tmp/issue-tracker-t05-proof-lead-handoff.md. It supersedes older handoffs.

### t05 browser proof checkpoint — 2026-09-19

The lead personally reviewed the saved proof and corrected its real selectors,
SDK turn ownership, held Post assertions, same-database reopen, and cleanup.
The reconnect proof now keeps the original viewer across one restart, after
many saved updates, so the new server begins at a lower source version.
The browser's own stale Save must still carry its old revision and receive 409.

Reviewed writer commits staged on the PRIVATE lead branch:

| Writer  | Private lead |
| ------- | ------------ |
| 7bd7772 | df0992a      |
| ec4b2d4 | bf4ee29      |
| c6ea16e | 55c4333      |
| c045239 | 3f749b8      |
| 587a759 | 39922de      |
| 1ad20c8 | 2b831b0      |

At 2b831b0, the lead's fresh app build and full test:browser command both
exit 0. The command runs the owned process/UI/CLI/restart proof, followed
by all seven real-browser helper tests. Logs:
/tmp/tracker-t05-proof-checkpoint-build.log and
/tmp/tracker-t05-proof-checkpoint-browser.log.
The helper cases cover cancel, Post, view close, discard, held Post controls,
malformed-stream abort with unchanged saved detail, and shutdown/reopen.

All ten package SCIP indexes were rebuilt successfully:
/tmp/tracker-t05-final-package-index.log. The app review index also succeeded
(/tmp/tracker-t05-review-app-index.log), but must be refreshed for the final
staged source. The old exported names are retained with changed signatures;
they must not be falsely reported as absent. The added Connected.close
has one App caller. Full actual reference tables belong in final acceptance.

Writer 5a12482 saves the final README, package description, and examples link;
it is NOT staged or reviewed here yet. The same writer is running final gates
and preparing its report. Full lead gates, final source scans/SCIP, Core
feedback, tag/push, and a verified public preview remain. No t05 code is pushed.
No lead-owned process remains after the passing browser command.

The next lead continues the whole task at the user's requested context
handoff point. The self-contained current briefing is
/tmp/issue-tracker-t05-final-lead-handoff.md; it supersedes older handoffs.

### t05 final acceptance — 2026-09-19

The lead accepted the final actual source and guide at `2f9db43`, equal to writer
`5a12482` for `apps/issue-tracker` and `examples/README.md`. Only that last docs
commit was newly cherry-picked (`5a12482` → `2f9db43`); earlier source was already
reviewed and staged through `2b831b0`. The README commands, behavior, public-library
map, and local link targets were checked. All work stayed in the private lead tree.
No library source changed; no mutation or wall-clock performance claim was made.

Independent lead gates on the final staged app:

| Check                                                         | Observed result                                                                     | Evidence                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| `vp install`                                                  | Exit 1 solely for the known ignored `esbuild@0.28.2` build policy; policy unchanged | `/tmp/tracker-t05-final-install.log`  |
| `vp run --no-cache --filter '@tinker-issue-tracker...' build` | Exit 0, all 10 tasks, no cache hits                                                 | `/tmp/tracker-t05-final-build.log`    |
| App `./node_modules/.bin/tsc --noEmit`                        | Exit 0, full app check                                                              | `/tmp/tracker-t05-final-tsc.log`      |
| `vp run --no-cache @tinker-issue-tracker#test`                | Exit 0, 25/25 tests                                                                 | `/tmp/tracker-t05-final-tests.log`    |
| `vp run --no-cache @tinker-issue-tracker#test:browser`        | Exit 0, real process/UI/CLI/restart proof, then 7/7 helper cases                    | `/tmp/tracker-t05-final-browser.log`  |
| `vp check`                                                    | Exit 0, 0 errors and 13 existing warnings                                           | `/tmp/tracker-t05-final-check.log`    |
| Strict app style census                                       | Exit 0, OK                                                                          | `/tmp/tracker-t05-final-census.log`   |
| `node scripts/validate.mjs`                                   | Exit 0, all 37 deterministic lanes                                                  | `/tmp/tracker-t05-final-validate.log` |

The first final check only caught formatting in the lead's TODO edit; targeted
formatting and the repeated check passed. That earlier result is preserved at
`/tmp/tracker-t05-final-check-before-todo-format.log`. Writer logs were kept under
`/tmp/tracker-t05-writer-final-*.log`; the table above records the lead's own runs.

The independent final probe runner also exits 0. Its reconnect case restarts the
real server and keeps local title/comment/baseRevision 5 while the new saved
heading is revision 6. The browser's own Save sends revision 5 and gets 409; both
server exits are 0. Offline create/edit/comment/detail notices are plain, text is
kept, and online retries succeed. Initial connection and helper-capability HTTP
503 failures recover through their visible retry buttons. The malformed helper
stream aborts its held turn and leaves exact saved detail unchanged. Before
failure artifacts remain separate and unchanged.

Final probe logs use `/tmp/tracker-t05-{reconnect,mobile,startup,capability,errors,malformed}-final.log`.
The 390px phone screenshot `/tmp/tracker-t05-mobile-final.png` was personally
inspected: readable fields, all controls at least 44px tall, no horizontal overflow,
and no browser page errors. Source/public-library and built-client server-marker
scans found zero violations (`/tmp/tracker-t05-imports-final.log`); test imports
also use public app/library entries (`/tmp/tracker-t05-final-test-imports.log`).

All ten package indexes were rebuilt, plus the app explicitly from its own cwd:
`/tmp/tracker-t05-final-package-index.log` and `/tmp/tracker-t05-final-app-index.log`.
No old exported name was removed or renamed: App, connectTab, and TabSync.Connected
are retained with changed signatures/fields, so reporting their old names as
`(none)` would be false. Compared with the committed BEFORE map, App still has
its main entry caller; reconnect adds App's connectTab callers and the Connected
close field. Final retained-symbol query:

```text
scripts/scip.sh refs '(/(App|connectTab)\(\)\.|/TabSync/Connected#)$' issue-tracker
== issue-tracker
  definitions
    /App().  ->  src/client/App.tsx:449
    /TabSync/Connected#  ->  src/client/sync.ts:10
    /connectTab().  ->  src/client/sync.ts:56
  references (count  symbol  file)
        2  /App().  src/client/main.tsx
        4  /TabSync/Connected#  src/client/App.tsx
        1  /TabSync/Connected#  src/client/sync.ts
        2  /connectTab().  src/client/App.tsx
        4  /connectTab().  src/client/main.tsx
```

New close-field query:

```text
scripts/scip.sh refs '/TabSync/Connected#.*:close\.$' issue-tracker
== issue-tracker
  definitions
    /TabSync/Connected#typeLiteral0:close.  ->  src/client/sync.ts:13
  references (count  symbol  file)
        1  /TabSync/Connected#typeLiteral0:close.  src/client/App.tsx
```

The Jev impact advisory ran with `AI_GATEWAY_API_KEY` unset and
`JEV_TOKEN_FILE=/dev/null`. It made no model call. Its package-path/plain-name
matching reports four false missing rows for the app; the explicit app SCIP
queries above are authoritative. Evidence: `/tmp/tracker-t05-final-impact.log`.
Core feedback keeps the positive stable-provider reconnect result; the census
fixture classification is tooling feedback, and the existing CLI public seam
already supplies in-process argv testing. No new core ticket is needed.

The actual public preview was started from the private app with a fresh temporary
database and `DRAFT_HELPER=0`:
[Open the issue tracker](https://p-363cfc8f40e8.preview.tini.works).
The normal lifetime is eight hours from launch on 2026-09-19 around 21:17 UTC.
`curl -fsS` fetched real app HTML and confirmed the helper is disabled. The lead
then drove two real Chromium tabs through that public HTTPS URL: keyboard create,
status/assignee edits, live comments, reload persistence, a stale browser Save
with baseRevision 0 rejected as 409, exact saved detail/history unchanged, local
text retained, and explicit Reload their change. Phone and desktop screenshots
were personally inspected. All controls meet 44px; no overflow or page errors.
The fresh demo contains only the safe example “Keep search text after reload”.

Public proof: `/tmp/tracker-t05-public-proof.log`,
`/tmp/tracker-final-preview-result.json`, and
`/tmp/tracker-final-preview-{phone,desktop}.png`.
Launch ownership: `/tmp/tracker-t05-public-launch.log`, preview PID `346306`;
leave it running through normal expiry. The helper script lacked execute permission,
so it was run with `sh`; no shared file was changed. A first HTML assertion expected
an empty root and was corrected to accept the actual Loading placeholder; the real
browser proof passed without an app change.

The optional helper's credentialed live model was not exercised. Its real browser
lifecycle cases use the public SDK preset only in test files. The default demo
needs no external account. The remaining tag/push and writer cleanup were then completed below.

### t05 complete — 2026-09-19

All five issue-tracker slices are complete. Final source and guide were accepted
at `2f9db43`; the acceptance record is committed as
`ab4b0f829711258cf25e479e2bb911fb52b85a76`.
The lead fetched remote main, confirmed a fast-forward from `6713434`, then
atomically pushed private `HEAD:main` and annotated tag `tracker/t05`.
`git ls-remote` independently verified:

```text
main at acceptance: ab4b0f829711258cf25e479e2bb911fb52b85a76
tracker/t05 commit: ab4b0f829711258cf25e479e2bb911fb52b85a76
tracker/t05 tag object: b9f3212cf294124e94558ffd79a776b638f8e771
```

Evidence: `/tmp/tracker-t05-acceptance-remote.txt`. The final Done notes follow
that tag on main; no app source changed after the passing gates and public proof.
Acceptance-document `vp check` also passed with 0 errors and the same 13 warnings
(`/tmp/tracker-t05-acceptance-check.log`). All 70 local Markdown link targets checked
exist (`/tmp/tracker-t05-final-doc-links.log`).

Only after the push was verified, the same writer
`ade1b488-b3f8-4c59-a198-004a9bf5551d` was archived successfully. Its tree was clean
at `5a124823b28fcab448a44bfd98bc05bb5accb1be`. Its full app and examples changes
exactly matched the accepted lead tree. The clean worktree
`/home/paseo/next/tinkered-issue-t05` and branch `tracker/t05-finish` were removed.
The registered checkout, other leads, and parked lanes were not changed.

[Use the verified public issue tracker](https://p-363cfc8f40e8.preview.tini.works).
The preview remains running with safe demo data and the optional model helper off.
It normally expires about eight hours after its 2026-09-19 21:17 UTC launch.
Public two-tab/reload/conflict and phone/desktop results are recorded in final
acceptance above. There is no remaining approved tracker work.
