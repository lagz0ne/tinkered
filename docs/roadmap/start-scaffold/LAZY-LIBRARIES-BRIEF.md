# Load service libraries at use

Read [the fixed brief](../contributor-brief.md),
[the proof brief](POC-BRIEF.md), and `coding-convention`.
Load the installed Start React entry guide for any router change.

## Target

Use `/tmp/tinkered-start-poc` on the existing `start/poc` branch.
The lead owns the board, track, drawing, and source preview.
Change only `apps/start-scaffold`; no dependency change is needed.
Do not change Core, React, other apps, shared judge labels, or the lockfile.
Do not push or land main.

The user asks to avoid loading libraries and their import effects up front.
Load service libraries inside the resource factory or operation that uses them.
Keep type imports at module level.
Use normal dynamic imports and their inferred types.
No import helper, cache, scope helper, proxy, or new package.
JavaScript already shares a module after its first import.

## Work

- Database: load PGlite or pg only in the selected pool branch.
  Load each Drizzle driver and migrator only in its selected branch.
  Retain cleanup in the owning resource.
- Backend auth: load Better Auth, its adapter, and schema in the auth factory.
- Mail: load Nodemailer only in the SMTP factory branch.
  Record mode must load no SMTP library.
- Queries: load Drizzle operators and tables inside the profile and todo actions.
  A backend public entry must not load these through a static schema import.
- Frontend auth: load the Better Auth client in its resource factory.
- Logs: load Pino in its resource factory on server and browser.
  Keep logger types as type imports.
  Await the observer at the existing entries before binding it to app work.
- Entry: load the Better Auth cookie plugin when the backend starts.

Keep Core, React, Start declarations, and validation readers as declarations.
Schema modules may import table builders when the schema itself is requested.
Do not turn ordinary view rendering into lazy component loading.
No need to change schemas, input readers, auth rules, or todo flow states.

Preserve the public database and action types by inference.
An async router entry must use Start's supported entry type.
Check the installed guide and source, not a guessed API.
Keep initial server HTML, browser hydration, and Pino browser output working.
Entry and middleware keep their current scope and signal ownership.
Do not weaken the backend browser import guard.

## Proof

One focused cold-import check must fail before and pass after this change.
Use a real fresh process and Node module loading records.
Do not mock imports or patch library exports.
Prove importing the public backend entry loads none of pg, PGlite,
Drizzle, Better Auth, or Nodemailer before a unit is resolved or run.
Keep existing public-operation tests; no added tests for import syntax.

Run app build, check, operation tests, native middleware, and import guard.
Run strict census on authored files and TSDoc on changed files.
Run advisory Jev; leave shared labels unchanged for this proof app.
Do not run release or mutation lanes.
Commit explicit app paths after checks.
Keep the running preview alive for the lead's browser check.
Report changed files, gate exits, cold-import proof, and Core feedback.
