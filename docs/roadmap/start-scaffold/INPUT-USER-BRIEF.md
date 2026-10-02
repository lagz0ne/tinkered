# Input and current-user writer brief

Read [the fixed brief](../contributor-brief.md)
and [the proof brief](POC-BRIEF.md).
Use `coding-convention` and the installed Start guides.

## Target

Work in `/tmp/tinkered-start-poc` on `start/poc`.
Start from `85a93399`.
Change only `apps/start-scaffold`; no new library or dependency.
The lead owns the board, track, drawing, and source preview.
Do not push, land main, or change shared judge labels.
No release or mutation lanes for this proof app.

The user found mixed input reads and identity modeled as an action.
Use Core's input reader for raw form values.
Keep native Start validation for raw network input.
Pass that validated value into Core as trusted `input`.
Do not remove operation input readers: scope-only callers still need them.

In the todo view, send `rawInput` to `save.runAsync`.
Remove its manual `readTodoChange(input)` call.
Handle Core's `DataValidationFailed` cause in the failure action.
Keep the clear `BadInput` message and a good retry after a blank title.
Use no error helper or extra layer.
Keep the existing scope, signal, middleware, and route ownership.

Add `currentUser` as a session resource in `backend/auth.ts`.
It depends on the existing nullable `principal` resource.
Its factory refuses null with `SignInRequired` and returns the user.
Keep `principal` for the signed-out account page.
Remove `authorize` from `profile.ts` and the backend export.
Export `currentUser` from the backend entry.
Todo reads, todo changes, and profile saves depend on `currentUser`.
They read `currentUser.id`; no identity operation call remains.
Keep the private write operation so auth resolves before transaction setup.

Current callers of `authorize`: `listTodos`, `changeTodo`, and `saveProfile`.
The backend barrel is its only export.
No other app or library uses it.
The existing nullable `principal` read by `readProfile` stays valid.

## Proof

Keep the real-account operation tests and auth-before-write checks.
Use a public-operation test only if needed for a new promise.
Do not test private helpers or mirror Core's parser tests.
The lead will check a blank title, Core's failed span, and a valid retry in a browser.

Run app build, check, tests, import guard, and native middleware proof.
Run strict census, TSDoc, prose, and advisory Jev for changed files.
Report all exit codes and any changed error behavior.
Commit explicit app paths only after checks pass.
Keep the live app preview running for browser review.
