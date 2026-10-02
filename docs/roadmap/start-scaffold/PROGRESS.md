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
