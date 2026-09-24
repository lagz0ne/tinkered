# Worker rules

These rules are part of acceptance.
The task behavior still applies.
Keep the supplied scripts and checks unchanged.
Only use core and React from Tinker.
Do not seek examples, other apps, other writers, or teacher checks.
No worked code is supplied.

## State and views

- Keep all app state in core cells.
  This includes form text, the current edited text, filters,
  selections, notices, saved records, ids, and undo history.
- Do not keep another copy of a draft in React or the DOM.
  Typing updates the cell that owns that draft.
- React reads cells with useData and runs operations with useRun.
  Use the public hook types supplied with the packages.
  A message read from useRun.error is allowed.
  Do not copy it into separate React state.
- Do not use useState, useReducer, useRef, useEffect,
  or useLayoutEffect for this app.
  Do not hide the same pattern behind a custom hook.
- Do not get a scope with useScope in a view.
  Do not pass a scope, session, or controller through view props.
- The root view owns a fresh scope through ScopeProvider create.
  useId is allowed for unique input labels across mounted roots.
- A view renders values and formats them for display.
  It does not decide rules, manage drafts, or catch every error.
- Typing, choosing a filter, opening, saving, and discarding are actions.
  Operations own their state changes.
  Keep reads and writes inside the scope that owns them.
- Keep pure helpers for repeated work over plain values.
  Do not put the whole operation in an outside closure.
- A resource owns any work that needs cleanup.
  Use defer and the abort signal where needed.
  This local app should not need a transport or polling loop.

## Errors and input

- One errors.ts names the error kinds and payloads.
  All app failures come from it.
- Narrow unknown errors with isError.
  Rethrow a value that is not one of the expected managed errors.
  Do not turn a coding error into an Error or Unknown notice.
- Validate user input at the boundary, then work with typed values.
  Keep business rules in operations.
  Do not validate the same fact again at every layer.
- Parsing may run in the operation body when needed to preserve
  the task's error kinds.
  Do not mask invalid input with defaults.
- A public operation can be called by untyped code: tests, plain JS,
  or a transport. There, `ctx.input` is only a claim: core passes
  `{ input }` through unchecked. Give the operation an `input`
  parser, or read `ctx.rawInput` and check every field you use.
- Error payload types are exact. A value that does not fit the type,
  such as a non-text id for `{ id: string }`, stops the operation
  with the task's error and a value of the right type. Never widen a
  payload type, add an `unknown` parameter, or cast to carry it.
- Preserve creation order when sort keys tie,
  including after edits and undo.
- Opening another draft drops the first draft's unsaved text.
  The fields must now show the newly selected record.

## Code and tests

- Keep strict TypeScript. No any or casts that hide type errors.
  Literal as const is allowed.
- Use type for plain records; keep errors in their one registry.
  Keep the public names the task requires.
- No console calls in app source or bare throw new Error.
- Use TSDoc for useful public explanations.
  No suppression comments or narrative comments inside source.
- Test public behavior through src/index.ts or the real screen.
  Do not import private source modules in tests.
- No mocks, spies, global patches, test skips, or fixed sleeps.
  Browser tools can wait for the state they need.
- Use isError to narrow by control flow, then check the payload.
  Do not put isError inside expect.
- One test should prove one public cause and its result.
  Do not test helpers, types, private state, or allocation details.
- Prefer a few small helpers for real repeated setup.
  Do not hide a test's actions and checks inside a large helper.
- Run type check, all behavior tests, real browser tests, and build.
  Do not count a missing test or failed command as a pass.
- Ask Jev about every changed file.
  A finding under `gate.blocking` must be fixed before you report done.
  It is a plain rule break, or a question the teacher proved reliable.
  Clear it the way its `fix` line says, and keep every TASK.md rule.
  If the fix and the task seem to conflict, report it; do not choose.
  Other findings are advice. Fix real issues.
  Explain each false hit in one line.
  Do not rename a good test just to lower a probability.
  A `gate.status` of `unavailable` is not a pass; report it.
- Save small steps to disk. Report exact commands and results.
  Explain any remaining issue, then stop for teacher review.
