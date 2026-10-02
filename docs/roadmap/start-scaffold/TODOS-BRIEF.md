# Todo feature writer brief

Read [the fixed brief](../contributor-brief.md),
[the proof brief](POC-BRIEF.md), and `coding-convention`.
Load the installed Start server function and router guides.

## Target

Work in `/tmp/tinkered-start-poc` on the existing `start/poc` branch.
The lead owns the board, track, drawing, and source preview.
Change only `apps/start-scaffold`; no new dependency is needed.
Do not change Core, React, other apps, shared judge labels, or the lockfile.
Do not push or land main.

The user asks for the smallest real feature code after scaffolding.
Each account has a private todo list; the user chose this rule.
Create a todo, set its done state, delete it, and load it again.
Use the real auth, database, and transaction resources already in the app.
Native Start calls must reuse `startRequests.middleware`.
Keep Start middleware declarations in their own existing module.
No new feature facade, scope helper, HTTP dispatcher, or custom compiler.

## Files the user edits

Aim for these six files; change the names if a shorter real shape helps:

- `src/backend/todos.schema.ts`: the todo table.
- `src/contracts/todos.ts`: public row and input shapes.
- `src/backend/todos.ts`: list and write operations.
- `src/transport/todos.functions.ts`: native Start endpoints.
- `src/frontend/Todos.tsx`: data, browser actions, and view.
- `src/routes/todos.tsx`: loader and page.

The two endpoint declarations may be GET list and POST change.
A strict command input can name add, setDone, and delete.
A public change operation first authorizes, then runs a private write operation.
This keeps permission before transaction setup without a helper facade.
Keep the SQL plain and each write filtered by the server's owner ID.
Use separate named mutations instead if they make the final code clearer.
Do not hide feature-specific Start wiring as fixed scaffold code.
It belongs in the userland code preview.

## Rules

The server derives the owner from the auth session.
Caller input never chooses an owner.
Every read, update, and delete uses that owner in SQL.
An unknown or foreign todo gets the same managed error.
Add that error to `src/errors.ts` if needed.
Use a numeric generated ID if that avoids extra client code.
A title is trimmed and must have 1 to 200 characters.
Setting done uses an absolute boolean, not a read then flip.
Await commit before returning success.
Authorize before opening a write transaction.

No scope or context is passed into feature operations or views.
Only the native Start endpoint sees middleware context.
Use Core data and operations for mutable browser state and actions.
Use existing shadcn Button and Input; a native checkbox is fine.
Render route loader data in the first server HTML.
After each write, show the authoritative saved result or rerun the loader.
Reload must show the same data.

Keep auth UI and profile editing working.
Provide a link to `/todos` from the signed-in page.
Direct `/todos` for a signed-out account can redirect to `/`.
Do not add redirect-throwing endpoints unless callers handle native router control flow.
Signing out and into another account in the same tab must show no old rows.
Avoid duplicating route cache data into an app-wide cell without clear ownership.
Use route-owned initial values and refresh where practical.
If a fixed scaffold file needs a small hookup, report it plainly.

Wire the table into the existing migration schema and generate its migration.
Export only the public feature operations from the backend entry.
Those operations must remain callable without importing Start.

## Proof

Use a few public-operation tests through a Core root.
Use real Better Auth and Drizzle in proof mode.
Prove two real accounts stay apart, including guessed update and delete IDs.
Prove signed-out writes fail before a write transaction opens.
Reuse existing transaction proofs; do not repeat unrelated cleanup tests.
No mocks or global patches.

Run app build, check, tests, import guard, and native middleware proof.
Run prose, strict census, TSDoc, and advisory Jev for changed app files.
No full release or mutation lanes: this remains a proof app.
Commit explicit app paths after checks.
Keep the existing live preview running for the lead's browser review.
Report the full feature files, fixed-file hookups, gate exits, and Core feedback.
