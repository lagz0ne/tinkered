# Start proof writer brief

Read [the fixed brief](../contributor-brief.md),
[the design](DESIGN.md), and `coding-convention` first.

## Workspace

Use `/tmp/tinkered-start-poc` on branch `start/poc`.
The lead creates that worktree from current main.
Work only on the new app `apps/start-scaffold` and dependency lockfile.
Do not edit the board, other apps, Core, React, or shared judge files.
Do not push or land main.
Commit only explicit paths when checks pass.

## Target

Build a small runnable TanStack Start proof, rather than a static code sample.
Use only `@tinker/core` and `@tinker/react` from Tinker.
Use native Start, Better Auth, Drizzle, Postgres, mail, and Pino libraries.
Use shadcn components with Tailwind for style.
Load the bundled Start skills through the app's `AGENTS.md`.
Pin Start to the version actually fetched from the registry.
Check the installed primary source and docs rather than assuming latest APIs.

The app lets a user sign up, sign in, read their profile, save their name,
and sign out.
Email check and reset callbacks run a declared mail operation.
Use one Start app with strict backend/frontend import rules.
A backend public entry must be usable by tests without Start imports.
No scope or context bag crosses an app helper or domain operation.

## Proof mode and real services

Make it run for the lead without external keys or Docker.
Use native PGlite in memory for explicit local proof mode if needed.
Use the same Drizzle Postgres schema as the configured Postgres path.
Do not import `@tinker/drizzle`, auth, mail, stack, or other Tinker packages.
Choose explicit demo settings at the dev entry; do not hide production defaults.
Production configuration uses a real Postgres URL and SMTP settings.
Use a recording mail sender or Pino delivery event in proof mode.
Label proof mode plainly in README and report which integrations were live.
Do not claim PGlite proves network Postgres behavior or mail inbox delivery.

## Scope and unit rules

Declare tags, cells, operations, resources, and extensions once at import.
Keep live values in resource factories or the entry-owned instance.
Reusable clients are resources with `defer` cleanup.
Auth request facts belong to session resources.
Actions are operations; mutable frontend values are data; fixed inputs are tags.
The entry and Start extension alone own root/scope handling.
Use native Core stop signals, await `ready` and `closed` as appropriate.
No helper returns a new scope.
Do not store a shared current scope.

Start request middleware owns one request session.
The middleware belongs to the `startRequests` Core extension.
The server entry supplies its installed binding to native Start context.
An absent binding raises `StartScopeMissing` before opening a session.
No app AsyncLocalStorage or current-session module store is allowed.
Only the Start boundary carries the scope and session.
Keep one shared middleware reference in its own source module.
Use that reference globally, on functions, and on route-level middleware.
Prove concurrent request isolation and direct SSR server function calls.
An action finishes cleanup and its database commit before returning success.
An auth refusal must not write a profile.
Do not acquire the write transaction before checking permission.
Close requests after body completion or cancellation when streaming.
If a host behavior cannot be proved, identify the gap instead of guessing.

Only the frontend entry binds its Core scope to ScopeProvider.
React views use hooks rather than `useScope` or scopes passed as props.
Avoid effect-created providers around content required in first HTML.
Both initial server output and browser hydration must remain sound.

## Observation

Enable Core's automatic resource and operation spans on both sides.
Use `ctx.log` and a Pino observer sink, including browser Pino.
The Pino client is a resource; fixed log settings are a tag.
Await native Node flush during its resource cleanup.
Keep telemetry state separate from observed application work.
Do not build wrappers to pretend Core exposes a live resolved graph.
The proof may show completed spans and metrics derived from them.
Name those limits plainly; native live inspection is remaining work.
Do not reveal cookies, passwords, mail tokens, or database URLs in the tool.

## Tests and review

Most checks use public app actions through small Core roots.
Use real Better Auth and Drizzle where practical, and public presets for seams.
No mocks or global patches.
Keep only tests of distinct public promises.
Run app build, app tests, and check after dependency package builds.
Run prose on new Markdown and the strict style census on the app.
Run TSDoc checks on new authored TypeScript.
Generated route files must be marked generated and kept out of manual style edits.

The fixed brief's full release and mutation gates are landing work,
not required for a proof branch that changes no library package.
Do not run unrelated mutation lanes or change judge labels.
Report source files worth reading, checks by exit code, and all remaining limits.
