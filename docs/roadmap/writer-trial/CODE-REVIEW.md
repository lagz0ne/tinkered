# Code review: four writers and the issue tracker

Trial 01's four apps, read against the issue tracker's core and React pattern.
Bottom line: none of the four meets it yet.
Four added checks per app found seven failed cases.
The saved apps were not changed.

All four keep form text, filters, and notices in React state.
The teacher's earlier checks passed chosen behavior cases;
they did not prove the code followed the requested state rules.
DeepSeek remains fastest; speed did not make it the quality winner.

## Bugs to fix first

### 1. GLM shows the wrong draft after changing bookings

Open Alpha, type UNSAVED Alpha, then open Beta.
The editor still shows UNSAVED Alpha, not Beta.
React keeps the values while the draft id changes.
Saving now submits those old values for Beta.
The task says opening a second id drops the first unsaved draft.

- [worker 3: app.tsx:99](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-3/src/app.tsx:99) seeds local state once.
- [worker 3: app.tsx:310](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-3/src/app.tsx:310) reuses the same editor without a key.
- The browser check fails on the visible title.
  The other three writers pass the same check.

### 2. Three writers lose creation order after editing

Create Older in Cedar at 10:00, then Newer in Maple at 09:00.
Edit Older to 09:00.
The promised tie order is Older, Newer.
MiMo Flash, GLM, and DeepSeek return Newer, Older.
MiMo Pro returns the right order.

- [worker 1: model.ts:358](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-1/src/model.ts:358) builds the order map but never saves it.
  `deps.order.set(order)` is missing from booking and series booking.
  Saving an edit later reads an empty map; the tie value becomes NaN.
  The same missing write is present in saved rounds 2 and 3.
- [worker 3: bookings.ts:195](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-3/src/bookings.ts:195) only sorts by date and start.
  A stable sort keeps the current list order, not creation order.
- [worker 4: index.ts:220](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-4/src/index.ts:220) makes the same assumption.
- [worker 2: model.ts:263](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-2/src/model.ts:263) uses saved issued ids to break ties.

### 3. MiMo Pro turns an invalid date into a real booking

Clear Date, fill a valid title, room, and time, then click Book.
It saves on 2026-10-01 instead of showing BadDate.
The task defaults an omitted date; it rejects an invalid date.
A cleared form field is an explicit empty value.
The other three writers reject it in the same browser check.

- [worker 2: BookingApp.tsx:51](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-2/src/BookingApp.tsx:51) turns empty text into undefined.
- [worker 2: BookingApp.tsx:167](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-2/src/BookingApp.tsx:167) sends that value into the operation.
- This is a rule choice in the view that differs from the core API.

### 4. GLM and DeepSeek reject some real four-digit dates

Both reject 0099-10-01 with BadDate.
The task gives no minimum year beyond a real YYYY-MM-DD date.
JavaScript Date.UTC treats years below 100 as 1900-based.
Their round-trip check then rejects the day.
Both MiMo apps pass this check using setUTCFullYear.
This is a lower-priority date edge case than the edit bugs above.

- [worker 3: bookings.ts:139](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-3/src/bookings.ts:139).
- [worker 4: index.ts:135](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-4/src/index.ts:135).

## Do they follow the requested pattern?

### All four: state is split between core and React

The saved worker rules say: use core cells for app state.
Each app has 13 useState calls: five edit fields and eight
form, filter, and notice values.
The core editDraft holds the opening copy, not each typed edit,
so a core-only test cannot see the draft text being edited.
GLM's draft bug shows this is more than a naming choice.

- MiMo Flash: [worker 1: BookingApp.tsx:73](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-1/src/BookingApp.tsx:73).
- MiMo Pro: [worker 2: BookingApp.tsx:71](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-2/src/BookingApp.tsx:71).
- GLM: [worker 3: app.tsx:99](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-3/src/app.tsx:99).
- DeepSeek: [worker 4: app.tsx:134](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-4/src/app.tsx:134).
- Tracker: [tracker: client/state.ts:34](/home/paseo/.paseo/worktrees/1ub87qpb/plastic-wasp/apps/issue-tracker/src/client/state.ts:34) owns form state in cells.
- Tracker: [tracker: client/App.tsx:44](/home/paseo/.paseo/worktrees/1ub87qpb/plastic-wasp/apps/issue-tracker/src/client/App.tsx:44) reads a cell and runs a typing operation.
- Tracker: [tracker: client/App.tsx:144](/home/paseo/.paseo/worktrees/1ub87qpb/plastic-wasp/apps/issue-tracker/src/client/App.tsx:144) reads the current edit cell directly.

Hook counts:

- The tracker has zero useState calls and 18 useRun calls.
- GLM uses useRun eight times but still keeps the local state.
- The other writers use scope.run and hand-written error handling.

Calling scope.run is a valid API use.
The mismatch is with the requested thin-view pattern,
not proof that scope.run is broken.

### Errors and tests also differ from the tracker

MiMo Flash rethrows errors outside its registry.
The other three turn unknown errors into an Error or Unknown notice.
That can hide a coding error as a normal form failure.

