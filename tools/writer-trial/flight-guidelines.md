# Flight trial rules

Grow the supplied Start scaffold one round at a time.
Follow `AGENTS.md`; read only the app skills for the work you change.
Keep the packed `@tinker/start` base unchanged.
Use the supplied Core and React packages.
Run `tinker prepare` after any install that skips scripts.
Keep feature work in tags, data, resources, and operations.

Settings come from `.env`.
Read `SERVICES.md` for supplier and payment HTTP contracts.
Use real HTTP clients; never load the flight fixture into the app.
Never call `/control/` from app code or tests.
Only the teacher sets the supplied services' faults, clocks, and seat stock.
Tests may run a local HTTP supplier for race, failure, and slow-reply cases.
It may use its own stock.
Call it through the app's exported operations; close it after each test.
The app runs on real time; a service's clock can move separately.

Each task adds to every earlier task; keep earlier pages and text working.
The teacher sees pages, HTTP routes, and service call logs, not private records.

## Checks within the shell limit

Run build before check and tests.
`npm run check` includes the full test run and can exceed 120 seconds.
Run `vp check` and `npm run typecheck` alone, then tests file by file.
Run all behavior and browser tests.
Also run `npm run check:plain`, `tinker doctor`,
and `npm run test:schema`.
If check:plain fails on PLAIN.md, `npm run check:plain -- --list` prints the full expected file.
Stop every server you start before you run the tests.
The sandbox has 2 GiB of memory.
A test may start its own server; its cleanup must stop it.
Each `work_shell` call allows at most 120 seconds, even with limits disabled.
If the full suite exceeds that, run each test file in a separate call:

```bash
npm run test -- tests/flights.test.ts
npm run test -- tests/flights.page.test.ts
```

List all test files first; run every file, including the shipped tests.
Never run chunks at once.
Check each call's exit code; a timeout or a missing file is not a pass.

## State and views

- Keep all app state in Core cells, including drafts, filters, selections,
  notices, records, IDs, and undo history; never copy drafts into React or DOM state.
- React reads cells with useData and runs operations with useRun.
  Use the supplied public hook types.
  A useRun.error message is allowed; do not copy it to separate state.
- No useState, useReducer, useRef, useEffect, or useLayoutEffect, even in custom hooks.
  No useScope in views, or scope, session, or controller props.
- Keep Start's scope setup; new views use that scope.
  Wrap controls in labels or use aria-label; useId repeats across mounted roots.
- Views render and format values; operations own rules and state changes.
  Keep reads and writes in their owning scope.
- Declare cells, operations, and resources once at module level, never in builders.
- Helpers take and return plain values, never controllers, scopes, or sessions.
  Read and write cells inside operation bodies; do not move a run body to a closure.
- Resources own cleanup, streams, and watchers; use defer and abort signals.
  For HTTP, depend on `httpRequest.controller` from `@/scaffold/backend/http`.
  Run it; never call built-in `fetch` in app code.

## Errors and input

- One errors.ts names all app error kinds and exact payload types.
  Narrow with isError; rethrow unexpected errors, never turn bugs into notices.
- Validate input once at the boundary; keep business rules in operations.
  Parsing may stay in run to preserve task errors; never mask bad input with defaults.
- Public calls can skip an input parser with `{ input }`.
  Read `ctx.rawInput` and check every used field for both call forms.
  An input parser's throw becomes DataValidationFailed, not the task's error.
- Bad payload values still need the task's error and a value of the right type.
  Never widen a payload, add an unknown parameter, or cast to carry it.
- Preserve creation order on sort ties, including edits and undo.
  Opening another draft drops the first draft's unsaved text.

## Code and tests

Follow tinker-forms for code owners and tinker-testing for small-scope tests.

- Strict TypeScript; no any or casts hiding errors; literal as const is allowed.
  Use type for records and keep required public names.
- No console calls or bare throw new Error in app source.
  Use TSDoc for useful public text; no suppression or story comments.
- Test public behavior through exported operations or real screens, not private files.
  No mocks, spies, global patches, skips, or fixed sleeps.
  Browser tools may wait for state.
- Narrow with isError before checking its payload, never inside expect.
  One test proves one public cause and result.
  Small helpers may share setup; keep actions and checks visible in each test.
- Ask Jev about every changed file.
  Fix every `gate.blocking` finding using its `fix` line, keeping every TASK.md rule.
  If those conflict, report it; do not choose.
  Fix real advice; explain each false hit in one line.
  Never rename a good test to lower a probability.
  `gate.status: unavailable` is not a pass.
- Save small steps; report exact commands, exit codes, and remaining issues.
  Then stop for teacher review.
