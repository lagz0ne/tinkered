# Start scaffold

Owner: lead (Codex, Start scaffold session).
Status: runnable native proof complete; full inspection remains open.

## Request

Design a TanStack Start scaffold using only Core and React from Tinker.
Use native middleware for scope lifetime.
Keep backend and frontend apart.
Use Better Auth, Drizzle with Postgres, mail, Pino, and a Tinker devtool.
Show the graph and rationale before writing app code.

## Design

[Graph and rationale](DESIGN.md).
[Open the graph](https://diashort.tini.works/d/6bb9fd78).

The user chose one Start app with separate modules and strict build rules.
The user then asked for proof code to inspect.
A writer built that proof on branch `start/poc`.
The worktree is `/tmp/tinkered-start-poc`.
[Writer target](POC-BRIEF.md).
The reviewed code is now in `apps/start-scaffold` in the main workspace.
[Run and read the proof](../../../apps/start-scaffold/README.md).
[Open the temporary preview](https://p-6b63623651fe.preview.tini.works).
[Edit the scope bridge](https://tldraw.tini.works/r/68c409f0ab62460c9394a5c99f1f0635).
[Read the scaffold source](https://p-df4b02e60895.preview.tini.works/scaffold.html).

## Findings

- Core supports named units, resource targets, call signals, and traces.
- The Start bridge must own streamed response lifetime.
- Domain tests can run through Core without booting Start.
- React's provider-created scopes and sessions start in effects.
  Server-rendered content needs an entry-owned provider.
- Core lacks a full live scope graph inspection API.
  Its resolve hook does not see all dependency or session reads.
- React's `useSpans` does not subscribe to new spans.
  Full live observation must be native, rather than guessed by app helpers.

## Proof

The diagram service returned shortlink `6bb9fd78`.
The source is saved in `graph.mmd`.
Both the public page and embedded diagram return HTTP success.
Primary docs for Start, Better Auth, Drizzle, Node, and Pino were checked.
The design, track, and brief pass prose with 0 hits.
They also have 0 wide table rows or fenced lines.
`vp run prose` passes for all 176 tracked Markdown files.

The first workspace build failed because installed Node types were stale.
`vp install` restored nine missing packages without changing the lockfile.
The refreshed workspace build passes all 24 tasks.
`vp check` passes with 0 errors and 28 existing warnings.
All 31 package test tasks pass.

These are baseline checks, before the new app is copied back.

Writer commit: `a7b6f768`.
Form race fix: `244533c8`.
Only the new app and lockfile changed in that commit.
Core and React source stayed unchanged.
The writer's build and check pass with the same 28 existing warnings.
All eight app tests pass through the public backend or transport entry.
The deliberate browser import of backend code fails the build.
Prose, strict style census, and TSDoc checks pass.

The browser proof passes at a phone width of 390 pixels.
It signs up, saves a name, reloads it, signs out, and signs in again.
A wrong password followed by a good retry works.
Completed spans appear for backend and frontend actions.
The page has no script errors or sideways scroll.
Production signup and signed-in server rendering also pass on the built Node host.

Lead review found a pending stream read could win over forced cancellation.
The new active-work cancellation test timed out before the fix.
It passes after forced close starts before cancelling the reader.
Pages kept by the browser for Back and Forward retain their view root.
Importing the Node host starts no server.

Jev review reports one advisory flag on the backend process singleton.
It has no call input to include in a cache key.
It retains one root by design and starts nothing at import.
No shared judge labels changed.
The other advisory notes concern settings, cleanup, migration, and the stream adapter.
Settings already come from tags.
Native client cleanup already runs in resource `defer` callbacks.
Migration is an action that calls the native driver.
The stream adapter keeps an existing request alive; it creates no scope.

After transfer, the main workspace build passes all 25 tasks.
All 32 workspace test tasks pass.
The backend import guard passes its deliberate browser leak check.
The four new Markdown files pass prose and phone layout checks.
All 34 authored TypeScript files pass TSDoc checks.
The strict style census passes.

Local proof mode uses PGlite and records mail.
Network Postgres and SMTP delivery were not tested.

## Database belongs to userland

The user asks whether the database belongs to userland.
The existing backend database is already a Core resource.
The app owns the driver, settings, schema, and migrations.
The Start bridge owns scope lifetime and resolves these app units.
The source preview had hidden the shared app database setup with fixed Start code.
That hid code the app author owns.

The preview now shows seven full source files.
Its new Database tab shows `src/backend/database.ts` exactly.
No app TypeScript changed for this correction.
The same editable graph now has a linked Database resource box.
Its arrow is bound to the backend actions and the database.
The previous five boxes keep their positions and links.
[Source page](https://p-df4b02e60895.preview.tini.works/#todo-database).
[Editable graph](https://tldraw.tini.works/r/314eb38f07b44c469c2007bef0c558ea).

The browser proves all seven tabs match their real source files.
Only one file is shown at a time.
TSX colors, no line numbers, phone width, and the embedded editor pass.
There are no page errors.
The authored source census passes; the generated Router file is excluded.
The prose check passes all 176 tracked files.
The changed task documents have no prose hits or wide lines.
No build or app test was rerun: this change only reveals existing code.
Browser log: `/tmp/tinkered-database-userland-browser.log`.

## Input and current-user correction

The user found a manual input read and an identity operation.
The precedent is Core's raw and trusted input rule.
Raw form input goes to the operation through `rawInput`.
Core runs its declared input reader and records a failed parse.
Raw network input goes through native Start `inputValidator`.
Start passes that result to the backend operation as trusted `input`.
Internal calls with typed values keep `input` and skip another parse.

The current account is a request fact, so it belongs in a session resource.
`principal` remains nullable for the signed-out account page.
`currentUser` requires that principal and raises `SignInRequired` if absent.
Private list reads, todo changes, and profile saves depend on `currentUser`.
They read its ID without running an identity operation.
The private write starts only after that resource resolves.

The same editable graph now names both input edges and the user resource.
The lead owns the source preview; the writer owns only the app.
Current caller list and proof steps are in [the brief](INPUT-USER-BRIEF.md).
Writer commit: `0ef74c28` on `start/poc`.
The lead reviewed and copied its five app files into the main workspace.
No new package, dependency, scope helper, or middleware layer was added.
No transaction or auth failure changed its managed error kind.
Core wraps refused raw input in `DataValidationFailed`.
The failure action reads its `BadInput` cause and keeps the clear message.

The writer's eleven public-operation tests pass.
They keep private rows apart and refuse signed-out writes before transactions.
The main build passes all 25 tasks.
The main check has 0 errors and the same 28 existing warnings.
Native middleware dedupe and the browser import guard pass.
All 44 authored TypeScript files pass TSDoc; strict census passes.
Jev's two flags refer to unchanged auth settings and transaction cleanup.
The settings come from a tag; the transaction resource awaits its cleanup.
The lead read both declarations and the saved report.

The browser proves a blank title yields a failed `todos.save` span in Core.
The same check fails with the old todo view in an isolated local app.
Its message still works, but its failed span is absent.
That local baseline was stopped after the comparison.
A valid retry and reload pass with the fixed view.
Phone CRUD and a same-tab account switch also pass with no script errors.
The source preview proves all six visible files match the copied code.
The same saved graph shows raw form and network input reads and the user resource.
All 32 package test tasks pass when run one task at a time.
The lead observed exit code 0 and eleven passing app tests.
Prose passes 176 tracked files and all seven task Markdown files.
The task Markdown has no wide code lines or table rows.

Main logs use `/tmp/tinkered-input-user-main-` and name each gate.
Regression proof uses `/tmp/tinkered-input-user-regression-`.
Its `before.log` fails at the missing span; `after.log` passes.
Phone CRUD proof: `/tmp/tinkered-input-user-crud-browser.log`.
Source proof: `/tmp/tinkered-input-user-source-browser.log`.

## Todo input declaration and flow states

The user wants the write's input type to come from its declaration.
The private write now declares the same todo reader as the public change.
Its callback input is inferred; no context type annotation remains on that write.
The write takes the owner from `currentUser`, not an input field.
The public change still resolves that resource before the private write can start.
It passes trusted input to the write, so the reader does not run again.

The user also asks for distinct object cases to show the browser flow.
The precedent is the repo's lifecycle rule: a union with a `kind` field.
The todo flow is one Core data value: idle, saving, or failed.
Only failed carries a message.
The save action enters saving; its cleanup returns to idle.
The failure action records failed with the input message or retry text.
A retry clears that failure by entering saving.
React reads and narrows the value; no extra boolean or message cell remains.
Native Start still owns route loading and the saved rows.

Writer commit: `1a14da25` on `start/poc`.
The lead reviewed and copied its two source files into the main workspace.
The current brief is [todo input and flow states](WRITE-INPUT-BRIEF.md).
The same saved graph names the state cases and the input reader with its user resource.

The writer's eleven public-operation tests pass.
Private rows stay apart; signed-out writes open no transaction.
The main build passes all 25 tasks.
The main check has 0 errors and the same 28 existing warnings.
The lead observed exit code 0 for all 32 test tasks.
All 44 authored TypeScript files pass TSDoc; strict census passes.
Jev's existing transaction cleanup flag is a false positive.
The resource owns and awaits commit or rollback.
No new Start boundary or middleware code changed, so their checks were not repeated.
The browser proves saving disables the form and success enables it again.
The failure message clears when a valid retry enters saving.
Blank input still shows its message and a failed Core span.
A successful retry survives a reload.
Two accounts still pass create, check, delete, reload, and same-tab account switch.
The source preview shows all six exact, highlighted files and the embedded graph.
There are no script errors or sideways scroll.
The first browser probe ran before the route's form was ready.
It now waits for that form before watching its controls; all three browser checks pass.
Prose passes 176 tracked files and all eight task Markdown files.
The task Markdown has no wide code lines or table rows.

Logs use `/tmp/tinkered-input-states-` and name each gate.
The panel shows completed span snapshots, rather than a full live graph.
Full native inspection and cross-side trace propagation remain open.
The preview worktree stays in place while its temporary link is live.

## Native middleware revision

The user asked for the skills bundled with Start to be wired into agent instructions.
They also asked for native middleware context and deduplication.
The middleware must belong to a Core extension.
The server entry connects its installed extension to Start's request context.
An unbound middleware must fail before opening a request session.
No app AsyncLocalStorage or middleware-owned backend startup remains.
Only the native Start boundary may carry the scope or session.
Domain operations still receive only their input and declared dependencies.
The user also requested shadcn styling and an editable Excalidraw graph.

Writer revision: `254aec45`.
The middleware is attached to `startRequests` and uses native Start context.
An unbound call raises `StartScopeMissing` before `next` runs.
The built Start proof makes two calls in each of two concurrent SSR requests.
Each request runs its shared middleware once and keeps its own session and headers.
Middleware declarations stay separate from server function declarations.
The Start compiler can otherwise split their module and create two identities.

Pino is now a resource with fixed settings from a tag.
Native Node flush is awaited during cleanup.
Native browser Pino still works without a Node transport.
Shadcn Button, Input, and Card use Tailwind.
Core continues to own form state and actions.
Start's bundled skills are selected by the app's Intent settings.
The app's `AGENTS.md` gives the exact Vite+ load commands.

The writer's build, check, eight tests, import guard, and native middleware proof pass.
Prose, strict census, and TSDoc checks also pass.
The restored stream race fails its regression in an isolated copy.
The fixed cancellation path passes.
Jev's new Pino note is advisory: native cleanup owns and awaits flush.
No shared judge labels changed.

All six Excalidraw boxes name their source and link to the code preview.
The source preview returns HTTP 200.
The user's changes to box positions were kept.
The user confirmed that tini.works services are theirs.
Source publication passed approval review after that confirmation.

The heading fix is saved in writer commit `4079acbb`.
The lead reviewed and copied the final app and lockfile into the main workspace.
The phone browser flow passes with the native bridge and shadcn controls.
It covers signup, save, reload, signout, failed sign-in, and a good retry.
Backend and frontend spans appear, with no script errors or sideways scroll.
The main build passes all 25 tasks.
The main check has 0 errors and the same 28 existing warnings.
The native middleware proof and deliberate browser import guard both pass.
All 37 authored TypeScript files pass TSDoc; the strict census passes.

The first recursive test run timed out in Drizzle's existing PGlite cleanup hook.
All 43 Drizzle tests pass when run alone.
The full package test run passes all 32 tasks with one task at a time.
Its exit code is 0.
No existing test or timeout setting was changed.

The user asked for code colors and a small Swiss layout in the source preview.
It now shows one highlighted file at a time and hides line numbers.
The browser proves exact source text, phone width, small type, and tab changes.
The same page now embeds the saved Excalidraw editor above the code.
Edits still use the same board, with the user's box positions kept.
The embedded editor loads in the real browser with no script errors.
The highlighted source is built into the static page; no remote script is needed.

Final logs use `/tmp/tinkered-start-native-` and name each gate.
The full test proof is `main-tests-serial.log`.
The browser proofs are `browser-proof.log` and the source page's own log.
The source page's log is `/tmp/tinkered-start-source-browser.log`.
The live app and source page remain running in their preview processes.

The live inspection gap is recorded in [Core feedback](../core-feedback.md#live-scope-inspection--2026-10-02).
The next full scaffold step is native live inspection and trace propagation.
Native inspection changes need an impact block before their code.

## Private todo feature

The user asks to see the smallest app code after scaffolding.
They chose one private todo list per account.
The precedent is the profile's existing owner check and committed write.
Backend queries derive the owner from the auth session.
The feature can list, add, check, delete, and reload todos.
It reuses the existing scope, auth, database, and log setup.

The code preview shows only six feature source files.
The feature's native Start endpoints remain visible: they are app wiring.
Entry, middleware, auth client setup, connections, mail, and logs stay out of that view.
The graph shows the view, browser actions, endpoints, backend actions, and table.
[Edit the feature graph](https://tldraw.tini.works/r/314eb38f07b44c469c2007bef0c558ea).
[Writer brief](TODOS-BRIEF.md).

Writer commit: `85a93399` on `start/poc`.
The lead reviewed the feature and copied it into the main workspace.
The six visible files hold the table, input, backend actions, endpoints, view, and route.
Small setup edits export actions, register the schema and error, and add the account link.
The generated migration creates the table beside Better Auth's tables.
The scope bridge and app startup need no feature edits.

The server derives the owner from the signed-in account.
Every list, update, and delete filters by that owner.
Missing rows and another account's rows return the same error.
Auth runs before the write opens a transaction.
The route owns saved rows; Core data holds pending and error state.
A write waits for commit, then reloads the route's rows.
Inactive route rows are dropped to avoid showing the prior account's list.

The writer's eleven app tests pass through public operations on a scope.
They use real Better Auth and Drizzle with PGlite.
Two accounts cannot change each other's rows by guessing an ID.
Signed-out writes open no transaction.
Empty titles, long titles, and caller-selected owners are refused.

The phone browser passes add, check, delete, and reload.
Two accounts keep separate rows.
Signing out and switching accounts in the same tab shows only the new account's rows.
There are no script errors or sideways scroll.
The blank-title message and a valid retry also pass in the browser.
The retry survives a reload.
The source page proves all six files match the saved code exactly.
It has TSX colors, no line numbers, and the embedded editor.
The old scaffold source is kept on a separate archive page.

The main build passes all 25 tasks.
The main check has 0 errors and the same 28 existing warnings.
Native middleware dedupe and the deliberate browser import guard both pass.
All 44 authored TypeScript files pass TSDoc; the strict census passes.
Jev reports 0 file flags, 0 test flags, and no missing README promises.
Its one cleanup flag on `writeTodo` is a false positive.
The reused transaction resource owns and awaits commit or rollback.
The lead read that resource and the saved report.
Shared judge labels stay unchanged, as the proof brief requires.
Prose passes all 176 tracked files and all six task Markdown files.
The task Markdown has no wide code lines or table rows.
All 32 package test tasks pass when run one at a time.
The lead observed exit code 0.
The main app's eleven tests pass in that run.

Logs use `/tmp/tinkered-todo-main-` and name each gate.
Browser proof: `/tmp/tinkered-todo-browser-proof.log`.
Source proof: `/tmp/tinkered-todo-source-browser.log`.
The previews still use local proof mode: an in-memory database and recorded mail.
Network Postgres and SMTP delivery were not tested.

## Lazy service library imports

The user asks to load libraries only when used and keep type imports static.
Native JavaScript imports already share the loaded module.
The app adds no import helper or cache.
The graph still owns clients through resources and actions through operations.
[Writer brief](LAZY-LIBRARIES-BRIEF.md).

Writer commit: `a667de7d` on `start/poc`.
The lead reviewed and copied thirteen app files into the main workspace.
Their bytes still match the saved commit after the main checks.
No library package or dependency changed.

The pool loads only its selected Postgres or PGlite driver.
The database and migration action load their selected Drizzle libraries.
Auth loads Better Auth, its adapter, and its tables in the resource factory.
Profile and todo actions load their SQL operators and table modules when run.
This closes the static schema import path through the backend entry.
Record mail loads no Nodemailer; SMTP loads it in the sender factory.
The browser auth resource loads the Better Auth client when resolved.
The Pino writer loads its server or browser implementation in its factory.
Cleanup stays registered with each resource owner.

Both entries await the observer before creating the observed app scope.
Start supports an async router entry and awaits it during server render and hydration.
The router registry and existing server-entry cast use the awaited router type.
The two mail test presets now use async factories and the existing message type.
Input readers, owner checks, transaction outcome, and todo flow states stay the same.

The fresh-process cold-import check fails before the fix and passes after it.
It records real Node module loads while importing the public backend entry.
That import loads none of pg, PGlite, Drizzle, Better Auth, or Nodemailer.
There are no mocked imports or patched library exports.
The main workspace also passes this check.
The script is exposed as `test:imports`.

The main build passes all 25 tasks.
The main check reports 0 errors and the same 28 existing warnings.
All 32 test tasks pass when run one at a time, including eleven app tests.
Native middleware dedupe, direct server calls, and import protection pass.
The authored census and TSDoc pass.
Jev has thirteen advisory rows; the lead read their explanations and code.
They concern existing entry ownership, tagged settings, and Core-owned cleanup.
Native module import has no stop API; Core tracks the factory and cleanup.
Shared judge labels remain unchanged for this proof app.

The browser passes saving, failure, retry, and reload.
Pino emits the successful todo operation span in the browser.
Two real accounts keep separate lists and can switch in the same tab.
There are no page errors.
The source page shows seven exact files with colors and no line numbers.
The embedded editor renders on phone and desktop.
The same database box now says Lazy database resource and links to its source.
[Source page](https://p-df4b02e60895.preview.tini.works/#todo-database).
[Editable graph](https://tldraw.tini.works/r/314eb38f07b44c469c2007bef0c558ea).

The user also asks whether refreshing data depends on the URL.
The existing todo view awaits the write, then awaits router invalidation.
It uses `router.invalidate({ sync: true })` to wait for fresh loader data.
The URL selects the page; invalidation refreshes the page after the write.
This follows the installed Start guide and the current
[TanStack mutation guide](https://tanstack.com/router/latest/docs/guide/data-mutations#invalidating-tanstack-router-after-a-mutation).
No URL or full-page reload is needed for a todo change.

Main logs use `/tmp/tinkered-lazy-libraries-main-` and name each gate.
Browser logs use `/tmp/tinkered-lazy-libraries-` with flow, crud, or source.
Writer logs use `/tmp/start-lazy-`; import proof names red and green results.
The previews remain running in local proof mode.
This correction does not add a network Postgres or SMTP delivery claim.

## Inferred failure context

The user asks why the failure action's context has an explicit type.
The old action supplied its input type through the callback annotation.
The final change declares the input where it is read.
Its input reader turns a raw error into the existing message string.
It unwraps the managed validation error and keeps the same text choices.
Core now infers the context and its string input from that reader.
The run body only writes failed with that message.
The catch calls `failure.run({ rawInput: error })` so the reader runs.
There is no context annotation or Operation type import in the todo view.
No helper, schema, cast, or test was added.

Writer commit: `4dde3c8c` on `start/poc`.
Only `src/frontend/Todos.tsx` changed.
The lead reviewed and copied the final file into the main workspace.
The file still matches the saved commit after the main checks.

The main build passes all 25 tasks.
The main check reports 0 errors and the same 28 existing warnings.
All 32 test tasks pass when run one at a time, including eleven app tests.
The changed file passes strict census and TSDoc.
The advisory review has no flags.
The browser proves the blank-title message, failed Core span, retry, and reload.
It also sees Pino emit the successful todo action span.
There are no page errors.
All seven highlighted source tabs match the real files exactly.
The embedded graph still renders on phone and desktop.
[Review the todo view](https://p-df4b02e60895.preview.tini.works/#todo-view).

Main logs use `/tmp/tinkered-failure-input-main-` and name each gate.
Browser logs use `/tmp/tinkered-failure-input-` with flow or source.
Writer logs use `/tmp/start-failure-input-`.

## Shared state and execution results

The user replaces the one-off state flow with one shared update path.
Mutation calls return an execution ID; sync events publish saved changes.
Local waits match final results by that ID.
Remote executions use the same update path without needing a local wait.

The user defines complete by the operation's required work.
A database-only goal usually ends at commit.
A saved profile with a failed required notification has a partial result.
That result must keep the saved profile usable.
The [accepted model and result shape](STATE-SYNC.md) record this rule.
The glossary defines execution ID, completion goal, execution result, and partial result.

Change events and final results are separate facts.
A committed change can update every view before notification work finishes.
The wait ends only after the final result and its earlier changes have been applied.
Drafts keep their own owner and survive remote changes.
Retrying failed mail preserves the completed profile save.

No app runtime or public Core API changes in this design step.
The current scaffold still uses direct replies and loader invalidation.
Runtime seam and browser proof remain pending.

The lead reviewed the graph, result branches, and current app call sites.
Prose passes with 0 hits in 176 tracked docs and all five touched docs.
The three track docs have no wide rows or code lines.
`git diff --check` passes, exit 0.

## Public and private sync slice

The user asks for authentication, authorization, a public page, and a protected page.
Both page kinds must support the same mutation and sync model.
The public sample is a shared counter with no account details.
The protected samples keep the profile and each account's private todos.
Their name displays share one saved profile record.

The user also asks for lean setup updates and registry research.
The [registry notes](REGISTRY.md) record the official format and checked CLI.
Install time chooses concrete Postgres, SMTP, and Better Auth graphs.
There is no SQLite item or database picker.
Proof adapters stay outside production resource choices.

The [writer brief](PUBLIC-PRIVATE-SYNC-BRIEF.md) names the runtime slice.
An Astra writer owns the app in its existing isolated worktree.
The lead owns the registry, shared docs, graph, and source preview.
Direct Start server functions supply bootstrap and short change polls.
Core owns the polling signal and clock.
Committed event history supports remote changes, final results, and replay.
The reviewed runtime is saved as `a8102d62` on `start/poc`.
The lead copied only the reviewed app paths into main.
The copy preserves concurrent work and adapts proof imports to Core's testing entry.

## Public and private sync proof

The public counter and private profile/todos use one saved-record publisher.
Userland owns Postgres, tables, records, readers, feature actions, and views.
Fixed middleware, lifetime, polling, execution waits, and Pino live in `src/scaffold/`.
Native entry filenames stay small composition files.
There are no old forwarding modules or database choices in the production factories.

The server commits a saved change and its ordered event in one transaction.
Per-stream locks keep snapshot cursors and concurrent commits in order.
Private reads, writes, and event cursors enforce the current-user resource.
A browser request ID is registered first and returned as the acknowledged execution ID.
Lost replies retry that ID without repeating the saved write.
Sync applies changes before finishing the local execution wait.
Remote changes use the same saved data without a local wait.
Account exit cancels waits and ignores old responses.

The lead found SMTP running under the stream lock.
The new seam test failed while reading a saved profile with mail held.
Mail now runs outside database work; only the final-result append takes a short lock.
The test passes and two duplicate requests share one in-process send.
A committed name stays usable before mail finishes.
Failed mail yields partial; notification retry preserves the saved profile.
Request exit leaves committed notification work with its root owner.
Crash recovery and one send across several processes are not claimed.

Observed main gates:

- Workspace build: 25 tasks, exit 0.
- Workspace check: 0 errors and the same 28 existing warnings, exit 0.
- All 32 package test tasks: exit 0.
- App seams: 19 tests in five files pass.
- Native middleware dedupe and concurrent request isolation: exit 0.
- Browser import guard and cold backend import: exit 0.
- TSDoc: 60 authored files, 0 rows, exit 0.
- Strict census: only two approved S16 proof presets, raw exit 1.
  Both are explicit opt-in host adapters in `src/proof.ts`, lines 6 and 15.
  Every other strict row is zero; generated route code is excluded.
- Advisory test review: 0 flags in 19 tests.
  The updated README now names all new accepted public promises.
- Built Node host: public SSR, registry JSON headers, and graceful exit pass.

The real browser proof uses two anonymous tabs and two real accounts.
A public increment reaches both tabs.
Anonymous private pages redirect to the public page.
A profile rename updates the todo header and another editor's saved name.
That editor's dirty text stays unchanged.
Todo changes reach another tab; another account sees none of those private rows.
Signing out clears every tab's private data.
The same tab can enter another account and sees only its rows.
There are no page errors or phone overflow.

The real shadcn CLI copies three registry items with 67 files into a fresh consumer.
Payloads and copied files match actual source bytes.
Dry run changes no file.
A setup overwrite keeps an edited todo feature intact.
The consumer builds and passes its type check.
Dependency installation is a prerequisite, not part of this proof.
All three public HTTPS item addresses match their built payloads.
The [registry commands and ownership](REGISTRY.md) name the checked version.

The [source page](https://p-df4b02e60895.preview.tini.works) shows 13 highlighted userland files.
Only one file is open at a time; setup stays hidden and there are no line numbers.
Every displayed source matches its real file.
The [same editable graph](https://tldraw.tini.works/r/314eb38f07b44c469c2007bef0c558ea)
remains embedded and works on phone and desktop.
The [live app](https://p-6b63623651fe.preview.tini.works) stays available in local proof mode.
It uses in-memory Postgres and recorded mail, not live network services.

The user asks whether OTEL works.
Core spans and Pino work on both sides; OpenTelemetry export is not wired.
No collector receives those spans and no browser-to-server trace link is claimed.
Full live graph inspection still needs Core support beyond completed spans.

Main gate logs use `/tmp/tinkered-start-sync-main-`.
Browser proof is `/tmp/tinkered-sync-browser-proof.json`.
Registry proof is `/tmp/tinkered-start-registry-proof.json`.
Mail regression logs use `/tmp/start-sync-mail-lock-`.
Native host proof is `/tmp/tinkered-start-production-host.log`.
The source-browser proof is `/tmp/tinkered-start-source-browser.log`.
No Core or other package source changed in this slice.

Final prose checks have 0 hits in 176 tracked docs and all six touched docs.
The five new/updated narrow docs have no wide rows or code lines.
The final diff check passes.
The lead moved the saved slice from Review to Done after observing this proof.

## Owned source, SSE, and Victoria storage

The user chose copied source across the whole repo.
Keep only Core and React as Tinker library packages.
Keep useful integration code and tests as source the app owns.
The source registry uses the same copy model as shadcn.

The user chose a local Victoria stack for now.
VictoriaTraces stores Core traces.
VictoriaLogs stores Pino logs.
Browser records go through the app backend.
Storage addresses and keys stay on the server.

### Tickets

- **start/sse** — done; proof observed below.
  One native SSE stream carries public and private changes.
  Postgres notifications wake replay after commit.
  Verify: real notifications, native stream ownership, auth,
  replay, slow readers, and browser updates without polling.
  [Writer brief](SSE-BRIEF.md).
- **start/victoria** — done; proof observed below.
  Copied Core and Pino export code sends both sides to Victoria.
  Verify: failures stay apart from business results; bounded
  close; browser ingest; query actual stored traces and logs.
  [Writer brief](VICTORIA-BRIEF.md).
- **source/remove-add** — done; proof observed below.
  Remove extra package shells, old issue-tracker, and the nine
  examples that use them.
  Add the useful integrations as copied source registry items.
  Keep Core/React examples and the new Start scaffold.
  Verify: kept tests, real registry install/update, no extra
  library imports, build, and check.
  [Writer brief](SOURCE-REGISTRY-BRIEF.md).

### Observed main proof

The lead combined the reviewed writer changes by exact path.
Shared Start entry changes were merged with both features intact.
Main's other Core and writing work was preserved.
Only `packages/core` and `packages/react` remain.
The old issue tracker, nine dependent examples, and create-app generator are gone.
There is no old-app migration or hidden integration library.

The private source catalog keeps 13 items and 58 source files.
Apps receive their own `src/tinker/<item>/` files and fixed source graph.
Blueprint stays a private repo tool with its own process source.
All 95 kept integration and blueprint test files still run.
The recorded wire fixtures remain; the old token-sending probe script was omitted.
Automatic approval review rejected saving that script because of its credential side effect.
No token was read or sent.

Main build, check, and every workspace test task returned 0.
Check reports 0 errors and 28 existing warnings.
The 30 joined app seams pass, including seven telemetry seams.
The kept integrations pass 796 tests; blueprint passes 118.
One existing blueprint test needs a live key and stays skipped.
Graph, native import, ambient read, scope ownership, and source size gates pass.
SCIP was rebuilt for the source catalog and blueprint; public references were reviewed.
The scope ownership gate recognizes copied framework and driver source.
Feature files still cannot receive scope handles.

Native SSE proves replay, post-commit wake, auth, cancellation, and idle close.
The built Node host ends an idle SSE body and exits 0 on SIGTERM.
The browser proof sees no old polling calls and no page errors.
Public changes reach another tab; private lists stay apart.
Sign-out clears the other tabs, and a tab can switch accounts.
A pending save resolves from its final event after reconnect.

Core traces and actual Pino logs reach both Victoria stores.
The lead queried back matching trace and span IDs for server, browser, and SSR.
Each stored trace names the correct service and source side.
Browser uploads return 202 through the bounded same-origin route.
A proxy-origin regression was red with request-scheme checks and green with configured origin.
Stalled upload and storage close regressions are also red without their fixes.
Storage failures retain bounded records for retry and leave business results usable.
Cross-side trace propagation and full live graph inspection remain separate Core work.
Network Postgres and SMTP delivery remain outside this local proof.

The Start registry installs 81 exact files across three items.
Its setup contract is version 2; source version is 0.3.0.
The source catalog installs the selected tinkerer/HTTP graph with real native dependencies.
Both real CLI copy/update proofs pass and keep edited feature files intact.
All 16 HTTPS item payloads match their built source bytes.
The highlighted source page still shows 13 exact userland files and both editable graphs.
Phone and desktop checks pass with no page errors.

Authored copied source passes strict census.
The app has only the two approved host proof-preset exceptions.
Generated Better Auth schema keeps its four native PURE comments byte for byte.
Four old guard assertions remain in one kept Tinkerer test.
No test was removed just to make a style check pass.
TSDoc parsing reports no errors.
Jev is advisory; completed writer findings were reviewed.
The process entry caches no request input; its singleton flag is false.
The jobs clock tag is private, and the NATS mirror still checks the pinned archive.
Those copied file findings are false.
Client and stream cleanup belongs to resources, response consumers, and original stop signals.
Protocol constants and the fixed proof host are not deployment settings.
Listener cursors, promises, byte queues, and SDK turn state belong to their resource owner.
They are coordination state; saved records and visible health remain data cells.
Duplicate profile notification work is a promised no-op once its result is saved.
These explain the completed unit findings; no shared judge rules were added.
A broad review of unchanged copied source was stopped, not treated as a passing gate.

Main proof logs use `/tmp/tinkered-owned-final-`.
The browser result is `/tmp/tinkered-sync-browser-proof.json`.
Storage readback is `/tmp/tinkered-victoria-readback-proof.json`.
HTTPS payload proof is `/tmp/tinkered-owned-registry-https-proof.json`.
The current [app preview](https://p-50f124fdfa9c.preview.tini.works)
and [source page](https://p-df4b02e60895.preview.tini.works) stay running.
These are temporary previews, not production services.

## Keep the plain Start registry

The user asked to remove most registry items.
Keep the version whose user code declares data, tags, resources, and operations.
The Start app already uses that form for its backend and frontend.
Its fixed middleware bridge still owns scope lifetime.

Remove the old 13-item source catalog and its copied public payloads.
Keep the three Start items: setup, chosen services, and first install.
Auth, Postgres, mail, SSE, and Victoria stay in the copied app source.
Core and React exports stay unchanged.
Blueprint keeps its own process source and checks.

The [writer brief](PRIMITIVE-REGISTRY-BRIEF.md) lists the removed owners.
Writer commit: `d5947847`, from a fresh worktree based on `a4727997`.
The lead read the cleanup diff and requested one scope-gate fix.
Retired copied-driver exemptions are gone; the fixed Start bridge remains allowed.
The lead transferred only the 265 reviewed task paths into main.
Other active Core and writing changes were preserved.

The starter now copies portable `AGENTS.md` authoring rules.
All three source items are version `0.3.1`; setup contract stays 2.
The install contains 82 files, including those rules.
New code outside the four forms must explain in TSDoc why they cannot own the work.
The current authoring guide links to actual kept feature units.
It no longer points authors at removed service factories or packages.

The lead checked 22 backend and frontend files.
Their 45 graph units use data, tags, resources, and operations.
They declare no feature extension.
Framework hooks remain in fixed setup.
The feature source passes strict style census.

Observed main checks:

- Install and nine workspace build tasks: exit 0.
- Check: exit 0, zero errors, and the same 28 warnings.
- All eight kept workspace test tasks: exit 0.
  The 30 Start operation and resource seams pass.
- Real shadcn install: three items and 82 exact source files.
  Dry run changes no file; setup update keeps an edited feature.
  The installed consumer builds and passes types.
- Graph, ambient reads, scope ownership, and Blueprint corpus checks: exit 0.
- Prose and diff checks: exit 0.
- All 16 kept deterministic validation lanes: exit 0.
- All three HTTPS items match the built payloads.
  The 14 removed catalog addresses return 404.
  The production build contains only the kept registry payloads.

The writer also observed native Start boundary, middleware, SSE, and import checks pass.
No kept app TypeScript changed.
One existing Blueprint test still needs a live key and stays skipped.
Deletion leaves no changed TypeScript for advisory preflight.
Its empty-list fallback reviewed unchanged examples; those flags are outside this task.

The removed source-only followups were `stack/span-kinds`,
`sync/eq-undefined`, and `auth/sendmail-type`.
Their former owners no longer exist, so those cards leave Ready.
Core followups stay with their current owners.

Main logs use `/tmp/tinkered-primitive-main-`.
Registry proof is `/tmp/tinkered-start-registry-proof.json`.
HTTPS removal proof is `/tmp/tinkered-primitive-main-https-proof.json`.

## Start seam saved for review

The writer kept all work in `../tinkered-start-seam` on `start/seam`.
The fixed folder now reaches user values through two alias imports.
An app-owned `Register` supplies its feature body types.
The copied scaffold compiles with a note app that has no example feature bodies.
The repeatable seam check rejects a planted outside path and passes the real tree.

The real shadcn 4.21.0 skips import rewriting for `registry:file`.
Eight fixed files use `registry:lib` with fixed scaffold targets instead.
Install-once seams use `@lib/...` targets.
The alternate-alias consumer builds and passes types.
Both edited seams survive a runtime update.
Source version is `0.4.0`; setup contract is 3.

All full gates returned 0.
Check has zero errors and the same 28 warnings.
All 30 app tests pass within all eight workspace test tasks.
Validate passes all 16 lanes.
The prior proof-preset and generated-source census exceptions remain.
No new TypeScript exception was added.

[Full proof, gates, and assumptions](SEAM-PROOF.md).
Jev labels stay in this track because the ticket bars shared-tool edits.
The lead merges those labels and calibrates them at landing.
The writer did not push, publish, or mark the board card Done.

### Start seam: lead fix round

The lead found duplicate sync tables in `drizzle-kit generate`.
The new copied-app schema check is red before the fix and green after it.
The user schema keeps only the feature counter table.
Feature operations import fixed sync tables directly.
Generation says `No schema changes` and creates no new migration files or folders.

The seam guard now handles import-type expressions through the parser's source field.
It refuses the app's own package, subpaths, string module declarations,
import-equals, glob imports, and outside triple-slash reference paths.
Thirteen forbidden probes exit 1 and name their paths.
The legal Core import-type probe exits 0.
The real fixed tree also exits 0.

The entry uses static proof preset imports.
PGlite still loads only inside its factory in proof mode.
The metadata and README now say that.
Contract 3 notes include receipt imports, fixed table ownership, and envelope readers.
The unused stream schema is gone, repeated imports are merged,
and README guarantees are back in the guarantee list.

All fix-round gates return 0.
Check has zero errors and the same 28 warnings.
All 30 app tests pass; validate passes all 16 lanes.
The note fixture and real registry install/update still pass.
The changed-source census needs no exception.
Five repeat Jev findings are labeled false with their reasons in this track.

[Current proof and gate logs](SEAM-PROOF.md).
The writer saved the fix round for lead review and did not push.

## Start refine saved for review

Writer branch: `start/refine`, based on `314c64ec`.
The stream checks the session once per wake and on heartbeats.
Sign-in owns its snapshot until it is applied, then releases reconnects.
Signed-out private redirects check only the account.
Tests prove one snapshot even across separate server renders.

App source has no proof mode or Core testing import.
Tests, project gates, local compose services, and five skills are copied.
Maintainer proofs stay outside the registry.
The owner README gives start, layout, rules, and tested promises.

All required gate chains return 0.
Check has zero errors and the same 28 warnings.
All 33 app tests pass within all workspace test tasks.
All 16 validate lanes pass.
The 109-file clean shadcn consumer installs packed Core and React.
It builds, checks types, runs every shipped test, and passes project gates.
The real compose browser signs up and reloads its saved Postgres todo.
Mailpit's API and browser inbox show the profile mail.
The temporary test stack is removed; existing Victoria stays running.

[Full proof, red/green counts, logs, and assumptions](REFINE-PROOF.md).
[Every gate's exit code and log path](REFINE-GATES.json).
The raw folder census flags generated router text and test-only presets.
Strict authored source and scope tests pass with no hits.
Jev labels stay in this track for the lead to merge and calibrate.
The writer did not push, publish, or change the board.

## Refine lead fix round

Private guards now check the server and clear an old account.
A new quiet-stream test proves heartbeat auth without a session wake.
Both regressions have saved red and green runs.
The four app skills and registry copies have the lead's corrections.
All 35 app tests and the fresh copied project's 35 tests pass.
Workspace tests: 1,106 passed, 1 skipped.
All 16 budget lanes pass.
Proof and exit codes are in `REFINE-PROOF.md` and `REFINE-GATES.json`.
This stays saved for lead review; the writer did not land or push it.

## Strict forms

Owner: strict-forms writer.
Rule: ADR 0099, plus services stay in the graph.
Next: ship the plain check, shrink helpers, and prove the copied starter.
Verify: planted failures, real tree, consumer, app tests, and repo gates.
Assume: tests do not count as app call sites.
Assume: native callbacks meet their caller's contract.
Assume: resource methods keep their owner's private work.

### Strict forms result

This records the first review; the lead fix round is below.

Branch: `start/strict-forms`, based on `8867c44f`.
Plain functions: 45 before, 19 after, under the final alias and callback rule.
Classes in src: one before, zero after.
The list is shipped in `apps/start-scaffold/PLAIN.md`.
The server entry owns its roots, signals, lazy start promise, and close.
The fixed backend entry now declares only `setup`.
The queue, delivery, log writer, and response bodies are resources.
Single-use JSON readers are inline operation input callbacks.
The native HTTP proof rejects bad JSON cursors with 400 again.

The checker uses a pinned TypeScript 5.9 API to follow symbols and aliases.
TypeScript 7 has no compatible `ts.sys` API in this install.
The typecheck script calls the TypeScript 7 binary by its package path.
This keeps the API package's same-named binary out of that choice.

The source items are version `0.6.0`, with setup contract 4.
The shipped README states how to move the server entry and lib seams.
A fixed-runtime-only overwrite cannot update those install-only files.

### Assumptions

- The ticket covers src, including the fixed scaffold and sample features.
  Tests, maintain scripts, and generated files are outside the plain check.
- Two sites means two direct calls or callback registrations in src.
  Tests, imports, and re-exports alone do not count.
  Several calls in one function may count as several sites.
- Core callbacks, native callbacks, React components, and root entries meet their caller's contract.
  Resource methods and returned callbacks keep their owner's private work.
  Named helpers still need the strict rule unless handed to such an owner.
- React components have a capital name, JSX, and at most one props param.
  Their nested helpers are still checked.
- The server entry may retain its lazy start promise in its entry object.
  It starts nothing at import; no helper owns or returns its scope.
- Raw readers may take unknown values at the input door.
  Settled Core results are plain records, not live handles.
  Environment values are copied into a plain record at the entry.
- The check catches known service creation and direct effects.
  Review still checks purity, hidden library effects, and each param's size.
- The census skips generated route source and the test-only preset file.
  It checks every authored src file and every app test file.
- This app has no mutation script or Stryker config.
  There is no app mutation lane to run under flock.
- The lead owns the trial reference, flight gate, landing, and push.
  This writer changed no packages, tools, or other apps.

### Gates

Each final gate passed by exit code.
The full gate list is in `STRICT-FORMS-GATES.json` beside this file.
Each planted failure returned exit 1 by its rule name.
The proof command itself returned exit 0 for all 26 cases.
The independent consumer passed build, types, 36 tests, plain, seam, boundary, and schema checks.
The native HTTP proof passed bad cursors, replay, request isolation, and host close.
The full repo tests passed under each package's own config.
`vp check` ended with zero errors and 28 warnings.
`pnpm validate` passed all 16 lanes.
The byte-budget test failed on the rewritten counter before its fix, then passed.

### Jev answers for the lead

Preflight found no file flags and seven flagged units.
Tests had no flags; all 36 titles had a README line, with two unsure picks.
The user barred changes to tools, so this writer did not write labels there.
These are the proposed false labels and their reasons:

- `notifyProfile`: `noOpRejected`.
  Mail failure is a partial business result; the saved profile stays usable.
- `responseBodies`: `effectWithoutDefer`, `stopOnlyInDefer`, `ignoresAbortAfterAwait`.
  The body transfers to its native consumer, which closes or cancels its session.
  Stream completion and cancellation are proved at the public seam.
- `snapshotLoader`: `ignoresAbortAfterAwait`.
  The captured account version guards application of a late snapshot.
  Account exit and held sign-in loads are covered by scope tests.
- `eventSource`: `effectWithoutDefer`, `configNotTag`.
  Its factory defers connection close; its fixed eight-frame bound is a transport rule.
- `streamChanges`: `effectWithoutDefer`.
  Its child operations and resources own and close each connection.
- `delivery`: `configNotTag`.
  Storage URLs and service settings are already in `telemetrySettings`.
  Browser path, content type, and log field names are fixed wire rules.
- `queue`: `stateOutsideCell`, `configNotTag`, `stopOnlyInDefer`, `ignoresAbortAfterAwait`.
  Private retained work belongs to a resource; visible health belongs to data.
  Settings are tags; bounds are fixed wire rules.
  Factory defer, the close hook, and owned stop signals end timers and requests.
  A deadline stops further sends; publishing ends before scope shutdown.

### Core feedback

A throwing schema transform can escape `settle` through standard validation.
The native HTTP proof exited 1 with a SyntaxError on `not-json`.

```ts
input: z.string().transform((raw) => JSON.parse(raw));
```

The honest workaround puts JSON parsing in the operation's input callback.
Core then returns a managed input failure and the route answers 400.

```ts
input: (raw: unknown) => JSON.parse(z.string().parse(raw));
```

This fix round records a missing private resource procedure below.
Resources own the queue and retained work without classes or scope getters.

## Strict forms lead fix round

Reviewed head: 1729cb03; lead verdict: not ready.
Rebased onto origin/main at 8ba8ac25 and read ADR 0100.
The fix keeps services in the graph and makes each check exception narrow.
The shipped list drops from 19 entries to 17; PLAIN_MAX is 17.
The old 45-entry count used the first review's site-based rule.
It is not a count under this round's caller rule.

### Review items

1. Hidden object methods and arrow properties now get the plain rules.
   Only returned public resource methods, Core callbacks, and native contracts get their exception.
   Snapshot loads and HTTP posts are inline in their owners.
   Native send functions and data records replace signal-taking helpers at sync.execute callers.
   The sync skill shows that call and the public account-change methods.
2. The queue returns only ingest, start, flush, and close.
   Deadline waits, delivery, bounds, and health updates stay inside those public methods.
   No resolver can bypass flush dedupe through send.
3. cn accepts rest ClassValue params again.
   Button, card, and input use normal shadcn calls.
4. The check counts distinct callers and ignores self-calls and value uses.
   Collection callbacks belong to their enclosing caller.
   Span time and field encoding are inline in the observer span hook.
5. Any Core createScope reference outside the real root entry functions fails.
   Imports alone are allowed; wrappers and aliases give no exception.
   Module-level roots in an entry file fail too.
6. Let and const holders are checked, including nested and promised handles and native clients.
   Exported accessors and arrow properties returning a scope fail.
7. Any params, unconstrained type params, forbidden casts, and library signal bags fail.
   Unknown remains valid for input doors and error guards.
8. React props cannot carry handles or signals; await in the component body fails.
9. Module calls follow a declaration allow-list.
   Import-time resource option values have no graph owner.
   Plain bodies reject direct time, random, storage, fetch, and console effects.
   Entry files no longer grant a service exception; only root stop controllers are allowed.
   The tabLifetime resource owns and releases the browser pagehide listener.
10. responseBodies tracks open readers and cancels them through ctx.defer.
    A public-seam test proves scope close cancels a body left open.
11. The forms skill states the final rules and shows the actual public start method.
    It says why the resource may own a timer callback while a plain function may not.
12. The README now uses the server entry's requestContext.scope.resolve line.
13. The fixed cap rejects list growth even after regenerating PLAIN.md.
    Raising it needs a decision.

### Core feedback from the fix

- Missing form: a private procedure attached to a resource, sharing that resource's native state.
  Current returned methods are public; exposing send lets callers skip flush dedupe.
  A plain helper cannot take clock, signal, controllers, or its owner's held state.
  The honest workaround repeats deadline and snapshot work inside public methods.
  A future Core form must keep that work private and owned without exporting a scope.

### Assumptions for this round

- A factory's returned value includes its arrow body, a directly returned local object,
  and Object.assign adding native methods to that value.
  An extension hook's returned public value follows the same ownership rule.
  Run and input callbacks do not gain this returned-method exception.
  Listed entries' returned public native methods keep their entry contract.
  Entry names must match the top-level function or the server entry object's fetch member.
- Inline native callbacks have a callee declared outside src, or are JSX attributes.
  Native option objects may provide that callee's named callbacks.
  Named lifetime callbacks may be registered with a resource's native public contract.
  Inline functions passed to source methods are plain functions.
- Map, filter, flatMap, reduce, and promise callbacks count under their enclosing caller.
  Framework boundary callbacks remain distinct callers.
  Module code is one caller per file.
  Anonymous caller names use their parent and order, so copying and formatting keep the list true.
- Declared Core units may be module metadata, not resolved live handles.
  Their handles still cannot be plain params or React props.
  Only the server entry.owned promise may hold its root context at module scope.
- React's initial render scheduling stays in src/client.tsx, the native client entry.
  Module declarations include the exact schema and framework builders used by this app.
- Resource-owned listener stop signals make driver release safe to repeat.
  The native release callback may finish synchronously or return a promise.
- This app still has no mutation lane.
  The lead owns landing and push; no packages, tools, or other apps changed.
- The source version stays 0.6.0 and setup contract stays 4.
  This branch has not been published; the README now covers the full upgrade.

### Jev answers from the fix

Preflight exits 0: no file flags and 12 flagged units.
Tests exits 0: none of the 37 tests has a flag.
Promises exits 0: all 37 titles have a README promise; one pick is unsure.
The user bars changes to tools, so these false labels stay here for the lead:

- database: effectWithoutDefer, configNotTag, stopOnlyInDefer, ignoresAbortAfterAwait.
  Its factory defers pool close; settings are a tag.
  Each listener has an owned stop signal that removes callbacks and releases its client.
  Core owns a late factory result, and scope tests prove listener shutdown.
- migrate: configNotTag.
  The migrations folder comes from the databaseSettings tag.
- notifyProfile: noOpRejected.
  Failed mail is a partial business result; the saved profile stays usable.
- responseBodies: stateOutsideCell, stopOnlyInDefer, ignoresAbortAfterAwait.
  Open readers are native work owned by the resource, not visible state.
  Consumer completion, cancellation, and ctx.defer all end that work.
  The cancelled flag guards a late pull; the new scope-close test fails on the old code.
- notifications: stateOutsideCell, stopOnlyInDefer, ignoresAbortAfterAwait.
  Listener records and wake versions are private native state.
  Broken, closed, and connection identity checks reject late or stale subscriptions.
  Its deferred stop closes the active driver connection.
- eventStream: stateOutsideCell, ignoresAbortAfterAwait.
  Cursor and controller state belongs to its request resource.
  Every awaited auth step checks ended before publishing; native close ends the body.
  Replay, account change, heartbeat auth, and host close pass their tests.
- snapshotLoader: stateOutsideCell, ignoresAbortAfterAwait.
  Load and auth-hold promises are private native work, not visible saved state.
  Account version and stop state prevent a late snapshot from applying.
- eventSource: effectWithoutDefer, configNotTag.
  It defers native connection close; its eight-frame bound is a wire rule.
- streamChanges: effectWithoutDefer.
  Its child operations and resources own each connection and close it on exit.
- syncClient: stateOutsideCell.
  Execution wait records are private native work; visible records are data.
- delivery: configNotTag, S24 at each of its three fetch calls.
  URLs and service settings are tags; path and content types are wire rules.
  This starter has no copied HTTP source; its owned delivery resource performs native HTTP.
  Flush runs as an operation, and browser ingest has its own operation boundary.
- queue: stateOutsideCell, configNotTag, handRolledLifetime, stopOnlyInDefer, ignoresAbortAfterAwait.
  Retained records and timer promises are private owned work; health is data.
  Settings are tags; its record and byte bounds are fixed wire limits.
  Close, factory defer, and owned stop signals end work; deadlines prevent later sends.
  Public flush keeps dedupe, and public close awaits all tracked work.

### Fix proof

Final gate results are in STRICT-FORMS-GATES.json beside this file.
All required gate commands exit 0.
All 81 planted failures exit 1 by rule name, including list growth under --list.
The real tree has 17 plain functions and no classes in src.
App and consumer each pass all 37 tests.
The full repo tests pass: 1,139 tests, with one existing skipped test.
The consumer copies all 110 files with no workspace links or proof mode.
Build, types, plain, seam, boundary, schema, and native middleware all pass.
The strict authored census and TSDoc pass; prose has zero hits.
vp check has zero errors and 28 warnings; all 16 validate lanes pass.
The new reader-close test exits 1 on the old body and 0 with the fix.
The app has no mutation lane; the presence check runs alone under flock.
Long jobs ran in the foreground; the writer waited for every job to end.
The card stays in Review for the lead.

### Fix commits

- 176f7f96 fix(start): restore shadcn class helper calls
- c4055231 fix(start): cancel open response readers on scope close
- 07d12725 fix(start): inline telemetry HTTP work in delivery
- cacdd518 fix(start): keep queue work private and inline span encoders
- 0b8b13dc fix(start): keep snapshot work in its resource
- 507dbb77 fix(start): keep native listener work in resource owners
- c51ff16c fix(start): use native callbacks for entry teardown
- 0983fc77 docs(start): teach strict callers and graph ownership
- 6ef02818 fix(start): enforce strict forms on every function shape
- defa8ec0 docs(start): list allowed schema declarations
- 34897e5e docs(start): show public snapshot and sync calls
- 248d786f fix(start): ship strict forms fixes in registry payloads
- 434eb4c1 fix(start): put platform work inside direct resource factories
- 1722e6a4 fix(start): own the tab close watcher in a resource
- 4e6d3516 fix(start): narrow factory and entry exceptions
- 82f10dc4 fix(start): reject primitive handles in helper params
- 4291d670 fix(start): ship owned watcher and direct factories

The final proof commit updates this record, the gate JSON, and the card.

## Starter casts: start/starter-casts

Owner: Sol writer; lead owns review and landing.
Next: remove both server casts, use validator, and rebuild the registry.
Verify: app gate before and after; plain, seam, registry, build, types, tests, and prose.

### Assumptions

- The existing Doing card is the task card.
  The brief bars edits to TODO.md, so the lead moves it after review.
- The worktree is installed at origin/main, 3fce5703.
  No pull or install is needed.
- The pinned Start client has validator and uses the same input check as inputValidator.
  The starter check must accept the new builder name and count its reader callers.
- Start erases the router factory's added close method at its callback boundary.
  Treat close as an optional native property and check it before use.
  Keep its type tied to getRouter; add no helper or cast.
- The app has no mutation script.
  No full mutation run is required for this card.
- The brief bars edits to tools.
  Any Jev answers owed to the lead stay here, with their reasons.
- The trial store and trial containers are outside this work.

### Step 1: server types

Both server casts are replaced by types.
The native router boundary checks its optional close method.
The entry owns an optional start promise without an assertion.
No plain function was added.
The existing render, body, and catch paths still call router close.

The first root check found 409 errors and 31 warnings.
The untouched pinned origin/main tree also exits 1 with those counts.
Logs: /tmp/starter-casts-base-build.log and /tmp/starter-casts-base-check.log.
The base is 3fce5703, the main commit named in the task.
To stay in this worktree, the check briefly restored both edited files from that commit.
It restored the writer's saved bytes in a finally block; no stash was used.
The errors are in the trial reference tree and other unchanged tool files.
The task bars changing those files.
vp env doctor exits 0; /tmp/starter-casts-env-doctor.log.

### Step 2: current Start validator

All four server-function validators now use validator.
The forms skill and shipped plain check use that same name.
The pinned Start client aliases both names to the same check.
No input behavior changes.
Step 1 passed the app types, scoped check, 39 tests, plain, and prose gates.
The root check's base failure is recorded above.

### Step 3: every starter-owned blocker

The before app gate found six blockers in files the starter ships.
Two were the server casts named in the brief.
One was the page-hide event cast; it now checks the event's persisted field.
Three were the telemetry resource's direct HTTP calls.
That resource now resolves telemetryBackend from its scope.
Its default is native fetch; the queue still owns retry, cancellation, and shutdown sends.
This extra change is required by the brief's whole-starter gate.
It adds a tag and one public-seam test, with no new plain function.

The backend test uses a real local HTTP receiver.
Putting the old direct calls back exits 1: it reaches /unused instead of /selected.
Restoring the scope-bound backend exits 0.
Logs: /tmp/starter-casts-regression-before.log and /tmp/starter-casts-regression-after.log.
The app passes 40 tests; the copied starter passes 38.
The two app-only tab-lifetime tests stay outside the registry, as before.
The native middleware proof passes request isolation, replay, abort, and host close.
The strict census passes on each touched source file and the changed test file.
The plain check still counts 17 functions; all 81 planted failures exit 1.

Jev found two existing tab-lifetime promises missing from README.
Those lines and the new backend promise are now filled in.
Its test check has zero flags; its promise check has zero gaps in 40 titles.
One unsure match owes no label.

### Jev answers for the lead

Preflight has zero file flags and two unit flags.
The brief bars edits to tools, so these false labels are recorded here.

- tabLifetime: stateOutsideCell = false.
  The close callback is private native lifetime state in its resource.
  Saved records and visible state are separate data.
- delivery: configNotTag = false.
  Storage URLs and service settings come from telemetrySettings.
  Native HTTP comes from telemetryBackend.
  Paths, content types, and stream query keys are fixed wire rules.

Core feedback: none from this type and API change.

### Gate limits and base proof

The full before gate exits 1: 13 blockers, including six starter-owned blockers.
The full after gate exits 1: seven blockers, all in src/routeTree.gen.ts.
That file is generated by TanStack, ignored by git, and absent from the registry.
No starter-owned blocker remains; no check is unavailable.
The owned-file proof exits 0 and checks the after report's source hashes against the final files.
Logs: /tmp/starter-casts-app-gate-before.log, /tmp/starter-casts-app-gate-after.log,
and /tmp/starter-casts-owned-app-gate.log.

Root vp check and pnpm validate exit 1 on both this branch and the pinned base.
Each reports 409 errors and 31 warnings in unchanged files.
Validate's other 15 lanes pass on both trees.
The app's own check exits 0 with no warnings or errors.
The missing imports are in tools/flight-trial/reference; other errors are in unchanged tools.
These paths are outside the brief's edit limits.
Logs: /tmp/starter-casts-check.log, /tmp/starter-casts-validate.log,
/tmp/starter-casts-base-check.log, and /tmp/starter-casts-base-validate.log.

The shared main and origin/main refs advanced while this writer worked.
The base proof uses the task's fixed commit, 3fce5703.
It restores only files within the two allowed folders, then puts back the writer's saved bytes.
The initial Jev diff used origin/main while it still pointed at that base.
No stash, pull, push, trial-store access, or container command was used.
The workspace already allows the esbuild build; pnpm-workspace.yaml was untouched.
The app has no mutation lane; no mutation job was run.

The card is saved for the lead's review.
The lead must fix the root check setup and the gate's treatment of generated files before claiming every gate is green.

### Step 4: registry and handoff

The registry is rebuilt from the final starter files.
All 110 emitted files match their source by exact content.
The independent copied starter passes build, types, 38 tests, plain, seam, boundary, and schema.
The full repo passes 1,209 tests, with one existing skipped test.
App types, check, 40 tests, plain, seam, boundary, schema, imports, native middleware, TSDoc, strict census, and prose exit 0.
Registry build and consumer checks exit 0.
The full required chain exits 1 at root vp check; the tests pass in their separate recorded run.
Root check and validate have the same failures on the pinned base.
The complete command, exit-code, and log list is in STARTER-CASTS-GATES.json.
Long jobs ran in the foreground and were awaited in this turn.

Source commits:

- 829a8d43: type the owned entry and narrow router close.
- b34b85d5: use the pinned Start validator API.
- 58af498a: narrow page events and bind the telemetry backend.

This proof commit saves the rebuilt registry and this record for review.

## HTTP resource: start/http-resource

Owner: Sol writer; lead owns review and landing.
Next: add the HTTP units, prove the request rules, then ship the registry.
Verify: red and green tests; build, checks, tests, prose, and validate.

### Assumptions

- The existing Doing card is this task's card.
  The brief bars edits to TODO.md; the lead moves it after review.
- The installed worktree starts at a5c12db9.
  No pull or install is needed.
- The HTTP resource belongs to the requesting session.
  This follows ADR 0035 and lets a session bind its own backend.
- Core span names are fixed labels.
  ADR 0102 allows ctx.obs.child for the method and path name.
  The named child sits under http.request, under the caller.
- The resource owns a request until its body text is read.
  Scope close can abort a body that is still arriving.
- Requests take absolute HTTP or HTTPS URLs.
  The server seam has no browser base URL.
- HttpRequestFailed keeps the URL, method, and caught cause.
  Non-2xx replies are normal results.
- Telemetry uses httpBackend directly to avoid tracing its own sends.
- The brief bars tools edits.
  Jev answers stay here for the lead to label.
- The app has no mutation script.
  Only a requested mutation lane would run, under flock.
- The trial store and trial containers are outside this work.

### Step 1: HTTP units

The server seam and both backend indexes export all three units.
The request operation records method, path, and status on its named child.
A 404 reply stays successful; no query string enters the span name.
The resource retains each abort controller through body reading.
Its deferred close aborts requests even on graceful close.
A caller abort keeps Core's cancelled result.
Network failures carry HttpRequestFailed with the request and cause.

All five new tests pass through the backend seam with bound fakes.
Each fails when its own behavior is removed, then passes with it restored.
The red variants never call the real network.
No plain function was added; the caller list gains the HTTP error raise.

### Step 2: shared backend and fetch rule

Telemetry uses httpBackend directly, without request spans.
Its test binds a fake at a no-network URL and proves no HTTP span opens.
The browser build permits only src/scaffold/backend/http.ts among backend files.
The other backend and server-file bans remain.
The boundary proof also plants a userland backend/http.ts import and rejects it.

The plain check rejects fetch calls inside operations, resources, and callbacks.
It also rejects globalThis.fetch references and string-key reads.
Only the fixed HTTP file has an exception.
Seven new planted cases name the http-request rule.
The first case passed the old check, so the old --prove run exited 1.

The forms skill has a filled feature operation using httpRequest.controller.
The feature, seam, and testing skills teach the same path.

### Step 3: registry

The runtime item includes the HTTP source.
The starter item includes the five public-seam HTTP tests.
The built items carry the shared backend, rules, skills, and exports.
The copied starter uses packed Core and React, with no workspace links.
Its build, types, 43 tests, plain, seam, boundary, and schema checks pass.
All 112 copied files match the shipped source.
The native middleware proof passes request isolation, replay, abort, and host close.

Jev's test check has zero flags in 45 tests.
Its promise check has zero gaps, with one unsure match.
The strict authored style census and TSDoc check both pass.
The app has no mutation lane; its presence check ran alone under flock.

### Jev answers for the lead

The step-2 preflight has zero file flags and one unit flag.
The brief bars tools edits, so this false label is left for the lead:

- delivery: configNotTag = false.
  URLs and service settings come from telemetrySettings.
  Native sending comes from httpBackend.
  Content types and log field query keys are fixed wire rules.

Core feedback: none from this card.
The allowed child span form covers the required request name.

### Gate proof

The required chain exits 0.
It runs build, check, every package's tests, prose, and validate.
The repo passes 1,214 tests, with one existing skipped test.
The app passes 45 tests; the copied starter passes 43.
Root check has zero errors and 28 warnings.
All 16 validate lanes pass.

The chain log is /tmp/http-resource-gate-chain.log.
The complete command, exit-code, and log list goes in HTTP-RESOURCE-GATES.json.
No files outside the two allowed folders changed.
No stash, pull, push, trial-store access, or container command was used.
The workspace already allows esbuild builds and was untouched.

### Final Jev answers

The full preflight compares a5c12db9 with this branch.
It exits 0 with one file flag and three unit flags.
The brief bars tools edits; these false labels stay for the lead:

- http.ts: leakedInternal = false.
  ADR 0102 requires exports for the tag, resource, and operation.
  The resource's send method is the operation's native request seam.
  Its retained abort controllers stay private.
- http: stopOnlyInDefer = false.
  ADR 0102 requires deferred abort on resource close.
  Each send also reads the caller's signal and releases its controller in finally.
  The caller-close test proves that abort stops body reading before root close.
- httpRequest: configNotTag = false.
  URL, method, headers, and body are request input, not shared settings.
  Native sending comes from httpBackend.
  Span attribute names are fixed fields.
- delivery: configNotTag = false.
  URLs and service settings come from telemetrySettings.
  Native sending comes from httpBackend.
  Content types and log field query keys are fixed wire rules.

S24 points at the sole built-in fetch call in the backend default.
ADR 0102 requires that call; the brief leaves S24 changes to a later card.
The extension-shape note is advisory and owes no label.
Jev's test check has zero flags and its promise check has zero gaps.

### Handoff

All 88 planted failures exit 1 by their rule name.
The plain check still has 17 functions.
The new fetch cases cover operations, owned methods, callbacks, parentheses, and global reads.
Each new HTTP test has separate red and green logs.
The changed telemetry test also has red and green logs.
Its red variant opens a sender span; its green form sends directly through the tag.

Source commits:

- 0f52edd5: record the task and assumptions.
- 83e81f94: own HTTP requests and observe each call.
- 5fbbac84: share the backend and forbid bare fetch.

The next commit saves the registry and the full proof record.
The card waits for lead review; this writer does not land or push.
Long jobs ran in the foreground and were awaited.

The lead can apply these filled label lines:

```bash
http_file=apps/start-scaffold/src/scaffold/backend/http.ts
node tools/jev/label.mjs leakedInternal false \
  "$http_file" --by start/http-resource \
  --why "ADR 0102 requires these public HTTP units."
node tools/jev/label.mjs stopOnlyInDefer false \
  "$http_file#http" --by start/http-resource \
  --why "Close aborts; caller signals also stop sends."
node tools/jev/label.mjs configNotTag false \
  "$http_file#httpRequest" --by start/http-resource \
  --why "Request values are input; sending is a tag."
delivery_file=apps/start-scaffold/src/scaffold/\
telemetry/delivery.ts
node tools/jev/label.mjs configNotTag false \
  "$delivery_file#delivery" --by start/http-resource \
  --why "Settings and sending are tags; fields are fixed."
```

No label file was changed by this writer.

## HTTP resource lead fix round

Reviewed head: 040df065; verdict READY with six fixes before landing.
Owner: Sol writer; lead owns review and landing.
Next: fix each item with red and green proof, then rebuild and run every gate.
Verify: HTTP-RESOURCE-FIX-GATES.json records every exit code and log.

### Assumptions for this round

- The lead's six fixes refine the original brief.
  App seams expose only httpBackend and httpRequest.
- A type query is not a fetch value use.
  The built-in default callback is the sole allowed native fetch use.
- HttpRequestFailed stores only method and path.
  A native cause can include the raw URL, so it is not retained either.
- Response headers use a record of string arrays.
  Each set-cookie value stays separate; other joined native header values stay as received.
- The HTTP span name stays http METHOD path.
  A token in the path would show in that name.
  Keep tokens out of request paths.
- Selected planted cases give each fix a small red and green proof.
  The last gate still runs every planted case.
- The native resource-close test uses the fixed transport seam.
  App references to that resource are forbidden; tests stay outside src.
- The original edit limits and trial-store ban still apply.

### Fix 1: built-in fetch references

The rule follows TypeScript's built-in declarations.
It catches value uses, aliases, window and self methods, and destructuring.
Type queries and injected backend values remain allowed.
Only the httpBackend default callback may reference the built-in.
All five escaped forms pass the old check, which makes each red proof exit 1.
All five green proofs reject the planted use by the http-request rule.
The check accepts --cases to run named proofs; --prove alone still runs all cases.

### Fix 2: error request facts

HttpRequestFailed now stores only method and path.
The native cause is not retained because it can carry the full URL.
The regression uses a URL and cause with a query token.
Its exact payload check fails on the old error and passes on the new one.
The HTTP span name still includes the path, as the user asked.
A token in that path would show.

### Fix 3: the request is the app entry

Both app seams export only httpBackend and httpRequest.
The check follows the raw resource symbol and rejects app value references.
A direct dependency, alias import, or re-export gets the http-resource rule.
Fixed scaffold code retains the resource for httpRequest.
Its native-close test imports the fixed transport seam, not an app seam.
Both planted cases pass the old check and fail the new rule.

### Fix 4: one checked method

The input schema accepts only HTTP token characters.
Zod's toUpperCase step changes the method once, before the run.
The backend and span read that same checked value.
The declaration list permits this Zod step, not arbitrary transforms.
Two regression tests fail on the old method input.
They prove lower-case and custom token sends, and rejection before backend work.

Core input trusts a typed fact and skips the schema.
A plain string type cannot promise a checked upper-case method.
The request schema now marks its output with a Zod brand.
Raw request values go through rawInput; unmarked typed input does not compile.
The filled skills and scope tests use that same input door.
No Core change or repeated validation was needed.

### Fix 5: response header values

Response headers are a record of string arrays.
The resource reads set-cookie through native getSetCookie.
Each cookie stays separate; commas inside dates are kept.
Other repeated values keep the native join inside one array entry.
The regression covers two cookies and an ordinary repeated header.
It fails on the old header record and passes on the new one.
The existing reply proof and filled testing skill use the new shape.

### Fix 6: browser import guard

The shared httpBackend tag now lives in src/scaffold/http-backend.ts.
Telemetry imports that file on both sides.
The HTTP resource and request stay in backend/http.ts.
The broad browser exception is gone.
The fetch rule allows only the shared tag's default callback.
A fourth boundary case imports httpRequest into a browser.
It builds before the fix and is denied after the fix.
The real app build proves browser telemetry can still use the shared tag.

### Fix-round review answers

The earlier HTTP handoff above describes the first implementation.
This fix round replaces its URL error payload, app exports, and browser exception.
The final preflight still compares a5c12db9 with HEAD.
It exits 0 with one file flag and three unit flags.
The brief bars tools edits, so these filled labels stay for the lead.

- http-backend.ts: leakedInternal = false.
  ADR 0102 requires the public backend tag for bound test sends.
  The shared telemetry sender also needs this browser-safe tag.
- http: stopOnlyInDefer = false.
  The resource owns close abort; each send also reads its caller's signal.
  The caller-close test proves body reading stops before root close.
- httpRequest: configNotTag = false.
  URL, method, headers, and body are request input.
  The native sending function comes from the backend tag.
- delivery: configNotTag = false.
  Settings and sending come from tags.
  The content types and field query keys are fixed wire rules.

S24 still points at the required built-in default.
The brief leaves its rule update to a later card.
The extension note owes no label.
The test check has zero flags in 48 tests.
The promise check has zero gaps and one unsure match.

```bash
backend_file=apps/start-scaffold/src/scaffold/\
http-backend.ts
node tools/jev/label.mjs leakedInternal false \
  "$backend_file" --by start/http-resource \
  --why "The public tag binds tests and sends telemetry."
http_file=apps/start-scaffold/src/scaffold/\
backend/http.ts
node tools/jev/label.mjs stopOnlyInDefer false \
  "$http_file#http" --by start/http-resource \
  --why "Close aborts; caller signals also stop sends."
node tools/jev/label.mjs configNotTag false \
  "$http_file#httpRequest" --by start/http-resource \
  --why "Request values are input; sending is a tag."
delivery_file=apps/start-scaffold/src/scaffold/\
telemetry/delivery.ts
node tools/jev/label.mjs configNotTag false \
  "$delivery_file#delivery" --by start/http-resource \
  --why "Settings and sending are tags; fields are fixed."
```

The first full plain proof raced a root rebuild.
It read missing built declarations and reported 149 plain functions.
That run exited 1; no rule or source change was needed.
The proof was restarted after the root build finished.
No timing claim or full mutation lane is part of this card.

### Fix-round final proof

All six fixes have a separate commit and red then green proof.
The proof pairs have red exit 1 and green exit 0.
The method fix has two tests in the same red and green logs.
The full plain proof passes 95 planted failures and keeps 17 plain functions.
The required root chain exits 0.
It passes 1,217 repo tests, with one existing skip.
The app passes 48 tests; the copied starter passes 46.
Root check keeps zero errors and the same 28 warnings.
All 16 validate lanes pass.
All 113 registry files match source.
The copied starter's 15 gates each exit 0.
Types, seam, seam fixture, browser guard, imports, schema, and middleware pass.
Strict style census and TSDoc also exit 0.
The mutation-script presence check ran alone under flock and exits 0.
There is no Start scaffold mutation script, and no full lane ran.

The full command, exit-code, and log list is HTTP-RESOURCE-FIX-GATES.json.
It includes each fix proof, every planted case, and every consumer gate.
The chain log is /tmp/http-review-gate-chain.log.
The last check and prose logs use the http-review-final prefix.

Fix commits:

- a8add31c: reject built-in fetch value references.
- 81aba3b3: keep only method and path in HTTP failure facts.
- 87dd138f: keep the raw HTTP resource out of app seams.
- 37c20763: check and upper-case the method once.
- a539c8b4: keep repeated reply headers.
- c931fcaf: keep HTTP requests behind the browser guard.

The next commit saves the rebuilt registry and this final proof.
The card waits for the lead to review and land.
Only the two allowed folders changed.
No stash, push, trial-store access, or container command was used.
Every long job was awaited in this turn.
The path-token warning above remains part of the shipped rule.

## HTTP resource second lead fix round

Reviewed head: 450f217c, rebased onto docs-only origin/main 880f1c4f.
Owner: Sol writer; the lead owns review and landing.
Next: fix each of three items, then rebuild and run all gates.
Verify: round2 in HTTP-RESOURCE-FIX-GATES.json records commands, exits, and logs.

### Assumptions and limits

- The lead's three requests refine the brief and earlier fixes.
- Only httpRequest is the app's HTTP entry.
  Tests bind httpBackend through a fixed scaffold seam.
- The literal import ban covers the named HTTP clients and raw sockets.
  It applies outside src/scaffold only, across src.
- Error facts keep method and path plus string name and code when present.
  Native fetch can put a socket error in its cause; read those safe fields too.
  Messages, URLs, and the cause object are never retained.
- The two-span shape stays: http.request owns the named HTTP child.
- Computed keys and Reflect.get remain deliberate escapes.
  This round does not change them.
- The path stays visible; a token in the path would show in the span name.
- No questions, stash, push, or trial-store access.
  Only the original two folders may change.

### Round 2 fix 1: the backend tag stays fixed

Both app seams now export only httpRequest.
The check follows the backend tag's declaration and rejects app references.
The rule applies outside src/scaffold, including aliased dependencies and type references.
Tests bind the tag through the fixed transport seam.
The planted dependency passes the old rule, giving red exit 1.
The new rule denies it with http-backend, giving green exit 0.
The fixed telemetry sender still uses the tag directly.

### Round 2 fix 2: other client imports

The plain check rejects literal imports of all twelve named modules outside src/scaffold.
The rule also covers literal subpaths, re-exports, dynamic import, require, and import-equals.
It does not need the foreign package to be installed or typed.
Seventeen planted cases each pass the old rule, giving red exit 1.
The new http-client rule denies each planted case.
No case sends a request or opens a socket.
Computed keys and Reflect.get stay as they were.

### Round 2 fix 3: safe native error facts

HttpRequestFailed keeps method and path.
Its optional cause record contains only optional string name and code.
The caught external value is read once by a stripping Zod object schema.
Native fetch can wrap a socket error in cause.
Those inner fields take precedence, with the wrapper fields as fallback.
An unrecognized value leaves cause absent.
No message, URL, stack, or native error object is retained.

The revised seam test uses a direct refused-connection error and a wrapped DNS error.
It expects TypeError with ECONNREFUSED, then Error with ENOTFOUND.
Both native errors carry messages and URLs with query tokens.
Exact payload checks prove that only name and code survive.
The test fails on the old method/path-only payload and passes on the new facts.
The request and named child spans stay unchanged.

Filled payload:

```ts
{
  method: "GET",
  path: "/x",
  cause: { name: "Error", code: "ENOTFOUND" },
}
```

### Round 2 Jev answers

The preflight compares origin/main 880f1c4f with this branch.
It exits 0 with one file flag and three unit flags.
The brief bars tools edits, so these filled labels stay for the lead.

- http-backend.ts: leakedInternal = false.
  Only fixed scaffold code and seam tests need the exported tag.
  App seams no longer export it, and app references are banned.
- http: stopOnlyInDefer = false.
  Close aborts the owned requests; each send also reads its caller's signal.
  The caller-close proof stops body reading before root close.
- httpRequest: configNotTag = false.
  URL, method, headers, and body are request input.
  The error reader keeps only safe external facts.
  Native sending comes from the fixed backend tag.
- delivery: configNotTag = false.
  Settings and sending come from tags.
  The content types and storage field keys are fixed wire rules.

S24 still points at the required built-in default.
The brief leaves its rule update to a later card.
The extension note owes no label.
The test check has zero flags in 48 tests.
The promise check has zero gaps and one unsure match.
No new Core feedback came from this round.

```bash
backend_file=apps/start-scaffold/src/scaffold/\
http-backend.ts
node tools/jev/label.mjs leakedInternal false \
  "$backend_file" --by start/http-resource \
  --why "The fixed tag serves tests and telemetry."
http_file=apps/start-scaffold/src/scaffold/\
backend/http.ts
node tools/jev/label.mjs stopOnlyInDefer false \
  "$http_file#http" --by start/http-resource \
  --why "Close aborts; caller signals also stop sends."
node tools/jev/label.mjs configNotTag false \
  "$http_file#httpRequest" --by start/http-resource \
  --why "Request values and error facts are not settings."
delivery_file=apps/start-scaffold/src/scaffold/\
telemetry/delivery.ts
node tools/jev/label.mjs configNotTag false \
  "$delivery_file#delivery" --by start/http-resource \
  --why "Settings and sending are tags; fields are fixed."
```

### Round 2 final proof

All three fixes have separate commits and red then green proof.
The backend case and revised error test each have red exit 1 and green exit 0.
Each of the seventeen client cases has a separate red exit 1 log.
Their shared green log proves all seventeen fail by http-client.
The full plain proof passes 113 planted failures and keeps 17 plain functions.

The required root chain exits 0.
It passes 1,217 repo tests, with one existing skip.
The app passes 48 tests; the copied starter passes 46.
Root check has zero errors and the same 28 warnings.
All 16 validate lanes pass.
All 113 registry files match source.
The copied starter's 15 gates each exit 0.
Types, seam, seam fixture, browser guard, imports, schema, and middleware pass.
Strict style census and TSDoc also exit 0.
The mutation-script presence check ran alone under flock and exits 0.
No Start scaffold mutation script exists, so no full mutation lane ran.

The first error-metadata catch exceeded the lint branch cap.
Its exit 1 log is preserved as http-round2-fix3-check-first.log.
An early exit for unreadable facts fixed the limit before the source commit.
The final code keeps the same safe fields and introduces no helper.

Read latestRound and round2 in HTTP-RESOURCE-FIX-GATES.json for this round.
That record includes every command, exit code, log, proof pair, and copied gate.
The root chain log is /tmp/http-round2-gate-chain.log.
The first round's proof remains as history.

Source commits:

- 8cd09571: keep backend tag references inside fixed scaffold code.
- ebc8f0b3: ban the named HTTP clients and raw socket imports in app code.
- cbb70493: keep safe native error name and code facts.

The next commit saves the rebuilt registry and final proof.
The two-span shape, computed keys, and Reflect.get remain as the lead asked.
The path-token warning remains in force.
Only the two allowed folders changed.
No stash, push, trial-store access, or container command was used.
All long jobs were awaited in this turn.
The card waits for lead review and landing.

## HTTP polish: writer start

Card: start/http-polish.
Owner: Sol writer; lead owns review and landing.
Next: prove and fix each import gap, then safe cause fields.
Verify: red then green logs; plain proof; seam; registry; app tests.
Also verify build, check, prose, all repo tests, and validate.

Assumptions:

- The supplied worktree is installed; no pull or install is needed.
- The target brief allows the fixed scaffold edits it names.
  This overrides the copied app skill's feature-only edit rule.
- Keep TODO.md as supplied; it is outside the allowed folders.
- A type-only import has no default or value binding.
  An empty import or a mixed import still sends code.
- Read name and code on their own, nested cause first.
  Keep the outer field when the nested field cannot be read.
- Rebuild before checks; keep logs outside the source tree.
- Do not land, push, run mutation lanes, or touch trial storage.

Logs: /tmp/tinkered-http-polish-logs/.

### Step 1: four missing client bans

The node:http2, http2, ws, and ofetch cases each fail the old proof.
Each red proof exits 1 because the old checker allowed the import.
The updated client list rejects all four by http-client.
Red logs: 01-client-<name>-red.log in the log folder above.
Green log: 01-clients-green.log.

### Step 2: type-only imports

Both import type and all-type named imports fail the old checker.
Each red proof exits 1 because it expected an allowed import.
The checker now skips only imports with type-only bindings.
The proof keeps mixed, default-plus-type, and empty imports banned.
The app README and forms skill state the same rules.
Red logs: 02-import-type-red.log and 02-named-import-type-red.log.
Green log: 02-types-green.log in the same log folder.

### Step 3: safe cause fields

Three new public-seam tests each fail without the fix, exit 1.
An abort failure keeps AbortError and numeric code 20.
A string cause keeps the outer name and string code.
A wrong-type field cannot discard the other readable field.
Readable inner fields win; outer fields fill any missing fact.
The exact payload checks keep messages and URLs out.

Assumption: read the error fields inside the owned catch body.
The plain check allows these readers there.
No new module-level schema method or plain helper is needed.
The README and forms skill now promise these safe fields.

Red logs: 03-abort-red.log, 03-string-cause-red.log, and 03-partial-fields-red.log.
Green logs use the same names with green in place of red.

### Step 4: registry and final proof

The registry check fails before rebuild, exit 1.
Its saved HTTP payload differs from the changed source.
Red log: 04-registry-red.log.

Assumption: use origin/main..HEAD for Jev.
The user pinned origin/main at 7f27950b.
The local main ref is older, at 59f902b3.
Using it would judge unrelated landed work.
Keep both refs as supplied.

### Jev answers

The pre-flight has no file flags and two unit flags.
The test check has no flags in 51 tests.
The promise check has no gaps in 51 titles and one unsure old SSE title.

- stopOnlyInDefer = false for http.
  Each send reads its caller signal as well as the owned close signal.
  The caller-close test stops body reading before root close.
  The same label already exists as bec8ff9e563e.
- configNotTag = false for httpRequest.
  Request values and error facts come from this call.
  Native sending comes from the backend tag.
  The new label is b70914c768c7.

Both exact label rows are in HTTP-POLISH-JEV-LABELS.jsonl.
Assumption: leave the shared tools/jev/cases.jsonl unchanged.
It is outside the two folders the target brief allows.
The lead can merge the new row and calibrate when landing.
This is the sole shared-bank step deferred to the lead.
No new Core feedback came from this card.

### Lead addition: raw socket and browser sends

The lead added four imports and two browser send APIs to this card.
Ban net, tls, dgram, and node:dgram outside src/scaffold/.
Ban XMLHttpRequest constructors and global value uses there.
Ban navigator.sendBeacon calls and value uses there.
Each named ban gets red then green proof.
Literal bracket access gets proof too.

WebSocket and EventSource stay allowed under ADR 0048.
They carry userland sync transports.
Their resources still own the connection and close it through ctx.defer.
Two planted allowed cases prove that rule remains in place.

Assumption: match the browser APIs by their declared native symbols.
This keeps the existing type-only rule.
The final registry and full plain proof will include the added cases.

The ten added banned cases each fail the old proof, exit 1.
The old checker allowed each path.
The updated checker rejects them by http-client.
It reuses the native-symbol reader already used for fetch.
The two allowed transport cases must exit 0.

The first full plain proof passed all 122 earlier cases.
The lead addition requires a fresh full proof of 134 cases.
Its final logs use the 13 prefix.
Red addition logs: 12-client-<case>-red.log.
Shared green addition log: 12-extra-green.log.

### Root gate after the lead addition

The root build, check, app tests, and all repo tests chain exits 0.
The app passes 51 tests.
The repo passes 1,222 tests with one existing skip.
Root check has zero errors and the same 28 warnings.
The 16 validate lanes all pass, exit 0.

The final registry was rebuilt after the added bans.
The added-case proof passes all ten banned cases and both allowed transports.
No TypeScript source changed after the earlier Jev and strict style checks.
The remaining full plain and copied registry proofs use the final source.
Their finished results will be saved in HTTP-POLISH-GATES.json.

Gate chain log: /tmp/tinkered-http-polish-logs/08-gate-chain.log.
Validate log: /tmp/tinkered-http-polish-logs/09-validate.log.

### Final writer proof

The final plain proof passes all 134 cases, exit 0.
It has 130 planted failures and four allowed cases.
The allowed cases are both type-only imports and both sync transports.
The source still has 17 plain functions.

All 113 registry files match final source.
All 15 copied-starter gates exit 0.
The copied starter passes 49 tests.
The native WebSocket and EventSource exceptions remain in force under ADR 0048.

[HTTP-POLISH-GATES.json](HTTP-POLISH-GATES.json) records each command, exit code, and log.
It includes 21 separate red then green proof pairs.
Each red check exits 1; each fixed check exits 0.
The four allowed final cases each exit 0.

[HTTP-POLISH-JEV-LABELS.jsonl](HTTP-POLISH-JEV-LABELS.jsonl) holds the two false label rows.
The lead owns the shared bank merge and landing calibration.
No new Core feedback came from this work.
No full mutation lane was requested.
Only the two allowed folders changed.
No stash, push, trial-store access, or container command was used.
All long jobs finished before this report.
The writer's code and registry are ready for lead review.

Final proof log: /tmp/tinkered-http-polish-logs/13-plain-prove.log.
Final registry log: /tmp/tinkered-http-polish-logs/13-registry-green.log.
The next commit saves the final registry, label rows, and this proof record.

## HTTP graceful close: writer start

Card: start/http-graceful.
Owner: Sol writer; lead owns review and landing.
Next: prove the hang, stop HTTP waits before close, then rebuild the registry.
Verify: red then green tests; plain proof; seam; registry; app tests.
Also verify build, check, prose, all repo tests, and validate.

Assumptions:

- The supplied worktree is installed at origin/main ecdfb486.
- Keep TODO.md as supplied; it is outside the allowed folders.
- The target brief allows fixed scaffold changes for this repair.
- Use the shipped startRequests extension for scopes that send HTTP.
  Bare Core scopes cannot gain a close hook from a resource factory.
- Core close hooks run on roots only.
  The start hook must also bind child session close methods.
- An owned resource method may bind native Core handles.
  It owns the close adapter; no plain helper takes a scope.
- A graceful HTTP abort raises HttpRequestFailed.
  A forced close still uses the caller signal and returns cancelled.
- Use the test runner's 2 s limit as the probe's bound.
  A backend handshake starts close; no sleep or timer drives the test.
- The named payment lines now hold route code, even at the pinned commit.
  Follow the brief's stated abort-before-join rule.
- Use origin/main for Jev; leave shared label files to the lead.
- No full mutation lane was requested.

Logs: /tmp/tinkered-http-graceful-logs/.

### Step 1: red proof

The root and session graceful-close tests each hit the 2 s limit, exit 1.
The late-send test fails because the backend still receives the request, exit 1.
The forced root and session control passes before the fix, exit 0.
That control needs before/after green proof, not a made-up red failure.
The tests reuse the review probe's abort-aware, never-answering backend.
The test runner sets the bound; the tests have no sleep waits.

Red logs: 02-root-red.log, 02-session-red.log, and 02-late-red.log.
Control log: 02-forced-before.log.

### Step 2: HTTP close ownership

Each HTTP resource now owns one stop signal through body reading.
Its close method stops every owned send and bars later sends.
The startRequests start hook binds a private close adapter to its root.
The adapter also binds sessions made with createSession.
A graceful close stops that handle's HTTP subtree before Core joins work.
A forced close still lets Core fire the caller's cancel signal first.
The adapter returns the original close result and keeps the first close mode.
Child cleanup removes its retained stop method from its parent.

The plain check keeps the same 17 functions.
The adapter's public native methods stay inside a private resource.
Only the composing server hook is exported.
No Core file or plain-check rule changed.

The first build rejected a backend import from shared Start code.
The import now lives inside createIsomorphicFn's server callback.
The client callback still calls next once.
Earlier plain checks rejected free close callbacks and an exported scope-returning method.
Owned native methods and a private resource fix those findings.
Earlier check logs keep the unbound-method warnings; the final code binds native methods.
Exploratory checks reused the last completed build; final gates each rebuild first.

All 15 HTTP tests pass in 03-http-private.log, exit 0.
Plain: 03-plain-private.log, exit 0.
Build: 03-build-private.log, exit 0.
Check: 03-check-private.log, exit 0.

### Step 3: child and other-work proof

Three more tests fail on the pinned original source, each exit 1.
Each hits the same 2 s bound while waiting for graceful close.
The saved source commit was restored after those red runs; no stash was used.

- Root close stops HTTP waits in nested sessions.
- Session close stops its subtree and leaves its sibling open.
- HTTP close leaves other work running until that work finishes.

Red logs: 04-nested-root-red.log, 04-siblings-red.log, and 04-other-work-red.log.
All six bug tests now have separate green logs, each exit 0.
Green logs: 04-<case>-green.log for root, session, late, nested-root, siblings, and other-work.
Each green test has its own successful build log with green-build in its name.
The forced control is green before and after, each exit 0.
Its final log is 04-forced-green.log.
The broad census used the wrong targets and exits 1 in 04-census.log.
It read generated route source and the test preset as authored source.
The final census checks the three changed TypeScript files.

The saved registry fails its source check before rebuild, exit 1.
Log: 04-registry-red.log.
The next step rebuilds it, then runs every final gate.

### Jev and the pinned base

The shared origin/main ref moved while this work ran.
The final preflight uses the user's pinned ecdfb486..HEAD range.
The first ref-based run included unrelated trial files; it is kept as history.
The original HTTP and Start source blobs match both bases.
All red source runs used the pinned original code.

The pinned preflight has no file flags and three unit questions.
Each answer is false:

- effectWithoutDefer: httpScopes clears child holds with ctx.defer.
  Child onClose drops its parent hold; Core still owns native teardown.
- stateOutsideCell: held native methods and stop methods are private work state.
  The close phase is lifetime state, not a saved or visible record.
- configNotTag: request values and safe error facts belong to this call.
  The backend still comes from httpBackend.

The exact rows are saved in HTTP-GRACEFUL-JEV-LABELS.jsonl.
The label command ignored JEV_BANK when appending.
Its two new rows were moved into the allowed docs folder.
The shared bank was restored byte for byte.
The third row already existed there.
The lead owns merging the rows and landing calibration.
No tools file remains changed.

### Core feedback

Core has no resource callback for the start of graceful close.
Its extension close hook runs on roots, not child sessions.
A resource's ctx.defer runs after Core joins owned work.
The scaffold binds native close methods during start.
This keeps the repair inside the shipped scaffold.
Small scopes must install startRequests to get this rule.

Failing shape before this repair, from the red session test:

```ts
const target = scope.createSession();
const sending = target.settle(httpRequest, {
  rawInput: {
    url: "https://slow.test/x",
    method: "GET",
  },
});
await backend.started;
const closing = target.close({ graceful: true });
await sending;
await closing;
```

The backend is createHeldBackend from tests/http.test.ts.
It stops only when the request signal aborts.
The red log is 02-session-red.log; the green log is 04-session-green.log.
The lead can use this as a Core follow-up; no Core file changed.

### Step 4: keep Core's close rule during cleanup

The first full gate pass was green, including the 134 plain cases.
All 16 validate lanes and all 15 copied-starter gates passed.
The source review then found a flaw in the scaffold's close promise cache.
Once close had joined other work, cleanup could call close again.
The cache returned the waiting promise, so cleanup waited on itself.
Core already handles that call with its own close rule.

The new public-seam test fails on the cache, exit 1.
It holds ordinary work, starts graceful close, then lets work finish.
Cleanup calls its own owner's close before returning.
The same test covers root and session owners after the fix.
No sleep or timer drives the test.

The adapter now holds only an open-or-closing phase.
It stops HTTP once, then delegates every close call to Core.
Core keeps the result, first mode, and cleanup rule.
The new test passes, exit 0.
All 19 HTTP tests pass in the verbose final log, exit 0.

Red: 08-cleanup-red.log.
Green: 08-cleanup-green.log.
All HTTP tests: 08-http-final.log.
Check: 08-check-final.log.
The registry and full proof will be rebuilt for this last source change.

The final cleanup assertion reads the whole close result.
A failed cleanup assertion can be kept in teardownErrors by Core.
Checking the whole result makes that failure visible to the test.
Final HTTP proof: 09-http-final.log, all 19 tests green.
The final label rows use the phase-based source in the same docs file.
The rows use the shipped slice and forJev readers.
They keep the label command's exact row shape and hash rule.
The shared bank remains unchanged.

### Final writer proof

The final source passes all 134 plain proof cases, exit 0.
It keeps the same 17 plain functions.
The root build, check, app tests, and all repo tests chain exits 0.
The app passes 59 tests; the repo passes 1,230 with one existing skip.
Root check has zero errors and the same 28 warnings.
All 16 validate lanes pass, exit 0.
All 113 registry files match the final source.
All 15 copied-starter gates pass, exit 0.
The copied starter passes 57 tests.
Types, imports, seam, seam fixture, browser guard, schema, and middleware pass.
Strict style census and TSDoc pass, exit 0.

Seven bug tests have red exit 1 and green exit 0.
The forced-close control has before and after exit 0.
The final verbose HTTP log names all 19 passing tests.
Jev has no file flags, no test flags, and no README gaps.
Its three unit answers are false; the old unsure title remains a note.
The lead owns shared-bank merge and landing calibration.

[HTTP-GRACEFUL-GATES.json](HTTP-GRACEFUL-GATES.json) records each command, exit code, and log.
It also records every bug proof pair, the forced control, and copied gates.
[HTTP-GRACEFUL-JEV-LABELS.jsonl](HTTP-GRACEFUL-JEV-LABELS.jsonl) holds the exact final label rows.

Final chain log: /tmp/tinkered-http-graceful-logs/10-gate-chain.log.
Final HTTP log: /tmp/tinkered-http-graceful-logs/09-http-final.log.
Final plain log: /tmp/tinkered-http-graceful-logs/09-plain-prove.log.
Final registry log: /tmp/tinkered-http-graceful-logs/09-registry-green.log.

Only the two allowed folders remain changed.
No Core change, stash, push, trial-store access, or container command was used.
All long jobs ended before this report.
No full mutation lane was requested.
The added cleanup test fixes a flaw found in this writer's first close cache.
The first full green pass stays as history; the 09 and 10 logs check final code.
The card waits in Review for the lead.
The next commit saves the rebuilt registry and final proof.

### HTTP fix round: stop tags through Core call sessions

Owner: start/http-graceful writer.
Next: rebase onto origin/main, install, build, then prove the review bugs.
Verify: red then green per changed HTTP rule; all source and copied gates.

The lead marked the first repair NOT READY.
This section replaces its claims about direct graceful close.
Core makes child sessions for calls with signal or tags (ADR 0090).
The old method overrides cannot reach those sessions.
Use optional backendStop and requestStop tags instead.
They reach explicit sessions and Core's call sessions.
Remove the overrides, child sets, and startup binding loop.

A backendStop abort ends outgoing HTTP when server shutdown starts.
A requestStop abort ends that request's outgoing HTTP.
A direct graceful close with no stop signal cannot stop a pending HTTP wait.
Core has no session close-start hook for that case.
The lead owns the Core follow-up row.
Other work keeps Core's graceful rule; forced close keeps its cancellation rule.

Assume the lead's stop-tag direction replaces the original brief's close hook.
Keep stop tags optional for tests and roots outside Start.
Tests reuse the review probe's abort-only backend and bounded settlement shape.
The late-send proof must use httpRequest and narrow HttpRequestFailed.

The lead also moved origin/main to repo/vite-plus-1 (3af9aae6).
Save these notes before fetch and rebase.
Keep both sides of any progress-log conflict.
Run vp install, restore CLAUDE.md if changed, then rebuild.
Keep the new Vite config settings and await every async assertion.

#### Fix 1: use inherited stop tags; remove method overrides

Rebase, install, and the first build passed, exit 0.
The new base is dfc31bdc, which includes 3af9aae6.
No progress-log conflict occurred.
CLAUDE.md was restored after install.
The compatibility settings stay as landed.

Five new bug tests failed on the old code, each at its two-second bound.
They cover the server-function signal call, root signal call, root tagged call,
request end with a sibling still open, and ordinary work during root stop.
Red: /tmp/tinkered-http-graceful-round2-logs/02-regressions-red.log (exit 1).
All 18 HTTP tests now pass.
Green: /tmp/tinkered-http-graceful-round2-logs/03-http-green.log (exit 0).
Call-signal cancellation and forced root/session close still return cancelled.
Tests without Start can leave both stop tags unbound.

The http resource depends on backendStop.optional and requestStop.optional.
Its send signal joins the caller, owned cleanup, and bound stop signals.
The httpScopes resource and httpClosing extension are gone.
No code replaces scope.close or scope.createSession.
No child set, per-session binding, or double-install loop remains.
The startup hook calls event.next once and returns the root context.

The old tests and README claims for direct graceful close are retired.
They promised a rule the scaffold cannot supply through Core's hooks.
The README, HTTP TSDoc, and forms skill now name the stop-tag rule and limit.
The late-send test follows as its own fix.

Core feedback for the lead: direct close can still wait without a stop tag.
This is the failing shape; the backend waits only for abort.

```ts
const session = scope.createSession();
const pending = session.settle(httpRequest, {
  rawInput: { url: "https://slow.test/x", method: "GET" },
  signal: new AbortController().signal,
});
await backend.started;
await session.close({ graceful: true });
await pending;
```

The limit needs a Core session close-start hook, not a method replacement.
No Core file changed; the lead files the row.

#### Fix 2: reject late HTTP through the managed operation

The late-request test now calls httpRequest through settle with call tags.
It tests both backendStop and requestStop after abort.
The backend fake would return a response if called.
The test narrows HttpRequestFailed and checks method, path, and zero sends.

Both cases failed before the fix: the backend sent and the call succeeded.
Red: /tmp/tinkered-http-graceful-round2-logs/04-late-red.log (exit 1).
The sender now checks the joined signal before it calls the backend.
The check covers caller cancellation, owned cleanup, and either stop tag.
No direct http.send assertion stands in for the managed operation.

Both late-send cases now pass, and all 20 HTTP tests pass, exit 0.
Green: /tmp/tinkered-http-graceful-round2-logs/04-http-green.log.
The next step rebuilds the registry and runs every final gate.

#### Final fix-round proof

The registry failed its exact-source check before rebuild, exit 1.
The rebuilt registry passes, exit 0; all 113 copied files match source.
All 15 copied-starter gates pass, including 58 tests.
Its Core and React packages are packed tarballs, with an independent npm install.

All 134 plain proof cases pass, exit 0.
The 130 banned cases each return the expected exit 1.
The four allowed cases each return the expected exit 0.
The same 17 plain functions remain.
Seam, seam fixture, browser boundary, imports, schema, middleware, and types pass.
TSDoc and strict style census pass.
All 16 validate lanes pass.

The full chain passes, exit 0: build, check, app tests, all package tests.
All 20 HTTP tests and all 60 app tests pass.
All 1,244 repo tests pass, with one existing skip.
Check has zero errors and the same 28 warnings.
No async assertion is left unawaited.
The new Vite config compatibility settings stay unchanged.

Seven bug tests have named red exit 1 and green exit 0 proof.
The five stop-tag bugs fail at the two-second bound before the fix.
The two late-send bugs fail because the managed request succeeds before the guard.
Call-signal cancellation and forced close pass as unchanged controls.
Each test's red and green logs are in HTTP-GRACEFUL-GATES.json.

Jev reports no file flags, no test flags, and no README gaps.
One old SSE title stays unsure, below its flag threshold.
The sole unit flag is configNotTag on httpRequest; its answer is false.
Why: URL, method, headers, and body are checked request input.
The backend and stop settings come from tags.
The exact row is saved in HTTP-GRACEFUL-JEV-LABELS.jsonl.
It uses the shipped slice/forJev readers and the label command's hash and row shape.
The two labels for the removed httpScopes adapter are retired.
The brief's folder limit keeps the shared bank untouched.
The lead owns the bank merge and landing calibration.

Final chain: /tmp/tinkered-http-graceful-round2-logs/07-chain.log.
HTTP proof: /tmp/tinkered-http-graceful-round2-logs/04-http-green.log.
Plain proof: /tmp/tinkered-http-graceful-round2-logs/06-plain-prove.log.
Registry proof: /tmp/tinkered-http-graceful-round2-logs/06-registry-green.log.
The gate record holds every command, exit code, and full log path.
It also holds all plain cases and copied-starter gates.

Only the two allowed folders changed.
No Core method override, child set, binding loop, or per-session binding remains.
No Core edit, stash, push, trial-store access, or container command was used.
No full mutation lane was requested.
All long jobs ended before this proof was saved.

Next: commit the registry and proof, then lead review.
The direct graceful-close limit remains recorded above and in the HTTP TSDoc.
The lead owns the Core hook follow-up.

## Protocol reply writer

Owner: start/protocol-reply writer.
Next: prove the wire cases on 2d307cf5 before moving HTTP work.
Verify: each source change red then green; all brief gates.

The Doing card already exists in TODO.md.
The brief limits edits to the app, this track, and ADR 0103.
The lead keeps the board; this section records writer steps.
Assume tests may call exported route handlers as the HTTP seam.
Compare exact status, all headers, and body against fixed wire facts.
Keep the same test before and after the move.
No trial store or container is needed.

### Step 1: wire facts before the move

The unchanged source passes the wire test, exit 0.
It covers ten telemetry cases and four sync cases.
Each compares status, all headers, and body.
Last-Event-ID wins over a bad query cursor.
The first SSE body is the exact connected frame.
The test calls the exported route handlers with real scopes.
The sync route uses the real local proof database and auth.
No module or global is patched.

Proof: .protocol-reply-logs/01e-baseline.log.
That log includes build, types, wire tests, format, and prose.
Early test drafts failed on cleanup and route argument types.
They are saved as 01 through 01d logs.
No source was changed to make the wire facts pass.

The saved wire tests also pass types and the staged code check.
Proof: 01g-baseline.log and 01h-check.log.
The last check needs --fix before file paths in Vite+ 1.0.
A first commit try caught two long test branches.
Two shared test readers now keep each branch small.

### Step 2: telemetry params and reply

The new batch and managed-stop tests fail on the old operation, exit 1.
Red: .protocol-reply-logs/02-params-red.log.
The route now checks origin, headers, bytes, JSON, and browser records.
The operation takes Telemetry.Batch and returns no reply.
It raises Cancelled when a bound stop signal has ended.
The route maps that error to 503 and success to 202 with no-store.
The route retains body cancellation and releases the reader in finally.

Green: .protocol-reply-logs/02b-telemetry-green.log, exit 0.
All 13 telemetry, wire, and plain-batch tests pass.
Build, app types, and the changed-file code check pass too.
The existing body-close test now calls the route.
No telemetry operation reads a Request or builds a Response.

### Step 3: sync cursor and body

The final real-database cursor test fails on the old source, exit 1.
Red: .protocol-reply-logs/04-final-test-red.log.
The original smaller test also failed before the move.
It needed real settings even with a resource preset.
The final test uses the real proof database instead.

The route reads the query and Last-Event-ID, and checks the cursor.
openSync takes only a cursor param and returns the body stream.
The route sets all three SSE headers.
The request resource still owns the body after open ends.
The existing replay, account-change, and waste tests use the plain input.

Green: .protocol-reply-logs/04c-sync-green.log, exit 0.
All 14 related tests, app types, build, and changed-file checks pass.
Final cursor and wire rerun: 04d-sync-final-green.log, exit 0.
The exact wire facts still match the first saved test.

### Step 4: mounted auth and hidden headers

The existing auth tests fail through the protocol export before the move.
Red: .protocol-reply-logs/05-auth-red.log, exit 1.
The mounted third-party handler now lives in scaffold/backend/auth.server.ts.
It is the only named Request/Response operation exception in ADR 0103.
Assume keeping its settled call is needed for auth failure and mail ownership.
The route and proof tests call it; the app backend does not export it.

requestHeaders now lives in scaffold/backend/headers.server.ts.
Only request wiring and auth read it.
The app backend and server seam no longer export it.
Proof tests bind it through the protocol test entry.
The wire test changed only its header-tag import.
Its cases and expected replies stay the same.

Green: .protocol-reply-logs/05-auth-green.log, exit 0.
All 65 app tests, build, app types, and changed-file checks pass.
The real auth tests cover sign-in, sign-out, mail, and sessions.

### Step 5: own body cancellation

The plain gate found the new route's cancel listener outside the graph.
Red: .protocol-reply-logs/03-union-correct-red.log, exit 1.
The failure is service-owner on api.telemetry.ts.
The requestBody resource now owns that reader and cancel listener.
The route borrows the reader, checks bounded bytes, and releases it in finally.
Resource cleanup also releases it when the request ends.
No body checks or HTTP replies moved into an operation.

Green: .protocol-reply-logs/06-reader-green.log, exit 0.
Build, types, fourteen related tests, plain, and code checks pass.
The plain list is rebuilt; the same seventeen functions remain.

### Step 6: protocol and HTTP guard cases

Fifteen new planted cases now pass with the expected exit codes.
Fourteen banned cases return 1; the type-only export returns 0.
The before-check proof returns 1 for each missing rule.
Those red logs are 03-CASE-red.log in .protocol-reply-logs.
The union case uses 03-union-final-red.log.
Two added loader cases use 07-aliases-red.log and 07-create-destructured-red.log.
The red wrapper for each case fails because the old guard accepted bad code.
For the allowed type export, the old guard rejected good code.

The guard resolves whole-Request schemas and sync or async Response returns.
Only the named protocol auth mount is excepted.
It catches destructured fetch, sendBeacon, and XMLHttpRequest.
It rejects computed import and require paths and createRequire references.
It catches renamed require and destructured createRequire too.
Type-only imports and exports remain allowed.

Green: 07c-guard-check.log and 07-aliases-green.log, exit 0.
Each log names the planted case, its rule, and its own proof log.
The thirteen earlier per-case green logs also stay saved.
Code checks pass with zero warnings on the changed script.
The full proof will run on the final source after the remaining doc fixes.

### Step 7: finish header hiding and review leftovers

The protocol entry still exported the raw header tag after step 4.
Only the testing entry now exports it for proof bindings.
The app backend, server seam, and protocol entry keep it private.
The final wire test changed only that binding import again.
Red: 08-testing-headers-red.log, exit 1.

The native middleware fixture used the removed backend header export.
It now imports the internal scaffold header tag as test protocol code.
The note-app fixture drops its old header tag and seam export.
Red: 08-middleware-red.log, exit 1.
The testing skill shows the filled testing import.

The notice example maps HTTP status to sent or NotificationFailed.
The graceful-close limit now sits under Limits in the README.
Stop tag labels are lifetime.backendStop and lifetime.requestStop.
Their comment covers HTTP, telemetry bodies, and sync.
Red: 08-leftovers-red.log, exit 1, with all three missed facts named.

Green: 08-leftovers-green.log, exit 0.
Build, types, all 65 app tests, middleware, note fixture, and prose pass.
The middleware proof also compares a real resumed SSE changes frame.
It covers denied cursors and idle close through the built Start server.
The changed-file code check has zero warnings.

### Step 8: public route test entry

Strict style found private route imports in the wire and ingest tests.
Red: .protocol-reply-logs/10-style-red.log, exit 1, rule T04.
The routes entry exports the two real Start routes for protocol tests.
Their implementation and wire facts stay the same.
Tests now import only public package entries.
The registry will copy this entry and both new test files.

Green: 10-public-wire-green.log and 10-style-green.log, exit 0.
All eleven wire and ingest tests, app types, build, and code checks pass.
The style census checks changed source and test files.
The preset fixture is test-only wiring, not app source.
Its existing preset calls are outside the source-only style rules.
TSDoc will check that file with the other changed TypeScript files.

### Step 9: registry and final writer proof

The old registry failed the exact-source check, exit 1.
Red: .protocol-reply-logs/09-registry-red.log.
The rebuilt registry copies all 119 files from final source.
It includes the three new protocol files and the public route test entry.
Both new test files ship with the starter.
The fresh starter uses packed Core and React, with its own npm install.
All fifteen copied-starter gates pass, exit 0.
Green: .protocol-reply-logs/11-registry-green.log.
Assume the lead owns release metadata; keep version 0.6.0 and contract 4.

All 149 plain proof cases pass, exit 0.
The 144 banned cases each return 1 for their named rule.
The five allowed cases each return 0.
The same seventeen plain functions remain.
Each case log is copied into this worktree for review.
Proof: .protocol-reply-logs/11-plain-prove.log.

The final gate chain exits 0:

```bash
vp run -r build && vp check \
  && vp run @tinker-start-scaffold#test \
  && vp run -r test
```

All 65 app tests pass.
All 1,249 Vitest tests and 147 Node tests pass.
One existing Vitest skip remains.
Check has zero errors and 28 warnings.
All six files with warnings match 2d307cf5 byte for byte.
All sixteen validate lanes pass, exit 0.
allowBuilds already permits esbuild; the workspace file stayed unchanged.
No async assertion or expect.poll was left unawaited.

Seam, note fixture, browser boundary, imports, schema, middleware, and types pass.
Strict style census and TSDoc pass, exit 0.
The raw header tag is absent from every runtime package entry.
Only test wiring exports that binding.
Only the named auth mount takes a Request or returns a Response.
No Core or React source changed.
No new Core gap was found.
The direct graceful-close limit stays recorded above and under README Limits.

The first wire proof passed before any source refactor.
The first commit's app source still matches 2d307cf5.
An isolated replay of that commit also passes, exit 0.
Final wire proof passes, exit 0, with the same fourteen case facts.
Each case checks status, all headers, and the body frame.
Native middleware also compares a real resumed changes frame.
Before replay: .protocol-reply-logs/12b-wire-before-green.log.
After: .protocol-reply-logs/13-wire-after-green.log.
The initial before log is 01e-baseline.log.

Jev has no file flags, test flags, or README gaps.
Two low-confidence README matches stay notes.
Four unit flags have false answers, with exact rows saved in this track.
Auth settings come from a tag; its feature policies are fixed code.
The mounted third-party auth API uses graph-owned database and mail.
Stream state is private protocol and IO state.
The stop listener sets ended; a late body closes at start.
Existing tests cover opening stop and held stream stop.

The folder limit keeps the shared Jev bank unchanged.
A local copy of label.mjs changes only the bank output path.
It uses the shipped unit readers, row shape, and hash rule.
The lead merges the rows and runs landing calibration.
[PROTOCOL-REPLY-JEV-LABELS.jsonl](PROTOCOL-REPLY-JEV-LABELS.jsonl) holds all four rows.

[PROTOCOL-REPLY-GATES.json](PROTOCOL-REPLY-GATES.json) records each command, exit, and log.
It includes all red/green pairs, plain cases, copied gates, and wire facts.
The final chain log is .protocol-reply-logs/12-gate-chain.log.
The validate log is .protocol-reply-logs/11-validate.log.
The structure log is .protocol-reply-logs/11b-structure.log.

Only the allowed app, track docs, and ADR 0103 are changed.
No stash, push, trial-store access, or container command was used.
Every long job ended before this proof was saved.
No full mutation lane or timing claim was requested.
The final commit saves the registry and proof for lead review.

## Protocol reply review fixes

Owner: Sol writer, card start/protocol-reply.
Review base: e10b8371, after the lead's rebase.
Next: close each named guard hole, then simplify the routes.
Verify: each fix red then green, all planted cases, wire pin, all gates.
Keep test-only header bindings; ban their use from app source.
Assume the lead owns the board and landing.
The allowed folder rule keeps TODO.md unchanged.

Review fix 1: the wire guard reads every run body and nested callback.
It also checks typed reply values, arrays, and plain records.
Request aliases work through destructuring, schemas, and type aliases.
Operation options must be a direct object literal with no spreads.
All nine new cases failed the old proof by the required rule, exit 1.
Each red log is named review-01-<case>-red.log.
The new guard rejects all nine, child exit 1; proof exit 0.
Green: .protocol-reply-logs/review-01c-green.log.
Lint required smaller type readers; no rule was disabled.

Review fix 2: app source cannot use the raw header tag.
The rule follows symbols through public and direct imports.
Only src/scaffold/ and src/backend/auth.ts are allowed.
Proof copies package exports and test wiring to resolve public imports.
Both new banned cases fail the old proof, exit 1.
Red: review-02-request-headers-testing-red.log.
Red: review-02-request-headers-direct-red.log.
The new proof rejects both and allows scaffold use, exit 0.
Green: .protocol-reply-logs/review-02-green.log.
Test wiring still binds the real header tag.

Review fix 3: POST reads and parses its body directly.
Both no-op promise callbacks are gone.
The source audit fails before the fix, exit 1.
Red: .protocol-reply-logs/review-03-red.log.
The direct-body audit, plain check, types, and eleven tests pass, exit 0.
Green: .protocol-reply-logs/review-03b-green.log.
The two wire pins keep all fourteen reply facts.
A short list keeps header rejection order under the lint limit.
The body reader owns cancellation, so its cancelled read ends the loop.
The non-null body assertion follows the explicit no-body rejection.
No lint limit or plain rule was weakened.

Review fix 4: only the auth route and tests can use the mounted auth handler.
The transport entry no longer exports it.
App and other scaffold imports fail the plain guard.
The shared guard also follows bracket access through public export aliases.
Five added banned import cases have red exit 1 and green child exit 1.
The proof is green, exit 0, in review-04d-green.log.
The public export test fails before the change, exit 1.
Red: .protocol-reply-logs/review-04b-routes-red.log.
The cursor has a Stream.Cursor type; its source audit is green.
Red: .protocol-reply-logs/review-04-cursor-red.log.
Only JSON syntax and Zod parse errors become bad cursor replies.
The route passes a validated cursor with input, not rawInput.
The DataValidationFailed branch had no input check to handle here.
A downstream validation failure must pass through, rather than become 400.
The final two tests fail against the old sync route, with two 400 replies.
Red: .protocol-reply-logs/review-04-final-regression-red.log.
The exact final tests pass on the new route.
All five wire tests, types, prose, and new import proofs pass, exit 0.
Green: .protocol-reply-logs/review-04d-green.log.
The downstream proof uses a real graph-owned preset with real dependencies.
It needs an async factory and explicit proof tags.
No mocks, global changes, or private test imports were added.

## Protocol reply review gate before the proof correction

The four review fixes are committed, one commit per point.
The registry is rebuilt from those fixes.
Its old payload fails the exact-source check, exit 1.
Red: .protocol-reply-logs/review-05-registry-red.log.
The fresh copied starter passes all fifteen gates, exit 0.
Green: .protocol-reply-logs/review-05-registry-green.log.
Its 119 files match source, with the lib alias rewritten.
Core and React use packed tarballs, with no workspace links.

All 166 planted cases pass, proof exit 0.
The 160 banned cases each exit 1 for the named rule.
The six allowed cases each exit 0.
The same seventeen plain functions remain.
Proof: .protocol-reply-logs/review-06-plain-prove.log.
Every child log is copied into this worktree.

Build, check, app tests, and all tests each exit 0.
The chain also exits 0.
Proof: .protocol-reply-logs/review-06-gate-chain.log.
All 68 app tests and 1,252 Vitest tests pass.
All 147 Node tests pass; one existing Vitest skip remains.
Check has zero errors and the same 28 warnings.
All six warning files match review base e10b8371.
Proof: .protocol-reply-logs/review-06-warning-proof.log.
All sixteen validate lanes pass, exit 0.
Proof: .protocol-reply-logs/review-06-validate.log.
The workspace file already permits esbuild and stayed unchanged.

Seam, note fixture, browser boundary, imports, schema, middleware, and types exit 0.
Proof: .protocol-reply-logs/review-06-structure.log.
Strict census and TSDoc exit 0.
Census notes one body assertion after the explicit no-body rejection.
The test-only preset file is checked as test wiring, as in the first proof.
Jev has zero file flags, zero test flags, and zero README gaps.
Two unsure README matches remain notes.
The same four unit flags have false labels in the saved track file.
The label tool confirms each row already exists.
Proof: .protocol-reply-logs/review-06-style-jev.log.
Labels: .protocol-reply-logs/review-06-jev-labels.log.
The lead merges those rows and runs calibration at landing.

Both wire pins pass on rebased first commit 673e2965.
That replay uses the old app source from the same commit.
Before: .protocol-reply-logs/review-06-rebased-wire-before.log.
The final five wire tests pass, exit 0.
After: .protocol-reply-logs/review-06-wire.log.
All fourteen status, header, and body facts are unchanged.
The final two sync error tests also fail against the old route.
Those failures are two wrong 400 replies, not missing setup.

ADR 0103 governs the reply rule in this card.
The glossary's old request-tag row still allows whole requests in operations.
That row is outside this brief's allowed files.
Record it for the lead's docs/http-0102-0103 card.
No new term or Core gap was found.

[PROTOCOL-REPLY-GATES.json](PROTOCOL-REPLY-GATES.json) holds all current exits and log paths.
It also keeps the first proof and every review red/green pair.
Only the allowed app, track docs, and ADR 0103 changed.
No stash, push, trial-store access, or container command was used.
All jobs ended before this proof was saved.
The card is ready for the lead's next review.

## Protocol reply proof correction

The first option plants failed an old plain-function rule.
They proved the named option rule was missing, but not a passing escape.
Replace their local arrow with the built-in String function.
Both option shapes now pass the exact e10b8371 guard, child exit 0.
A custom input reader with type R = Request also passes that guard.
That reader proves the alias hole without the old module-effect flag.
The required direct z.custom alias case stays in the proof too.
All three old proof checks fail, exit 1.
Red: .protocol-reply-logs/review-08-red.log.
Each old child log is saved with exit 0.
The current guard rejects all three by the named rule.
Green: .protocol-reply-logs/review-08-green.log, exit 0.
No guard behavior or app source changed in this correction.
Next: rebuild the registry and repeat every gate with the final 167 cases.

## Protocol reply final review proof

All gates were repeated after the proof correction, exit 0.
The registry again matches all 119 source files.
Its copied starter again passes all fifteen gates.
Red: .protocol-reply-logs/review-09-registry-red.log.
Green: .protocol-reply-logs/review-09-registry-green.log.

The final plain proof passes all 167 cases, exit 0.
The 161 banned cases each exit 1 for their named rule.
The six allowed cases each exit 0.
Proof: .protocol-reply-logs/review-09-plain-prove.log.
The option and custom-reader cases pass the old guard, child exit 0.
Their final red and green logs replace the weak option proof.

The final build, check, app, and all-test chain exits 0.
Proof: .protocol-reply-logs/review-09-gate-chain.log.
The final structure, style, TSDoc, and Jev gates each exit 0.
The same four Jev flags retain their saved false labels.
The final sixteen validate lanes pass, exit 0.
Proof: .protocol-reply-logs/review-09-validate.log.
The final wire tests pass, exit 0.
After: .protocol-reply-logs/review-09-wire.log.
The before replay remains green on rebased pin 673e2965.
All fourteen wire facts are unchanged.

The gate record holds every final command, exit, and copied log path.
It keeps the earlier proof as history.
The app has 68 passing tests.
The repo has 1,252 passing Vitest tests and 147 passing Node tests.
One existing Vitest skip remains.
The same 28 check warnings remain, in six unchanged files.
No runtime source changed after the four review fixes.
All jobs have ended.
The final registry and proof are ready for lead review.

## Protocol reply short fix round

Owner: Codex, card start/protocol-reply.
Base: c4583608.
State: Review.
Next: lead review.
Verify: each fix red then green, each new plain case planted.
Then rebuild the registry and repeat every gate by exit code.
The lead owns TODO.md and landing.

Short fix 1: constant string keys use the shared symbol lookup.
The HTTP backend rule uses it too.
Both final plants pass the old guard, child exit 0.
Their old proof checks fail, exit 1.
Red: short-01-headers-red.log and short-01-backend-red-final.log.
Green: short-01-green-final.log, exit 0.
The first backend plant returned a reply and hit the old reply rule.
Its final plant returns 1, so it proves the passing hole.

Short fix 2: global Response stays in routes and scaffold files.
Both hidden resource replies pass the old guard, child exit 0.
Reflect construction and type references also pass it, child exit 0.
Their old proof checks fail, exit 1.
Red: short-02-resource-red.log and short-02-method-red.log.
Red: short-02-reflect-red.log and short-02-type-red.log.
Green: short-02-green-verified.log, exit 0.
The route, scaffold, and local type cases pass, child exit 0.
The server entry's Response check now lives on its body resource.
The same instance check still picks the same reply path.
Build, types, and nine body and wire tests pass, exit 0.
Proof: short-02-build-check.log.

Short fix 3: the run walk checks casts to Request.
The unknown-input cast passes the old guard, child exit 0.
Red: short-03-cast-red.log, exit 1.
Green: short-03-cast-green.log, exit 0.
The body stream now has a direct null check after the header checks.
The failed result is read through its status and error.
Both source checks fail before the edits and pass after them.
Red: short-03-body-red.log and short-03-result-red.log.
Green: short-03-body-green.log and short-03-result-green.log.
The direct route edit had ten branches; the limit is eight.
The final settlement callback maps its result to the route's reply.
It does real work and returns the owned promise.
Body reads stay direct; no lint limit or guard was weakened.
Build, types, plain check, and fourteen wire and telemetry tests pass.
Proof: short-03-verified.log, exit 0.

## Short fix round gates

All requested commands finished with exit 0.
Build, check, plain, seam, app tests, registry, all tests, prose, and validate pass.
The registry build also exits 0.
The full proof passes all 177 planted cases.
The 168 banned cases each exit 1 for the named rule.
The nine allowed cases each exit 0.
The same seventeen plain functions remain.
Proof: .protocol-reply-logs/short-04-plain-prove.log.
Every child log is copied into this worktree.

The copied starter passes all fifteen gates, exit 0.
All 119 files match source.
Proof: .protocol-reply-logs/short-04-registry.log.
The app passes 68 tests.
The repo passes 1,252 Vitest tests and 147 Node tests.
One existing Vitest skip remains.
The same 28 warnings remain in eleven files.
Every warning file matches c4583608.
Proof: .protocol-reply-logs/short-04-warning-proof.log.
All sixteen validate lanes pass, exit 0.
Proof: .protocol-reply-logs/short-04-validate.log.
All fourteen wire facts remain unchanged.
Proof: .protocol-reply-logs/short-03-verified.log.

Strict style and TSDoc pass, exit 0.
Jev has zero file flags and three unit flags on the body resource.
Each has a false label with its reason in the saved track file.
The lead merges the labels and runs calibration at landing.
No new Core gap was found.

The gate record keeps every command, exit, and copied log path.
It also keeps the old proof and each failed attempt.
The first full check saw the proof helper's format.
Proof helpers now live in the ignored logs folder.
The full gate list then passed.
No app source changed during the gate run.
No stash, push, trial-store access, or container command was used.
The registry and proof wait in Review for the lead.

## HTTP docs: writer start

Card: docs/http-0102-0103.
Owner: Codex writer.
Branch: docs/http-0102-0103; base: 6e254446.
Next: lead review; all requested proof is saved.
Verify: prose, Jev tests, exact fix snippet types, and vp check.
State: Review.

Assume the lead owns TODO.md, review, and landing.
The folder limit keeps TODO.md unchanged.
ADR 0102 changes are factual corrections required by this brief.
ADR 0103 already matches the read routes and named auth exception.
Keep its decision text unchanged.
Keep historical frame words but mark the old HTTP model as retired.
No app source, trial source, or shared trial store is touched.
No push, stash, full mutation lane, or speed claim is requested.

Read both briefs, writing rules, both decisions, and the real HTTP code.
Also read the stop tags, server entry, middleware, routes, exports,
error registries, HTTP tests, telemetry sender, and plain guard.
The initial build exits 0: .http-docs-logs/01-build.log.
The base check exits 0 with 28 warnings: .http-docs-logs/02-baseline-check.log.

### Step 1: match the HTTP docs to code

ADR 0102 now names both request spans and the session-target resource.
The backend tag has its real file, signature, and label.
The decision lists the actual client ban and sync transport exception.
The glossary drops live claims for retired HTTP helpers.
The whole-request tag is marked retired.
Feature operations receive params; routes own wire input and replies.
The README and skills explain rawInput and reply mapping.
Direct graceful close remains a limit, separate from tested stop behavior.

Step 1 build and prose each exit 0.
Logs: .http-docs-logs/03-step1-build.log and 03-step1-prose.log.
The touched current docs have no wide table rows or fenced lines.

### Step 2: make the shown S24 fix compile

S24 now shows a complete operation, with the server-seam import.
It passes request values with rawInput and maps the status to sent or error.
The new test copies the scaffold source, package, and TypeScript config.
It links the installed dependencies and compiles the exact emitted fix text.
The copy lives in this worktree and is removed after the check.
No app source changes and no private trial store reads are needed.

The old text fails this test, exit 1: 05-snippet-red.log.
Its loose run body has no typed request dependency.
The corrected text passes, exit 0: 06-snippet-green.log.
An input-only control fails, exit 1: 07-input-control-red.log.
That failure names the missing HttpRequest brand, not missing setup.
The control restores the shown rawInput text before continuing.
All 148 Jev tests pass, exit 0: 06-jev-tests.log.
The first code check fails on README formatting: 06-step2-check.log.
Explicit blocks keep the fix example narrow after the formatter runs.
This also repairs the line the first commit hook joined.
The six touched current docs have no wide rows or fenced lines: 07-width.log.
Prose passes, exit 0: 07-prose.log.
All logs in this section live in .http-docs-logs/.

Step 2 final build, code check, and Jev tests each exit 0.
Logs: 09-step2-build.log, 09-step2-check.log, and 09-jev-tests.log.
The test registration is awaited; the new promise warning is gone.
The check keeps the base's 28 warnings.
No plain guard behavior or judge rule changed.
The old package path in plain tests is now a generic example package.

### Step 3: final writer proof

Docs step: 6502858b.
S24 fix and copied-scaffold test: 18670bfb.

The final gate chain exits 0.
Build, check, Jev tests, the exact snippet, all tests, prose,
validate, preflight, and doc width each exit 0.
[HTTP-DOCS-GATES.json](HTTP-DOCS-GATES.json) records commands, exits, and log paths.
Final logs use the 11- prefix in .http-docs-logs/.
Both expected failing controls keep their exit 1 logs in that record.
The first gate record needed formatting; its failed log stays saved too.

All 148 Jev tests pass.
All 1,252 Vitest tests pass; one existing skip remains.
All sixteen validate lanes pass.
The check has zero errors and the base's 28 warnings.
All eleven warning files match 6e254446 byte for byte.
Proof: .http-docs-logs/12-scope-audit.log, exit 0.
App source, both trial folders, and the workspace config match base.
No temporary copied scaffold remains.
The six touched current docs have no wide rows or fenced lines.

Assume the given base is the review base, even if main advances.
Preflight uses 6e254446..HEAD and has zero flags.
Its source lane reads TypeScript; no TypeScript source file changed.
No TypeScript package tests changed, so package test and promise judges do not apply.
No Jev labels or judge rules were added.
No public symbol changed, so no cross-package impact block is needed.

Core feedback: no new gap.
The direct graceful-close limit and its earlier failing shape stay above.
Stop tags are the shipped way to end that wait.
No runtime fix, mutation lane, or timing claim was part of this card.
The lead owns review, board changes, and landing.

Proof save repeats build, check, and prose; all three exit 0.
Logs: 12-proof-build.log, 12-proof-check.log, and 12-proof-prose.log.
The check still has the same 28 warnings.
The gate record includes these final proof checks too.

## HTTP docs: lead review fixes

Card: docs/http-0102-0103.
Owner: Codex writer.
Review base: 41b9cf96.
State: Doing.
Next: four small fixes, one commit each, then the requested gates.
Verify: prose, Jev tests, snippet types, and app tests by exit code.
The lead allows one app-code line: the HTTP span test title.
All other app code and both trial folders stay unchanged.
The lead owns the board and landing; no questions are needed.

Fix 1: the ban list now includes both protocol checks.
Any app use of global Response stays in routes or scaffold files.
Operations cannot take Request input or return Response.
Only the exact named auth mount is excepted.
Both decisions and the README now describe these checks.
The guard was read before the edits; its code stays unchanged.