- [worker 1: BookingApp.tsx:34](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-1/src/BookingApp.tsx:34) rethrows on mismatch.
- [worker 2: BookingApp.tsx:61](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-2/src/BookingApp.tsx:61) falls back to Error.
- [worker 3: app.tsx:49](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-3/src/app.tsx:49) falls back to Unknown.
- [worker 4: app.tsx:50](/home/paseo/.local/share/tinker-writer-trial/trial-01/review/worker-4/src/app.tsx:50) accepts any string kind or returns Unknown.

The strict style check flags all five code sets
(four writers plus the tracker).
It is a review aid, not a count of bugs.

- No mock or spy pattern was found in any set.
- MiMo Flash has no isError-in-expect hits.
  It does have a polling sleep and a bare boot error.
- MiMo Pro has 47 isError-in-expect lines; GLM has 31.
- DeepSeek has 22, plus one cast through unknown in a test.
- The tracker has none of those patterns.
  Its two strict hits are an imported Hono ErrorHandler type
  and a test of a foreign error's message.
  Those need context, not a claim that its app is broken.
- Regex match-array reads were counted as tuple reads in the writers.
  Those are noisy style hits, not the ordering bugs above.

The writers never got the full repo coding convention.
Their short GUIDELINES.md and task packets were the contract.
So the extra test-style differences are gaps from today's tracker,
not hidden requirements they were expected to guess.

## What Jev found, and what it missed

All five sets used the same current question bank and thresholds.

- Source pass: 44 files, 368 extracted units.
- Test pass: 346 extracted test entries.

The tracker has server, transport, and tool code the trial did not need,
so its raw hit count is not a fair score against a small local app.

- MiMo Flash: zero unit-judge hits; three shape hints.
- MiMo Pro: two unit-judge hits; three shape hints.
- GLM: zero unit-judge hits; three shape hints.
- DeepSeek: one unit-judge hit; six shape hints.
- Tracker: 29 unit-judge hits; 27 shape hints.
- File judges: zero hits for each writer; two for the tracker.

The three writer unit hits are false positives on pure predicates:
MiMo Pro isName and isRoom, and DeepSeek toRoom.
They read fixed lists and hold no changing state.
No writer correctness bug listed above was detected by these judges.

The parser labels all top-level functions as function;
it never emits component, even for JSX components.
The React judges only apply to component.
This affects both worker calls and the standard lint command.
See [extract.mjs](/home/paseo/.paseo/worktrees/1ub87qpb/plastic-wasp/tools/jev/extract.mjs:63) and
[React judge filter](/home/paseo/.paseo/worktrees/1ub87qpb/plastic-wasp/tools/jev/bank.mjs:145).

Next, the 30 JSX components were marked as component by hand
and the existing React questions asked again, bank unchanged.
All returned below the hit threshold.
Those questions do not check useState; their source comment
says plain code should check that pattern.
The worker tool did not include that plain check.
See [React question scope](/home/paseo/.paseo/worktrees/1ub87qpb/plastic-wasp/tools/jev/bank.mjs:127).

The title judge flagged tests:

- MiMo Flash: 5.
- MiMo Pro: 18.
- GLM: 11.
- DeepSeek: 19.
- Tracker: 14.

These are review hints, not measured test quality.
For example, its blank-title warning on DeepSeek still points at
an actual rejection test; a flag does not erase that test's value.
The duplicate-assertion check also flags copy tests that need both
value equality and different identity to prove the stated contract.

The tracker is a reference for state ownership, not a perfect answer.
Its endpoint path literals are mostly fixed protocol paths,
not missed environment settings.
Transport cleanup and draft-stream warnings need their caller context.
The tracker is not declared free of lifetime bugs; its app was not rerun.
Those broader warnings stay in the raw evidence, outside the
core-and-React comparison and the writer ranking.

## What to do next

Keep all four original submissions unchanged as evidence.
Before another scored round, fix the teacher's blind spots:

- Add a plain check for local React app state.
- Teach extraction to identify JSX components.
- Add the edit-order and draft-switch cases to shared tests.
- Add the cleared-date case and make the form rule explicit.
- Show each writer its own failures and the state rule in plain words.
  Keep tracker source and other submissions hidden.

Then run one repair round on each saved repo.
Compare how much they fix, what they break, and how long it takes.
This is a proposed next step; no repair agents were launched.

## Final call

- MiMo Pro leads the narrow core checks added here.
- MiMo Flash is closer on unknown-error handling and test narrowing.
- GLM has the most serious visible draft bug.
- DeepSeek is still the speed pick, with known correctness gaps.
- None has earned acceptance against the full expected pattern.

## Proof and scope

- [Counts and source hashes](review-evidence/comparison.json).
- [Questions and calibration used](review-evidence/review-bank.json).
- [Extra file and React results](review-evidence/jev-supplement.json).
- [Probe source](review-evidence/probes.mjs).
- [Method and cleanup](review-evidence/method.json).

Per-writer probe results, Jev output, and strict style logs
sit beside those files in review-evidence/.
The real saved app copies stay teacher-only under:

```text
~/.local/share/tinker-writer-trial/trial-01/review/
```

The probes loaded the public app entry in the pinned worker image.
Browser probes used real Chromium.
Each ran with no network in a disposable container.
No submitted code ran on the host.
All probe containers were removed; no projects were recreated.

- Style census: FAIL; findings reviewed, app code unchanged.
- vp check exited 0 with 19 existing warnings.
- Prose lint passed.
- The seven new failing cases remain unfixed.
