# Flight trial progress

## trial/services-closing

Writer: Sol, branch `trial/services-closing`.
Only the flight services and this card's docs change.
The reference app stays pinned.

- The existing open-webhook-body test passed with the payment close hook.
- Removing that hook made the same test fail with exit 1.
  Proof: [red.log](services-closing/red.log).
- The HTTP client now joins caller cancellation with `ctx.closing`.
  Its public `close()` method and payment's empty close hook are gone.
- The listener stops accepting requests when its session begins closing.
  It ends incomplete bodies, then waits for complete replies at cleanup.
- The clock supplies its closing signal to delayed routes and webhook waits.
  Neither needs a process stop signal or a clock advance to end.
- Supplier has no close hook or separate delivery loop to remove.
  Its shared listener and delayed-route waits get the same fix.
- The shared HTTP start hook and both app start hooks still set up routes.
  The payment watcher still owns state subscriptions and removes them at cleanup.

All caller paths were read: both app starts, both process entries,
route delays, webhook timers, and the outgoing webhook body reader.
New tests use each app's HTTP entry to close incomplete bodies and delayed routes.
The queued-webhook test proves closing ends its virtual wait without sending.
The existing open-body test now releases the inbox in cleanup even after a failure.
The five added close checks fail against the original resources.
All six original graceful-close checks pass with the fix.
The review found that releasing `web` skipped the listener stop.
Cleanup now calls `stopServer()` before waiting for the server to end.
Two new release checks fail without this call.
Two new drain checks fail without the early closing listener and guard.
They hold real work in each app session.
The new connection must get `ECONNREFUSED` while close is still pending.
The running request must still get `200 ok`.
Both review mutants fail with exit 1; all eight listener checks pass.
Their names and counts are in the same red log.
Middleware skips late log and replay writes after closing begins.
That keeps delayed replies at service-stopped, instead of turning them into HTTP 500.

Gate proof: [GATES.json](services-closing/GATES.json).
Before the review fix, all gates and 116 flight tests passed with exit 0.
Style census for services and tests passed.
Wire diff: exit 0, zero differences over 2,160 calls and 30 error codes.
The check compares body bytes, headers, and call logs.
Only Node's wall-time Date header is normalized, as the existing check requires.
An earlier run was discarded after an extra call moved one side's test ID stream.
The clean repeat used no extra HTTP calls.
Before the review fix, locked mutation exited 0 with score 91.96.
The floor is 85.
It printed 1,451 killed, 173 timeout, 114 survived, and 28 no coverage.
Only GATES.json and the red log are committed as proof files.
The card is saved in Review.
Next: rerun all gates after this review fix.

### Advisory review

Jev found no file flags and no test flags.
The eight unit notes are false for these reasons:

- `httpRequest`, `configNotTag`: URL, method, headers, and body are request input.
  They follow ADR 0102; each call can have different values.
- `clock`, `stateOutsideCell`: the resource owns live waits and virtual time.
  These are clock state, not service data.
- `decodeBody`, `inputDefaultMasks`: an empty body has always decoded to an empty object.
  Hono's route schema then checks required fields.
  Changing this would change the wire contract.
- `middleware`, `ignoresAbortAfterAwait`: it checks the joined stop signal before saving calls or replays.
  Complete replies still drain so their status and body reach the client.
- `listener`, `stateOutsideCell`: its pending set owns live socket completion promises.
  These cannot be stored as plain service data.
- `listener`, `ignoresAbortAfterAwait`: it checks closing after listening starts.
  Cleanup also calls `stopServer()` when a release has not fired closing.
  It then joins complete replies and the server's close event.
- `webhooks`, `stopOnlyInDefer`: deferred cleanup removes the data watcher.
  Its timer stops through the clock's closing signal before the drain.
- `inFlight`, `stateOutsideCell` and `stopOnlyInDefer`: the map owns live payment-key promises.
  Middleware resolves them in `finally`; cleanup only clears the map.
  It owns no endless IO wait to abort before the drain.

The promise judge found 12 gaps in unchanged tests.
Those cover protocol inputs, route keys, thrown handlers, and the fetch ban.
They do not change or test the close fix.
The new queued-webhook title found the new README promise.
The judge does not read `test.each` titles; those four checks match that same promise.
No labels were added under `tools/jev/`, outside this card's allowed paths.
This card follows the asked gates and only the flight-trial mutation lane.

## trial/services-http

Writer: Sol.
Branch: `trial/services-http`.
Base: `d9c1500b`.
Status: Review.
Next: the lead reviews the saved commits and imports the new Jev row.
Verify: red then green, wire diff 0, four processes, and fault score 85.
The lead owns the board card; `TODO.md` is outside the allowed paths.

Assumptions:

- The brief's path limits take precedence over the fixed brief.
  No package entry or Jev label file outside those paths will change.
- Tests may import the new service's public HTTP units directly.
  The package entry is outside the allowed paths.
- The exact old status remains a wire log fact owned by a resource.
  The webhook operation maps each reply to a domain outcome first.
  Its callers receive only `delivered`, `rejected`, or `unreachable`.
- Use the existing flight-trial fault lane with every source included.
  Run it alone under the required lock.

Setup build: exit 0.
Log: `tools/flight-trial/scripts/.logs/services-http/setup-build.log`.

### HTTP resource and webhook step

The resource owns a stop signal shared by requests in flight.
It keeps that signal through response body reading.
Each call gets a request operation and its named child span.
The resource also appears on the span tree.
Tests bind `httpBackend`; no global is patched.
The webhook operation returns one domain outcome per copy.
The wire log keeps the exact status and hides the domain outcome.

Changes from the scaffold:

- The service needs only a status after consuming the reply body.
  It does not copy unused response headers or text.
- The resource belongs to the service root.
  The payment close hook stops it before waiting for operations.
  Core drains running work before resource cleanup.
  Copying the scaffold cleanup alone left the webhook open.
- A service error guard lives in the allowed service folder.
  The package error file is outside this card's paths.
- One old log test now polls for its settled wire entry.
  Receiving the body does not mean the request operation has ended.

Core feedback: graceful close waits before resource cleanup.
The failing shape is:

```ts
const sending = scope.run(httpRequest, {
  rawInput: heldRequest,
});
await scope.close({ graceful: true });
await sending;
```

With only `ctx.defer(() => stop.abort())`, both waits stay open.
The close hook calls the resource's `close()` before `event.next()`.
No Core file changed.

Logs below use `tools/flight-trial/scripts/.logs/services-http/`.
Red close: exit 1, `red-close.log`; pending reply stays open.
Red span: exit 1, `red-span.log`; no HTTP child span exists.

The close and span checks now pass, exit 0 each.
Logs: `green-close.log` and `green-span.log`.
Build, check, all 100 flight tests, and prose pass, exit 0 each.
Logs: `step2-build.log`, `step2-check.log`,
`step2-tests.log`, and `step2-prose.log`.
Check keeps the base's 28 warnings with no errors.

### Outcomes and fetch ban step

Success codes 200 and 299 become `delivered`.
Codes 300 and 503 become `rejected`.
A failed send becomes `unreachable`.
The test reads the outcome before the webhook returns to its caller.
It also checks that the control route keeps its old wire shape and code.
All five cases fail with the assigned base's sender, exit 1.
The source is saved and restored by path; no stash is used.
Log: `red-outcomes.log`.
The same cases now pass, exit 0, `green-outcomes.log`.

The fetch check reads every service TypeScript file, including new folders.
Only `http-client.ts` may read built-in fetch.
Hono's `web.fetch` and its listener method remain allowed.
The planted cases cover bare calls, global calls, computed global calls,
and saving fetch under another name.
All four fail without the ban, exit 1, `red-fetch-ban.log`.
All five fetch tests now pass, exit 0, `green-fetch-ban.log`.
Clean source passes, exit 0, `fetch-check.log`.
Build and check pass, exit 0, `step3-build.log` and `step3-check.log`.

### Caller cancellation and open body step

The held inbox now sends headers before holding its response open.
This proves close aborts body reading after fetch has returned.
The same test still fails with the old sender, exit 1.
Log: `red-close-body.log`.
The fixed sender passes, exit 0, `green-close-body.log`.

A separate call signal aborts the backend's send.
The parent can send a second request after that cancellation.
Removing the call signal from the HTTP resource makes this test fail, exit 1.
Log: `red-cancel.log`.
Restoring the signal passes, exit 0, `green-cancel.log`.
Tests use plain promise gates because this tool targets ES2023.
No tool config changed.

### Advisory review

Jev preflight: exit 0; zero file flags.
It names six units with eight notes.
All eight labels are `false`, with a reason for each.
Seven exact labels were already in the base's bank.
The one new label says request params are not service config.
ADR 0102 requires method, URL, headers, and body on each call.
Logs: `jev-preflight.log` and `jev-labels.log`.

The brief bars changes to the shared Jev bank.
The unchanged label tool ran from an owned copy under the allowed scripts folder.
The new row is saved in `SERVICES-HTTP-JEV.jsonl` for the lead to import.
The copied calibration command exits 0.
Its result is in `SERVICES-HTTP-CALIBRATION.json`.
The shared bank and calibration stay unchanged.
Log: `jev-calibration.log`.

Jev tests: exit 0; zero flags in 30 read test entries.
Log: `jev-tests.log`.
The judge reads plain test titles; Vitest also runs every table case.

Jev promises: exit 0; 13 README gaps and four unsure notes.
Log: `jev-promises.log`.
The README is outside this card's allowed paths.
Four new promises are written in `services/PLAIN.md` instead:
the fetch backend exception, open-body close, caller cancellation,
and the span tree with its resource.
The other nine are old protocol tests.
They cover plain operation values, validated forms, key retry,
empty and deep offer paths, percent-encoded calls and rules,
and thrown handlers' log and replay behavior.
Their reasons remain in the earlier protocol handoff in this file.
The wire proof also checks those same replies.
No new README promise is hidden or dropped.

### Full gate proof before mutation

The full chain exits 0.
Each command, exit code, and log path is in `SERVICES-HTTP-GATES.json`.
Build, check, all 111 flight tests, and all nine workspace test tasks pass.
Check reports zero errors and the same 28 warnings as the base.
The fetch ban, protocol check, six protocol plants, and style census pass.
Prose passes; validate passes all 16 lanes.
The workspace already allows esbuild, so its config did not change.

The wire comparison exits 0 with zero differences.
It checks 2,160 calls and all 30 error codes against `880f1c4f`.
The control comparison against the same old code also exits 0.
It checks the same 2,160 calls and 30 error codes with zero differences.
Logs: `final-wire.log` and `final-wire-same.log`.

The four-process proof exits 0.
Four distinct PIDs answer their service and control routes.
The group and all four children stop cleanly.
Log: `final-four-process.log`.
No app or writer-trial path was changed.
The mutation config matches the assigned base byte for byte.
Next: the full mutation lane alone under the lock, with floor 85.

### Full mutation and handoff

The full mutation lane exits 0 at 92.83 percent, above floor 85.
It ran alone under `flock /tmp/mutation.lock`.
All 11 source files and all 1,757 cases stayed included.
All 421 static cases stayed included.
Nothing was ignored or excluded.
The config still matches the assigned base byte for byte.
The full report's source text matches every current source file.
There are no compile or runner errors.

Counts: 1,435 killed, 196 timeouts, 94 survivors, 32 without coverage.
Stryker counts timeouts as detected cases in its score.
The HTTP client itself scores 95.56 percent.
Log: `mutation.log`.
Full report: `mutation-report.log`.
Counts and source hashes: `SERVICES-HTTP-MUTATION.json`.

No source or test changed after the passing gates or mutation run.
The last commit saves proof only.
The strict style census passes.
No app file, shared Jev file, workspace config, push, or stash changed.
The lead owns the board update and landing.

## trial/jev-link

Writer: Sol.
Branch: `trial/jev-link`.
Base: `c4cfde63`.
Rebased source commits: `731ecc3e` and `45c618df`.
Status: saved for lead review; all final gates pass.
Next: review the four fixes.
Verify: frozen Jev loads after its source packages are removed.
Failed create can retry; unavailable Jev still records the other checks.
The existing board card stays with the lead.
`TODO.md` is outside this writer's allowed paths.

Root check follows `4e22a62e`.
The flight reference app is checked inside its image.
The old install notes and repo failures are replaced by this review proof.

### Review fixes

- **Fix 1:** import every Jev module the broker loads.
  The fresh process imports `lib.mjs`, `bank.mjs`, `extract.mjs`, and `shape.mjs`.
  Shape also loads `plain.mjs`, TSDoc, the parser, and its native binding.
  The new tests remove a shape-only package and the native binding.
  Another test breaks the question bank while lib still loads.
  Commit: `f42c635d`.
- **Fix 2:** remove the unfinished frozen folder when freezing fails.
  The copy and load failure tests both repair the source and retry create.
  Other files in the trial root stay intact.
  An existing frozen trial still refuses refresh before cleanup can run.
  Commit: `e19dbeb8`.
- **Fix 3:** keep the Jev load failure while own and teacher checks run.
  Check writes `jev.json`, the manifest row, and `machine.txt`.
  Jev is `unavailable`, its exit is 1, and the machine result is `machine-fail`.
  This follows the lead's decision for trials with broken package links.
  Available trials keep their gate rules, saved answers, and score rules.
  Commit: `c29cf5dd`.
- **Fix 4:** use the rebased base and current gate proof here.
  The old setup command is removed.

### Test setup and paths

- All test trials and copied source folders use temp roots.
- The real checkout's installed packages stay in place.
- Check tests use the real Docker CLI with a missing socket in the temp root.
  `HOME` and `DOCKER_CONFIG` also point into that root.
  Docker context and TLS overrides are cleared for that child process.
  Own and teacher each try their check and record the missing-daemon failure.
  The test reads both logs and the saved unavailable Jev result.
- Package links stay inside the frozen Jev folder.
- Worker config points to frozen Jev, worker events, and named containers.
- The reference runner uses the same package freeze.
- Image package links point inside their saved container image.
- Flight teacher hashes, gate rules, and saved-answer reuse are unchanged.
- The DeepSeek trial and its runner checkout are untouched.
- No push or stash was used.

### Review step proof

Logs are under `tools/writer-trial/.logs/jev-link/`.
Each red run happened before its code fix.

- Fix 1 red: exit 1, `review-fix1-red.log`; three tests fail.
- Fix 1 green: exit 0, `review-fix1-green.log`; three tests pass.
- Fix 1 build, check, prose: exit 0 each.
  Logs: `review-fix1-build.log`, `review-fix1-check.log`, `review-fix1-prose.log`.
- Fix 2 red: exit 1, `review-fix2-red.log`; both new tests fail.
- Fix 2 green: exit 0, `review-fix2-green.log`.
  Both retry tests and the existing frozen-copy test pass.
- Fix 2 build, check, prose: exit 0 each.
  Logs: `review-fix2-build.log`, `review-fix2-check.log`, `review-fix2-prose.log`.
- Fix 3 red: exit 1, `review-fix3-red.log`; both new tests fail.
- Fix 3 green: exit 0, `review-fix3-green.log`; both tests pass.
- Fix 3 build, check, prose: exit 0 each.
  Logs: `review-fix3-build.log`, `review-fix3-check.log`, `review-fix3-prose.log`.
- Each source commit hook exits 0.
  Logs: `review-fix1-commit.log`, `review-fix2-commit.log`, `review-fix3-commit.log`.

### Final review proof

Logs are under `tools/writer-trial/.logs/jev-link/`.
The full chain runs in order and stops if a gate fails.

- Full gate chain: exit 0, `review-final-gate.log`.
- Workspace build: exit 0, `review-final-build.log`.
- Check: exit 0, `review-final-check.log`.
  Zero errors and 28 warnings; no new warnings.
- Writer-trial tests: exit 0, `review-final-tests.log`; all 91 pass.
  This includes the full gate, score, freeze, and retry tests.
- Prose: exit 0, `review-final-prose.log`; no hits.
- Validate: exit 0, `review-final-validate.log`; all 16 lanes pass.
- Jev preflight: exit 0, `review-final-jev.log`; no TypeScript targets.
  Range: `c4cfde63..HEAD`.
  No package TypeScript tests changed, so tests and promises judges have no targets.
  No label lines are owed; no Jev files were changed.
- Each gate's exit and log path is also in `review-final-exits.json`.
- Final diff and scope check: exit 0, `review-final-scope.log`.
  Every changed path is allowed; teacher files are unchanged.

Core feedback: none; this change uses no Core API.

## trial/flight-data

Writer: Sol.
Branch: `trial/flight-data`.

### Source step

Pinned OpenFlights through the GitHub commit API.
Commit: `7d1a611e070295dba776d6afb86e57d0d1aa1cef`.
The file URLs, SHA-256 hashes, and sizes are in
`tools/flight-trial/data/manifest.json`.
The source check fetches each pinned file and checks its hash.
It rebuilds the subset and compares the data without spacing.

Assumptions:

- Busy means the count of routes touching an airport.
- Keep the top 60; break ties by numeric airport ID.
- Keep nonstop routes with known airport and airline IDs.
- Drop codeshares and repeated airline routes.
- Keep every airline used by the kept routes.
- Route and airline records are historical.
- Data carries ODbL 1.0 and DbCL 1.0 with license links.

Proof:

- Source check: exit 0, `tools/flight-trial/.logs/sources-step.log`.
- Prose: exit 0, `tools/flight-trial/.logs/prose-step.log`.

### Generator and reader step

The private `flight-trial` tool uses Core's seeded random.
`generateFlights(seed)` returns owned flight data.
`readFlights()` loads the saved compressed JSON.
`search({ supplier, origin, destination, date })` returns deep copies.
Services own the returned offers and can change them.
A shared flight keeps the same ID at both suppliers.
An offer ID also names its supplier.

Assumptions:

- Default seed: 97; alternate proof seed: 98.
- Dates: 2027-01-15 and 2027-01-16, in UTC.
- Airport codes are exact, uppercase IATA codes.
- Search covers direct flights only.
- The source stays in normalized JSON, not raw CSV.
- Saved flights use gzip to fit the one MB limit.
- Currency is USD; prices are whole cents.
- There are two cabins, economy and business.
- Fare classes share the cabin's remaining seats.
- Each route has one or two departures per day.
- A seeded 35 percent choice gives two departures on both dates.
- First departures fall from 06:00 through 13:59 UTC.
- Second departures fall from 14:00 through 21:59 UTC.
- Distance uses a 6,371 km sphere and rounds to whole km.
- Duration uses 800 km per hour plus 30 minutes, rounded up.
- Cabins have 180 and 24 seats.
- Every 47th flight has one to three seats left per cabin.
- Other cabins use 20 to 90 percent of seats, rounded down.
- Base price is 3,500 cents plus nine cents per km.
- Business uses a factor of 2.8 before seeded price changes.
- Seeded prices vary from 90 to 110 percent of that base.
- Standard and flex cost 1.2 and 1.5 times saver.
- Sorted airline IDs assign every airline to two suppliers.
- Supplier A adds two percent and 100 cents.
- Supplier B adds 4.5 percent.
- Supplier C adds one percent and 500 cents.
- Missing airline codes use OF plus the OpenFlights ID.
- Flight numbers are made up; the flight ID is the shared key.
- No services consume this new package yet.
- No Core code needed a change.

Proof, all under `tools/flight-trial/.logs/`:

- Install: exit 0, `install.log`.
- Core build: exit 0, `core-build.log`.
- Workspace build: exit 0, `build-code.log`.
- Check: exit 0, `check-code.log`; zero errors, 29 warnings.
- Reader tests: exit 0, `test-code.log`; six passed.
- Style census: exit 0, `style-code.log`.
- Source hashes and size: `sources-code.log` failed after the commit hook changed JSON spacing.
  The source check step below records the fix.
- Seed hashes: exit 0, `seeds-code.log`.
- Prose: exit 0, `prose-code.log`.

The same-seed gzip hash from both runs:
`980a84b24a0d56c4203d17f2a3b7e9448174a388664eafa781fe9da0961e0671`.
The seed 98 gzip hash:
`158933a8ad90c15ae6d6680bcbb3593efbc3e3ff08711c7fe8722b71e84c5dad`.
Seed 97 has 10,996 flights and 563,628 compressed bytes.
Its uncompressed JSON has 7,111,928 bytes.
The source subset has 289,080 saved bytes.

### Source check step

The commit hook formats JSON, so it changed the subset's saved bytes.
The pinned OpenFlights files still have the same hashes.
The manifest now records the formatted subset's hash and size.
The check compares rebuilt data after parsing both JSON files.
This ignores spacing while still checking every stored value.
It also checks the saved file hash against the manifest.

Assumption: source subset spacing may follow the repo formatter.
Proof: source check exit 0, `.logs/sources-fixed.log`.
The full data directory has 854,736 bytes after the hook.

### Final proof

Status: saved for lead review.
No push, mutation lane, or Core change was needed.
The board stays with the lead; it is outside this writer's allowed paths.

Final logs are under `tools/flight-trial/.logs/`.

- Build, check, and reader-test chain: exit 0, `final-gate.log`.
- Workspace build: exit 0, `final-build.log`.
- Check: exit 0, `final-check.log`; zero errors, 29 warnings.
- Reader tests: exit 0, `final-test.log`; six passed.
- All workspace tests: exit 0, `final-workspace-tests.log`.
- Prose: exit 0, `final-prose.log`.
- Prose width check: exit 0, `prose-wide.log`; zero wide lines.
- Source hashes, subset, and size: exit 0, `final-sources.log`.
- Seed replay and saved data: exit 0, `final-seeds.log`.
- Style census: exit 0, `final-style.log`.
- Validate: exit 0, `final-validate.log`; all 16 lanes pass.
- Jev source review: exit 0, `jev-ticket-preflight.log`; no flags.
- Jev test review: exit 0, `jev-tests.log`; no flags.
- Jev README promises: exit 0, `jev-promises.log`; no gaps.

The first check found excess branches in the generator.
A flight-number helper fixed it.
The log is `check-step.log`, exit 1; final check is green.
The first post-commit source check failed on JSON spacing.
The log is `sources-code.log`, exit 1; final source check is green.

The requested Jev range `main..HEAD` included earlier scaffold work.
That run was stopped with exit 143, `jev-preflight.log`.
Assumption: review this ticket from its given start commit instead.
The range `24e47d75..HEAD` covers only this writer's work.
It has one note: the generator reads like an operation.
It is a data build step; no Tinker service is made here.
No flags need labels, so no other tool's files were changed.

Saved data sizes:

- `source.json`: 289,080 bytes.
- `flights.json.gz`: 563,628 bytes.
- `manifest.json`: 1,188 bytes.
- `LICENSE.md`: 840 bytes.
- Total: 854,736 bytes, below 1,000,000.
- Source: 60 airports, 149 airlines, 4,058 routes.
- Default flights: 10,996 over two departure dates.
- Uncompressed default flights: 7,111,928 bytes.

Core feedback: none.
Its testing entry provided seeded random without a workaround.

### Review fix round

Lead review: `6b9e3155`.
M1 keeps the random handle and calls `random.next()`.
Cabin draws use a callback that calls the same handle.
This removes the package's unbound-method warning.
No output bytes changed from M1 alone.

M1 proof, under `tools/flight-trial/.logs/`:

- Workspace build: exit 0, `review-m1-build.log`.
- Check: exit 0, `review-m1-check.log`; 28 warnings, none in this tool.
- Reader tests: exit 0, `review-m1-test.log`; six passed.
- Old saved gzip and seeded runs: exit 0, `review-m1-seeds.log`.

The M1-only seed 97 hash is still
`980a84b24a0d56c4203d17f2a3b7e9448174a388664eafa781fe9da0961e0671`.

Review changes after M1:

- M2: `offers(supplier)` returns all that supplier's offers as deep copies.
  It and search use one pricing function.
  Services can seed their owned data from it.
- M3: source sorting uses plain code-point comparisons.
  The subset hash stays unchanged.
- S4: the manifest records the generated JSON hash.
  Seed proof compares JSON hashes after removing saved gzip compression.
  Gzip hashes are reference values only.
- S5: the unused reader file parameter is gone.
- S6: docs say starting seats match and owners change their own copies.
- S7: two numbers per sorted route make each departure number repeat daily.
  The saved seed 97 data was rebuilt.
- S8: counts and positive integers have names that match their checks.
  Cents is used only for money.
- S9: arrival checks list bad offer IDs across all three suppliers.
  Near-full checks print the actual cabin seat numbers.
  Query lists are no longer built by walking the generator output.
- S10: mutation config, script, dependencies, and excludes are in place.
  The floor is 85; the lead runs that lane at landing.
  The writer did not run it.

Assumptions:

- Flight numbers keep their two-character airline prefix in this snapshot.
- Each sorted route reserves two numbers, one per departure slot.
- The largest possible suffix here is 8,116.
- JSON bytes include the saved trailing newline.
- Saved gzip bytes may differ by system or zlib version.
- Services own seats separately after reading the same starting fixture.

Working-step proof, under `tools/flight-trial/.logs/`:

- Install: exit 0, `review-install.log`.
- Workspace build: exit 0, `review-build-step.log`.
- Check: exit 0, `review-check-step.log`; 28 warnings.
- Reader tests: exit 0, `review-test-step.log`; 11 passed.
- Source hashes and subset: exit 0, `review-sources-step.log`.
- Seed JSON proof: exit 0, `review-seeds-step.log`.
- Prose: exit 0, `review-prose-step.log`.
- Style census: exit 0, `review-style-step.log`.

Regression proof:

- Old fixture: exit 1, `review-number-regression.log`.
  The daily-repeat and one-to-four-digit tests both fail.
- New fixture: exit 0, `review-test-step.log`; all 11 pass.
- Changed gzip OS header, old check: exit 1, `review-os-header-old.log`.
- Changed gzip OS header, JSON check: exit 0, `review-os-header-new.log`.
  The saved gzip was restored after both checks.

New seed 97 JSON hash, equal in both runs:
`6148b99dbd2e24c33c0d0e5e1b52d1b13e29c96637813f11f14201b928b19e2e`.
Seed 98 JSON hash:
`72b5169c65d387a703f3bb0f07cee96c988963c3e76de97a06cf716b777b4355`.
Seed 97 gzip hash on this system:
`b038094f27c92202af9fbbfb86197cc9a47cd1b5d0f70717ee4ba74245d5d3bd`.
Seed 98 gzip hash on this system:
`9214ac999483dd40c288cca8aff14a87077265afadec7cf53c6e666bd7efde41`.
The source subset hash stays
`965edecf15344a8736e56b846473c3a6a5920f345aa8b8955c101ffeb74a4f66`.

New sizes:

- Seed 97: 10,996 flights.
- Seed 97 JSON: 7,110,562 bytes.
- Seed 97 gzip: 552,178 bytes.
- Seed 98: 11,078 flights; gzip 556,770 bytes.
- Source subset: 289,080 bytes.
- Manifest: 1,493 bytes.
- Data license: 840 bytes.
- Total saved data: 843,591 bytes.

The earlier proof and hashes above describe the version before this review.
The review proof here describes the new saved fixture.

Final review gates ran in the foreground, one at a time.
All final logs below are under `tools/flight-trial/.logs/`.

- Workspace build: exit 0, `review-final-build.log`.
- Check: exit 0, `review-final-check.log`.
  It prints zero errors and 28 warnings.
  None are in `tools/flight-trial`.
- Reader tests: exit 0, `review-final-test.log`; all 11 pass.
- Source hashes and subset: exit 0, `review-final-sources.log`.
  The subset hash stays unchanged; total data is below one MB.
- JSON seed proof: exit 0, `review-final-seeds.log`.
  Both seed 97 JSON hashes match; seed 98 differs.
  Saved JSON matches the manifest and the fresh seed 97 JSON.
- Prose: exit 0, `review-final-prose.log`.
- Strict style census: exit 0, `review-final-style.log`.
- Jev preflight: exit 0, `review-final-jev-preflight.log`.
  Range: `24e47d75..HEAD`; no flags, one operation note.
- Jev tests by name: exit 1, `review-final-jev-tests-name.log`.
  The tool tries to open `flight-trial` as a file.
- Jev tests by file: exit 0, `review-final-jev-tests.log`.
  All 11 entries have no flags.
- Jev promises by name: exit 1, `review-final-jev-promises-name.log`.
  The tool tries to read `packages/flight-trial/tests`.
- Jev promises by path: exit 0, `review-final-jev-promises.log`.
  All 11 titles have README lines.
- Validate: exit 0, `review-final-validate.log`; all 16 lanes pass.

Assumption: use the Jev tools' supported path forms for this private tool.
The checks use the same test file and README as the requested name forms.
The test command uses `tools/flight-trial/tests/flights.test.ts`.
The promises command uses `../tools/flight-trial`.
No Jev files were changed; they are outside the allowed paths.
There are no flags to label.
The operation note still describes a data build step, not a live service.

The workspace already allows the esbuild build step for validate.
No workspace config change was needed.
The mutation lane stays with the lead at landing.
Core feedback: none.

### Landing mutation lift

The lead rebased the branch onto `origin/main`.
The three earlier fix commits now end at `dbf8d072`.
The lead's first lane scored 32.02 percent.
Log: `/tmp/flight-data-land-mutate.log`.

The tests loaded the reader and generator before the tests started.
Those reads now happen inside each test.
New public seam tests cover the saved seed 97 JSON bytes,
one known flight, all three supplier prices, unknown suppliers,
and corrupt or wrong-shaped reader input.

The reader has a gzip-byte overload for real input:

```ts
const reader = await readFlights(gzipBytes);
```

Assumption: this requested bad-input behavior needs a byte input seam.
It does not restore the old unused file-path argument.
Tests borrow bytes from their own fixtures; saved data is never changed.
The reader borrows those bytes and owns the parsed records.
Unknown supplier names return an empty list.
Corrupt gzip is now a named error, as corrupt JSON already was.
Error payloads keep the file and reason.
The unused error message format is gone.
The missing-airline-code fallback is gone: all pinned codes have two characters.
No data, threshold, or mutation file list changed.

Working-step proof, under `tools/flight-trial/.logs/`:

- Workspace build: exit 0, `lift-build-step.log`.
- Check: exit 0, `lift-check-step.log`; 28 warnings.
- Reader and generator tests: exit 0, `lift-test-step.log`; 31 pass.
- Source hashes: exit 0, `lift-sources-step.log`.
- Seed JSON hashes: exit 0, `lift-seeds-step.log`.
- Strict style census: exit 0, `lift-style-step.log`.

Mutation proof:

The lane ran alone in this worktree under `/tmp/mutation.lock`.
No other work ran here until it finished.
The shell refused the requested `rm -rf` command before it ran.
A path-checked cleanup removed only `.stryker-tmp` instead.
The mutation command itself used the requested lock and package script.

Log: `tools/flight-trial/.logs/lift-mutate-1.log`.
Exit: 0.
The package score is 94.72 percent; the floor stays 85.

- All files: 232 killed, one timeout, nine survived, four without coverage.
- `schema.ts`: 100.00 percent; 33 killed, none survived or without coverage.
- `flights.ts`: 95.10 percent; 193 killed, one timeout, six survived, four without coverage.
- `errors.ts`: 66.67 percent; six killed, three survived, none without coverage.

Remaining misses are the generator's source-file failure paths,
negative error-guard cases, and a random cutoff equality.
The cutoff changes less-than to less-than-or-equal at 0.35.
Core's random cannot produce exactly that value.
No guard-only test was added.
The threshold applies to the whole package, as in its config.

Final proof, under `tools/flight-trial/.logs/`:

- Workspace build: exit 0, `lift-final-build.log`.
- Check: exit 0, `lift-final-check.log`; zero errors and 28 warnings.
  None are in this package.
- Package tests: exit 0, `lift-final-test.log`; 31 pass.
- Source check: exit 0, `lift-final-sources.log`.
- Seed check: exit 0, `lift-final-seeds.log`.
- Data bytes compared with `dbf8d072`: exit 0, `lift-final-data-bytes.log`.
  Every saved data file is unchanged.
- Strict style census: exit 0, `lift-final-style.log`.
- Jev preflight: exit 0, `lift-jev-preflight.log`; no flags, one operation note.
  Range: `origin/main..HEAD` after the lead's rebase.
- Jev tests: exit 0, `lift-jev-tests.log`; no flags in all 31 tests.
- Jev promises: exit 0, `lift-jev-promises.log`; no README gaps.
- Validate: exit 0, `lift-final-validate.log`; all 16 lanes pass.
- Prose: exit 0, `lift-final-prose.log`.

The gzip hash is still
`b038094f27c92202af9fbbfb86197cc9a47cd1b5d0f70717ee4ba74245d5d3bd`.
The seed 97 JSON hash is still
`6148b99dbd2e24c33c0d0e5e1b52d1b13e29c96637813f11f14201b928b19e2e`.
The source subset hash is still
`965edecf15344a8736e56b846473c3a6a5920f345aa8b8955c101ffeb74a4f66`.
Saved data stays at 843,591 bytes.
No mutation config, threshold, file list, or lockfile changed.
Core feedback: none.

## trial/flight-services

Writer: Sol.
Branch: `trial/flight-services`.
Status: saved for lead review; all numbered proof is complete.
The board stays with the lead; it is outside this writer's paths.

### Services and reader steps

Suppliers A, B, and C run as separate Core apps behind HTTP.
Payment runs as a fourth Core app.
Each process owns its data, scope, clock, and HTTP listener.
Tags hold its port, host, supplier ID, token, secret, and delays.
Operations own the service and grader actions.
Data watchers start hold expiry and signed webhook sends.
A startup extension puts listener failures under Core's root lifetime.
Its TSDoc gives that reason.
The command entries live in `scripts/`, beside the data commands.
All service implementation files are in the mutation list.

The rebase onto `origin/main` completed with exit 0.
Its data landing base is `28f52488`.
Old data commits dropped out as already applied.
Conflicts kept main's data, reader, scripts, and mutation setup.
The reader is now `readFlights()` with no file argument.
Each supplier loads its complete stock from `offers(supplier)` before HTTP starts.
The same saved data and starting seats stay in place.
No saved data files or data scripts changed.

Saved steps after the rebase:

- `2d244d47`: supplier and payment Core apps, with HTTP tests.
- `dc8ac7a5`: four processes, Compose, and live service proof.
- `60b7a3d7`: manual webhook plans replace pending sends.
- `b0e6601b`: real clocks, gate proof, and Core feedback.
- `21836d86`: injected payment errors keep Stripe's shape.
- `f18c64c6`: the call log counts requests before they end.
- `16b38cd6`: supplier state uses all offers from the landed reader.
- `0f0a83fe`: child command entry lives with the launcher.
- `295fa075`: HTTP fields, groups, refunds, resets, and bad requests.
- `4d64d5c7`: post-rebase proof, assumptions, and review answers.

The last code step fixed three bugs found by HTTP tests.
The flight-number field now omits the saved airline prefix.
Scenario seed scopes close with `graceful: true`.
A saved payment reply is copied so later intent changes cannot change it.
The unused supplier scenario cell was removed.
The stock cell holds all scenario data.

### Numbered proof

All logs below are under `tools/flight-trial/.logs/`.

1. The tests start all suppliers and payment on free ports.
   Calls after startup use service HTTP and control HTTP only.
   The payment inbox is a real HTTP server.
   Final test proof: exit 0, `services-final-tests.log`; 67 tests pass.
2. Supplier HTTP tests prove shared A and B flights, one winner in a parallel seat race,
   and hold expiry at its deadline with a returned seat.
   They also prove cabin stock, group totals, stale prices, and stock edits before search.
   The same final test log has exit 0.
3. Payment HTTP tests check the exact body signature with the shared secret.
   They prove parallel and later key replay, late and twice delivery, and refunds.
   Manual plans change only the chosen intent.
   The same final test log has exit 0.
4. Control HTTP tests prove a delayed call is logged while pending.
   Its one log entry then holds the final failure status and start time.
   They also prove repeat counts, token checks, clocks, and scenario resets.
   The same final test log has exit 0.
5. Compose starts Postgres and Mailpit with the images pulled just before use.
   Postgres runs real SQL; Mailpit accepts SMTP and exposes the message in its inbox API.
   Four distinct child process IDs answer service and control HTTP.
   Their parent and all four children then stop cleanly.
   The proof project, its containers, network, and volume were removed.
6. The final build, check, package and workspace test chain has exit 0.
   Log: `services-final-gate.log`.
   Check has zero errors and 28 warnings, with none in this package.
   Validate has exit 0 and all 16 lanes pass.
   Prose and width proof are recorded in the final gates below.

Live proof:

- Compose image pull: exit 0, `services-final-compose-pull.log`.
- Compose up: exit 0, `services-final-compose-up.log`.
- Compose status: exit 0, `services-final-compose-status.log`; both healthy.
- Postgres SQL: exit 0, `services-final-postgres.log`; SELECT returned 1.
- Mail client image pull: exit 0, `services-final-mail-client-pull.log`.
- Mailpit SMTP and inbox: exit 0, `services-final-mailpit.log`.
- Four-process HTTP proof: exit 0, `services-final-process-proof.log`.
- Compose cleanup: exit 0, `services-final-compose-cleanup.log`.

### Final gates after the rebase

- Rebase: exit 0, `services-rebase-success.log`.
- Install: exit 0, `services-postbase-install.log`.
- Core build: exit 0, `services-postbase-core-build.log`.
- Workspace build: exit 0, `services-final-build.log`.
- Check: exit 0, `services-final-check.log`.
  It has zero errors and 28 warnings, matching main's data proof.
  None are in this package.
- Package tests: exit 0, `services-final-tests.log`; 67 pass.
- All workspace tests: exit 0, `services-final-workspace-tests.log`.
- Full gate chain: exit 0, `services-final-gate.log`.
- Validate: exit 0, `services-final-validate.log`; all 16 lanes pass.
- Prose: exit 0, `services-final-prose.log`.
- README and progress width: exit 0, `services-final-prose-width.log`; no wide lines.
- Source hashes and subset: exit 0, `services-final-sources.log`.
- Seed JSON hashes: exit 0, `services-final-seeds.log`.
- Saved data and data scripts compared with main: exit 0, `services-final-data-diff.log`.
  The diff is empty.
- TSDoc shape: exit 0, `services-final-tsdoc.log`; no S26 rows.

The first final workspace test run hit a five-second timeout in the group test.
Validate was running beside it.
The gate was then run alone and passed with no code or timeout change.
First chain: exit 1, `services-final-gate-first.log`.
First workspace tests: exit 1, `services-final-workspace-tests-first.log`.
The final passing logs above keep the full output.

Regression proof:

- Old flight-number field: exit 1, `services-number-regression.log`.
- Old reset and saved-reply behavior: exit 1, `services-lift-tests.log`.
  The scenario reset and original-reply tests fail.
- Fixed code: exit 0, `services-lift-fixed-tests.log`.
- Missing pending-call entry: exit 1, `services-call-log-regression.log`.
- Wrong injected payment error shape: exit 1, `services-errors-regression-fixed.log`.
- Missing manual-send cancellation: exit 1, `services-cancel-regression-fixed.log`.

The first cancellation test checked the inbox too soon and passed without the fix.
Log: `services-cancel-regression.log`, exit 0.
It now reads the intent through HTTP and proves it stays processing after cancellation.
The first host mail check used the workspace container's loopback address and failed.
Log: `services-mailpit-proof.log`, exit 1.
The passing checks use the Compose network; no host setting changed.

### Mutation

The file list covers `src/**/*.ts` and `services/**/*.ts`.
The breaking floor stays 85.
Each full run holds `/tmp/mutation.lock` and runs in the foreground.
The first services run scored 73.59 percent, with exit 1.
Log: `services-mutation-first.log`.
Its JSON report is saved as `services-mutation-first.json`.
The new tests cover missing public behavior; they do not read helpers or cells.
The final full run scored 92.72 percent, with exit 0.
Log: `services-mutation-second.log`.
Its JSON is saved as `services-mutation-final.json`.
There are 1,046 killed cases, 75 timeouts, 68 survivors, and 20 without coverage.
No case has a runner error.
The service files alone score 92.59 percent.
Supplier is 95.81; payment is 92.21; shared HTTP is 87.91.
The floor applies to the package, as in the unchanged threshold.
A comparison matches 137 old misses to final `[Killed]` rows.
It counts no timeout as a killed row.
Proof: exit 0, `services-mutation-kill-proof.log`.
The complete remaining cases stay in the JSON report for review.
No guard-only or metadata test was added.
The shell refused `rm -rf`; a path-checked cleanup removed only `.stryker-tmp` instead.
No file, static mutant, or threshold was excluded to raise the score.

### Jev and style

- Full requested preflight: exit 0, `services-final-jev-preflight.log`.
  `main..HEAD` includes earlier scaffold work outside this ticket.
- Ticket preflight: exit 0, `services-final-jev-ticket.log`.
  `origin/main..HEAD` covers only this writer's work.
  It has no file flags and six non-noisy unit flags.
- Test review: exit 0, `services-final-jev-tests.log`; no flags in 36 service tests.
- README promise review: exit 0, `services-final-jev-promises.log`.
  The shared-flight line was made explicit.
- Second promise review: exit 0, `services-final-jev-promises-fixed.log`.
  It found one different gap about stock edits before search.
  That README line is now explicit.
- Final promise review: exit 0, `services-final-jev-promises-complete.log`.
  All 67 titles have README lines; none are unsure.

The false labels below give each flag its reason.
The path limit forbids changing `tools/jev/cases.jsonl` or `calibration.json`.
No label was written to that bank.

- `inputDefaultMasks`: false, `http.ts#readRequest`.
  Empty bodies support confirm calls.
  Route schemas reject missing amounts, slices, and control fields through HTTP tests.
- `stateOutsideCell`: false, `payment/index.ts#schedule`.
  It edits the operation's owned copy before that operation writes the Core cell.
  It retains no state outside the cell.
- `stateOutsideCell`: false, `supplier/index.ts#changeStock`.
  It edits the control operation's owned copy before the Core cell write.
- `configNotTag`: false, `payment/index.ts#sendWebhook`.
  URL, clock, and stop signal come from tags or resources; the signing secret is a tag.
  Body and signature belong to one call; method and content type are fixed wire facts.
- `stopOnlyInDefer`: false, `payment/index.ts#webhooks` and `supplier/index.ts#holds`.
  The resources own subscriptions and remove them in defers.
  Their owned operations read both stop signals and finish on stop.
- `stopOnlyInDefer`: false, `payment/index.ts#action`, in the full requested run.
  It awaits owned route work and stores key replies.
  It owns no socket or background wait; those operations read the stop signal.
- Earlier `memoKeyIgnoresInput`: false, `http.ts`.
  The grader's route repeat deliberately replays across different bodies.
  It is a requested injected fault, not a service cache.

These paths start at `tools/flight-trial/services/`.
The `~wrapsCallersStep` hit is noisy and needs no label.
Inherited scaffold flags stay with that card's lead.

Strict style census: exit 1, `services-final-style.log`; only S16 has hits.
Its three source `preset` calls are explicitly required by this ticket.
That user instruction overrides the skill's test-only preset rule.
Every other strict row is zero.
Exception proof: exit 0, `services-style-exception-proof.log`.
It checks the raw census has only the three required preset calls.

### Assumptions and limits

- APIs keep the requested small Duffel and Stripe shapes, not their full feature sets.
- Supplier searches use one direct slice.
- Every passenger uses one seat; an omitted passenger list means one passenger.
- Passenger identity, order cancellation, and instant card details are out of scope.
- Supplier state is owned separately after loading the same starting fixture.
- Fare classes share the seats of one flight and cabin.
- Offer IDs are fresh quotes; orders check the original price against current stock.
- Prices are decimal USD strings; payment and refund amounts use whole cents.
- Duffel carrier IDs are the saved OpenFlights numeric IDs, written as strings.
- Duffel's flight-number field omits the saved two-character airline prefix.
- Holds last 1,000 ms and confirmation webhooks wait 20 ms by default.
- A late plan defaults to 1,000 ms; manual now sends at once.
- Last-seat seeds every cabin with one seat; default restores the reader's full stock.
- Real time is the default; switch to the test clock before starting timed work.
- Scenario reset keeps the current clock and clears state, rules, and calls.
- Route rules name the exact HTTP method and path, rather than a path pattern.
- Route repeat replays the saved reply across bodies; setting the rule again clears it.
- Payment keys last until reset or stop and compare decoded JSON, including key order.
- Webhooks make no automatic retries; a failed HTTP send logs status zero.
- Service and control log status zero means pending; control calls are also logged.
- The service calls need no token on the private trial network; all control calls do.
- Local ports, credentials, secret, token, and receiver URL are documented defaults.
  The trial runner must set its actual webhook receiver URL.
- Compose uses Postgres 17 and Mailpit 1.27, with a named Postgres volume.
  Ports 55432, 51025, and 58025 avoid the existing Victoria ports.
- The mail client runs on Compose's network because the workspace has a separate loopback.
- Data command entries use built `dist` and live under `scripts/`.
- Service process entries now live under `services/` and run the graph source.
- Jev uses file and relative package paths because the name form does not find this tool.
- Jev label reasons stay in this allowed progress file for the lead to place in the bank.
- The board stays with the lead; there is no push from this writer.
- The first writer used source presets to follow the old brief.
  The review round removed them; S16 now passes.

### Core feedback

A root stop signal asks for graceful close.
It does not cancel a running operation's `ctx.signal`.
This probe leaves `closed` pending until its virtual wait ends:

```ts
const stop = new AbortController();
const clock = makeTestClock();
const wait = operation({
  label: "wait",
  async run(_, ctx) {
    await ctx.clock.sleep(100, ctx.signal);
  },
});
const scope = createScope({ clock, signal: stop.signal });
const pending = scope.run(wait);
stop.abort();
await scope.closed;
```

The early-close assertion failed as expected.
Advancing the clock by 100 let the root close with success.
Proof: exit 0, `services-core-feedback.log`.
Service waits also read the caller's stop signal so Core can drain the root.
No Core change is requested.

A plain `seed.close()` returns cancelled, even when the seed owns only data.
This incorrect success check fails:

```ts
const state = data({ label: "seed", initial: {} });
const seed = createScope({
  presets: [preset(state, {})],
});
seed.resolve(state);
const ended = await seed.close();
assert.equal(ended.status, "success");
```

The returned cancelled value is in `services-seed-close-probe.log`, exit 0.
The first writer changed seed scopes to `seed.close({ graceful: true })`.
The review round removed those scopes and writes plain scenario data instead.
The previous HTTP reset failure and passing fix are in the regression logs above.
This follows Core's close rule; no Core change is requested.

### Review fix round: strict graph impact

Owner: Codex; branch `trial/flight-services`.
The first fix lane passed at 90.30 percent.
The A/B lane passed at 89.20 percent.
Both used the unchanged floor of 85 and the package lock.
Logs: `fix-mutate-1.log` and `fix-ab-mutate.log`.
They are under `tools/flight-trial/.logs/`.

The user added strict v0 and the graph-only rule after those lanes.
Their checks will run again after this change.

Impact, written before removing the start functions:

- Remove `startSupplier` and `startPayment` from the package entry.
- Export each app extension and its tags for test entry points.
- Update `src/index.ts`, both service tests, and the launcher.
- Replace `scripts/service.mjs` with two service process entries.
- Each process entry alone creates its scope and owns OS signals.
- Tests create scopes directly and then use only HTTP.
- No caller exists outside `tools/flight-trial/`.
  The repo search found only those files and the two definitions.
- Check the removed names again after the change.

Core feedback: shared unit with a slot.
The shared HTTP builder took an operation handle and made units.
Strict v0 forbids that builder, so each service declares the units.
A shared declared unit with a slot for the service action would avoid the copies.
No Core change is part of this card.

### Strict v0 and graph-only fix

Each service now declares its dispatch operation and listener resource.
The clock resource owns a plain object; no class remains in services.
Each wait operation uses its own dependencies and signals.
One-caller helpers and whole-state helper inputs are gone.
`PLAIN.md` lists the six remaining pure functions,
the source and use of each parameter, and their call sites.
Each has at least two callers and at most three plain parameters.

`startSupplier` and `startPayment` are gone.
Only `services/supplier/main.ts` and `services/payment/main.ts`
create process scopes and own process signals and exit.
The launcher runs those files.
Tests create scopes directly with tags and app extensions.
Even the test webhook inbox is owned by a resource.
Service tests still drive and read only HTTP.
Wire types now live in `Wire`; the wiring namespace is gone.
A still has inferred operation input and no context annotations.
B still has a resource-owned map for pending payment calls.
Its entries are removed in `finally`, including thrown routes.

First proof: 72 tests passed, exit 0, `fix-strict-test-first.log`.
Launcher proof: four separate processes answered service and control HTTP,
then stopped cleanly, exit 0, `fix-strict-process.log`.

Strict Jev review: exit 0, `fix-strict-jev-preflight.log`.
It has no file flags and ten flagged units.
Test review: exit 0, `fix-strict-jev-tests.log`; no flags in 41 service tests.
TSDoc parser: exit 0, `fix-strict-tsdoc.log`; five files and no S26 rows.
Graph audit: exit 0, `fix-strict-graph.log`.
It finds no context annotations, testing imports, old start helpers,
old wiring names, or classes, and exactly six plain functions.

The path limit keeps Jev labels and reasons in this progress file.
Labels for the strict review:

- `stateOutsideCell`: false, `http.ts#clock`.
  The user requires a resource-owned plain clock object.
  Its private time and wait set belong to that resource.
- `inputDefaultMasks`: false, `http.ts#decodeBody`.
  Empty bodies support confirmation calls.
  Leaf input readers still return the wire error for missing required fields.
- `stopOnlyInDefer`: false, `payment/index.ts#finishDelivery`.
  The waiting operation checks the combined stop signal before calling it.
  The sending operation uses that stop signal for fetch.
- `stopOnlyInDefer`: false, `payment/index.ts#webhooks`.
  This resource owns the subscription; its delivery operation owns the wait.
  Scope stop ends that wait, and deferred cleanup removes the subscription.
- `stateOutsideCell` and `stopOnlyInDefer`: false, `payment/index.ts#inFlight`.
  The user explicitly requires this private live-work map in a resource.
  Operations own and await the routes, and remove keys in `finally`.
  Resource cleanup clears the empty map.
- `stopOnlyInDefer`: false, `payment/index.ts#action`.
  It awaits Core route work and owns no timer or socket.
  Route waits and sends observe stop through their dependencies.
- `stopOnlyInDefer` and `ignoresAbortAfterAwait`: false, both `http` resources.
  The resources own Node listeners and close all sockets on cleanup.
  Core owns the dispatched operations; their waits observe stop.
  The four-process HTTP proof and pending-call stop tests pass.
- `stopOnlyInDefer`: false, `supplier/index.ts#holds`.
  It owns the watch subscription; the expiry operation owns the wait.
  That operation reads the combined stop signal before releasing seats.
- `noOpRejected`: false, `supplier/index.ts#pay`.
  Duffel rejects orders that are not awaiting payment.
  Tests prove paid holds, instant orders, and expired holds return 409.

### Payment listener test gap

The first strict mutation lane scored 84.81 percent and exited 1.
Log: `fix-strict-mutate.log`; saved report: `fix-strict-mutation-first.json`.
It checked all nine source files and all 1,580 cases.
There were 1,295 killed, 45 timeouts, 131 survivors,
109 without coverage, and no runner errors.
The floor stays 85 and no source file or case is excluded.
The new process entries remain in the lane.

Splitting the listeners gave payment its own route handling.
Its HTTP tests did not yet prove parallel delayed route repeats.
A new test saves an intent reply, starts two delayed calls with new bodies,
and proves exactly one call uses that saved reply.
The other call creates a new intent for its own amount.
This follows the existing README promise for parallel repeats.

Removing the payment repeat decrement makes that test fail:
exit 1, `fix-strict-repeat-red.log`.
Restoring the code passes it: exit 0, `fix-strict-repeat-green.log`.
The full package has 73 passing tests:
exit 0, `fix-strict-repeat-test.log`.

Workspace checks first hit the bounded-state test's five-second limit.
Logs: `fix-strict-workspace-test-first.log`
and `fix-strict-workspace-test-serial.log`, both exit 1.
The first retry put the runner flag after the task name,
so Vitest received an unknown flag: `fix-strict-workspace-test-option.log`, exit 1.
The correct runner command puts its option before the task name.

The bounded-state test makes hundreds of real HTTP calls.
It now has a 20-second test limit so that batch can finish on a shared host.
Its offer count and byte-size assertions are unchanged.
This is a test limit, not a claim about service speed.
No production code, fixture, or mutation setting changed.

The new payment test has no Jev flags:
exit 0, `fix-strict-jev-repeat-tests.log`, 18 tests reviewed.
README review has no confident gaps:
exit 0, `fix-strict-jev-promises.log`, 73 titles.
Its one unsure reset line is already stated in README:
reset restores stock and clears service state, rules, and the call log.

The final gate chain after the test changes passed:
workspace build, check, 73 package tests, all workspace tests,
strict style census, prose, and all 16 validation lanes.
Each exited 0.
Logs use `fix-strict-final-` under `tools/flight-trial/.logs/`:
`build.log`, `check.log`, `test.log`, `workspace-test.log`,
`style.log`, `prose.log`, and `validate.log`.
The workspace command was:

```bash
./node_modules/.bin/vp run \
  --concurrency-limit 1 -r test
```

The second strict mutation lane scored 80.82 percent and exited 1.
Log: `fix-strict-mutate-second.log`.
Report: `fix-strict-mutation-second.json`.
It used the same lock, nine source files, and floor of 85.
There were 1,231 killed cases, 46 timeouts, 205 survivors,
98 without coverage, and no runner errors.

### Final review step and handoff

The user asked for a saved green step and an end to test growth.
The current code step is committed as `9ca8bb65`.
The real-clock README line is committed as `c1f323db`.
Both commits passed their hooks; no stash was used.

Internal graph calls now use `rawInput` so Core runs each input reader.
There are no `ctx: Operation.Ctx` annotations in the services.
Bad input still returns the named Duffel or Stripe wire error.
Pending payment key work lives in a resource map.
Its route call removes the key in `finally`, including a thrown route.
The parallel same-key and pipelined same-key HTTP tests pass.

Delay operations return the stopped reply when their wait ends on stop.
Dispatch skips call-log writes after stop.
Outgoing webhook sends also skip a late log write after stop.
This fixes a disposed-cell write that changed payment's stopped reply to 500.
The failing HTTP proof is `fix-strict-stop-red.log`, exit 1.
The passing full package proof is `fix-review-final-test.log`, exit 0.

The strict graph still has six plain functions.
`tools/flight-trial/services/PLAIN.md` lists their inputs and call sites.
Only the two service process entries call `createScope`.
There are no classes, testing imports, shared start helpers,
or old service wiring names.
Core feedback remains: shared unit with a slot.
The launcher HTTP proof starts four distinct processes,
drives each service and control API, and stops all four cleanly.

Each must-fix has its failing proof and a fresh passing proof:

- Route replacement and repeat: `fix-m1-red.log`, exit 1.
  Passing: `fix-review-final-m1-green.log`, exit 0, two tests.
- Completion after reset: `fix-m2-red.log`, exit 1.
  Passing: `fix-review-final-m2-green.log`, exit 0, one test.
- Real-time webhook signature: `fix-m3-red.log`, exit 1.
  Passing: `fix-review-final-m3-green.log`, exit 0, one test.

All logs below are under `tools/flight-trial/.logs/`.
Final code gates each exited 0:

- Workspace build: `fix-review-final-build.log`.
- Workspace check: `fix-review-final-check.log`.
  Zero errors; 28 workspace warnings.
- Package test: `fix-review-final-test.log`; all 81 passed.
- Workspace tests: `fix-review-final-workspace-test.log`; all nine tasks passed.
  The runner used `--concurrency-limit 1` before the task name.
- Strict style census: `fix-review-final-style.log`; every strict row is zero.
- Prose: `fix-review-final-prose.log`.
- Validation: `fix-review-final-validate.log`; all 16 lanes passed.
- Process HTTP proof: `fix-review-final-process.log`.
- Graph audit: `fix-review-final-graph.log`.
- TSDoc parser: `fix-review-final-tsdoc.log`; no S26 rows.

Jev preflight exited 0: `fix-review-final-jev-preflight.log`.
It has no file flags and eight flagged units.
They match the resource ownership and stop reasons listed above.
Test review exited 0: `fix-review-final-jev-tests.log`; no flags in 50 tests.
The first test and promise review targets were wrong and exited 1.
Their logs end in `jev-tests-path-error.log` and `jev-promises-path-error.log`.
The retries use the two test files and `../tools/flight-trial`.
README review logs use `fix-review-final-jev-promises`.
The real-clock promise gap was filled in `c1f323db`.
The `never` promise already says the intent stays processing until a manual send.
The form metadata promise now states that unsafe nested keys are skipped.
Final README review exited 0: `fix-review-final-jev-promises-complete.log`.
There are no confident gaps in 81 titles.
Its one unsure `never` title has the existing processing and manual-send promise.

The final full mutation lane ran alone under `/tmp/mutation.lock`.
It exited 1 at 82.79 percent; the floor remains 85.
Log: `fix-review-final-mutate.log`.
Report: `fix-review-final-mutation.json`.
Counts: `fix-review-final-mutation-summary.json`.
It includes all nine source files and all 1,586 cases.
There are 1,295 killed cases, 18 timeouts, 180 survivors,
93 without coverage, and no runner errors.
The two process entry files account for 56 cases without coverage.
Their HTTP launcher proof is outside the mutation test runner.
Supplier has 76 survivors, payment 63, shared HTTP 31, and data 10.
At this case count, 36 more cases must be caught to reach 85.
Nothing was excluded and no mutation setting was changed.
This floor gap remains for the lead; no further tests were added after `9ca8bb65`.

The first requested fetch and rebase completed with exit 0.
Its target was `c4615b40`; the branch reflog records that finish.
Proof: `fix-review-final-base.log`.
Main later gained only the two new authoring-rule doc commits.
The initial base remains an ancestor; current main is not yet an ancestor.
So landing also needs a rebase onto those new docs.

### Mutation lift: process entry lifecycle

The lead keeps the floor at 85 and authorizes the entry-function fallback.
Stryker's Vitest setup records coverage in its own process namespace.
It does not collect a child's coverage or pass its active case to that child.
The local runner and instrumenter source confirm both facts.

Impact: `src/index.ts` adds `supplierMain` and `paymentMain` exports.
Only their `main.ts` files create service scopes.
Each function takes plain environment settings and returns an exit code.
Supplier also takes the one supplier-name argument.
The guarded process calls keep the launcher and process proof callers unchanged.
`tests/entries.test.ts` is the new public entry caller.
This is the lead's explicit fallback and follows ADR 0078.
`PLAIN.md` records the two process entries apart from the six pure helpers.

One HTTP lifecycle test per service runs its real child on port zero,
then the same exported entry in process on a free port.
It waits for control HTTP, makes service calls, sends SIGTERM,
and checks exit zero and a closed port.
The in-process fixture emits the same Node SIGTERM event.
Supplier checks its configured hold deadline.
Payment checks the configured webhook URL, delay, and signing secret.
All child processes, probe ports, and webhook sockets belong to resources.
No global value is patched and no service state is read by a test.

Initial entry tests passed: exit 0, `lift-entry-test.log`.
The first check found formatting only: exit 1, `lift-entry-check.log`.
Logs remain under `tools/flight-trial/.logs/`.
The corrected check passed: exit 0, `lift-entry-check-green.log`.
The full package passed all 83 tests: exit 0, `lift-entry-full-test-green.log`.
TSDoc passed: exit 0, `lift-entry-tsdoc.log`.

The targeted entry diagnostic confirms that Stryker runs both new tests.
It caught 29 of 56 entry cases; only six lack coverage now.
Payment entry: 14 killed, 11 survivors, three without coverage.
Supplier entry: 15 killed, ten survivors, three without coverage.
There are no runner errors or timeouts.
The subset score is 51.79 and exit 1; this is not the full package gate.
Log: `lift-entry-mutate-fixed.log`; report: `lift-entry-mutation.json`.
The first CLI brace pattern was split at its comma and found no files.
That failed diagnostic is `lift-entry-mutate.log`, exit 1.
The retry uses `services/*/main.ts`.
No stored mutation setting changed.
The green entry step is committed as `af26d518`.

### Mutation lift: supplier promises and dead payment state

Supplier had the most surviving cases, at 76.
The HTTP proofs now require the offer request ID prefix,
the named missing-flight error, and the accepted stock-change reply.
Price-only changes preserve seats; seat-only changes preserve the price.
Two new tests cover supported passenger kinds and business hold expiry.
The latter also checks the default one-person search after a seat is taken.
The README states those existing wire promises.

Payment delivery state held a redundant `sent` flag.
Only confirmation and manual control add event IDs.
Both add each event beside its existing intent in one state write.
Reset clears both maps in one write.
The watch starts one timer for each new event ID.
So the completion operation needs only the event ID and a missing-event check.
Cancellation can remove the event while its timer waits; that check remains.
The intent-missing and already-sent checks have no live path.
Completed events now leave the pending map; the call log retains the send record.
The unused flag and its tests in the watch and cancellation filter are removed.
Impact is inside payment's producers, watch, wait, and completion operations.
No HTTP shape changes and no public caller reads that private state.

Workspace build: exit 0, `lift-seam-build.log`.
Workspace check: exit 0, `lift-seam-check.log`; zero errors and 28 warnings.
All 85 package tests passed: exit 0, `lift-seam-test.log`.
All workspace tests passed: exit 0, `lift-final-workspace-test.log`.
Strict style passed: exit 0, `lift-final-style.log`.
Prose passed: exit 0, `lift-final-prose.log`.
All 16 validation lanes passed: exit 0, `lift-final-validate.log`.
The four-process HTTP proof passed: exit 0, `lift-final-process.log`.
Jev test review passed: exit 0, `lift-final-jev-tests.log`; no flags in 28 tests.

### Landing review: quote lifetime and plain errors

Owner: Codex; branch `trial/flight-services`.
Next: keep valid quotes through many searches; remove error classes.
Verify: 200 HTTP searches keep the first quote bookable.
After its service-clock deadline, booking returns `offer_expired`.
Expired quote data is removed without keeping a growing ID list.
All landing gates and the locked mutation lane must pass.
The package floor stays at 85, with nothing excluded.
Fetch and rebase onto `origin/main` passed with exit 0.

### Mutation floor closed

Code commits: `af26d518` for the entry lifecycle tests,
and `522ccc9f` for supplier wire proofs and dead payment state removal.
The first full lane after those steps passed at 85.70 percent, exit 0.
It ran alone under `/tmp/mutation.lock` with the unchanged floor of 85.
All nine source files remain included; nothing is excluded.
No code or test changes followed the passing lane.

Log: `lift-final-mutate.log`.
Full report: `lift-final-mutation.json`.
Counts and file scores: `lift-final-mutation-summary.json`.
The 1,573 cases include 1,331 killed, 17 timeouts,
182 survivors, 43 without coverage, and zero runner errors.
Removing the dead payment state removed 13 cases from the code.
The entry tests catch 29 cases that previously had no coverage.
Twelve supplier survivors now show `Killed`, not timeout.
Their old and new IDs are in `lift-supplier-kill-proof.json`.

File scores:

- `services/http.ts`: 83.54 percent.
- `services/payment/index.ts`: 85.41 percent.
- `services/payment/main.ts`: 50.00 percent.
- `services/supplier/index.ts`: 86.63 percent.
- `services/supplier/main.ts`: 53.57 percent.
- `src/errors.ts`: 50.00 percent.
- `src/flights.ts`: 95.10 percent.
- `src/schema.ts`: 100.00 percent.
- `src/index.ts`: included; it has no mutation cases.

The breaking floor applies to the full package score.
No file score or remaining case was excluded to reach it.
All 85 tests and the workspace build, check, tests,
strict style census, prose, validation, and process proof passed.
Their exit codes and log paths are in `lift-final-gates.json`.

Final Jev preflight: exit 0, `lift-final-jev-preflight.log`.
Its eight flagged units use the same ownership and stop reasons above.
Final README review: exit 0, `lift-final-jev-promises.log`.
It has no confident gaps in 85 titles.
The two unsure titles have existing README promises:
`never` leaves the intent processing until a manual send,
and an expired business hold restores its own cabin for the default one adult.
Final TSDoc: exit 0, `lift-final-tsdoc.log`; no S26 rows.

### Landing step: quote lifetime

Offers carry `expires_at`, 30 minutes from the service clock.
No unexpired quote is removed to make room for another search.
At 65,536 live quotes, new searches return a Duffel-shaped HTTP 429.
Each opaque quote ID keeps its deadline after its stored data is dropped.
Booking or reading a dropped expired quote returns `offer_expired`.
The existing expiry operation removes expired quotes before the next call.
It copies the offer map only when it removes a quote.
The two HTTP proofs cover early booking after 200 searches
and equal state size across two expired batches of 200 searches.
The regression failed with HTTP 404 before the fix.
Red: `land-offer-red.log`, exit 1.
Green: `land-offer-green-fixed.log`, exit 0; 86 tests.
Build, check, and prose passed with exit 0.
Logs: `land-offer-build.log`, `land-offer-check-fixed.log`,
and `land-offer-prose.log`, under `tools/flight-trial/.logs/`.

### Landing step: plain error values

Both registry classes are replaced by plain `Error` values.
Each carries a `kind` and the same typed payload as before.
The package `isError` guard narrows by `kind`.
Callers remain the fixture reader, both HTTP listeners,
and the public data failure test.
No class remains in the service code or error registry.
Build, check, and all 86 tests passed with exit 0.
Logs: `land-errors-build.log`, `land-errors-check.log`,
and `land-errors-test.log`, under `tools/flight-trial/.logs/`.

### Landing step: one deadline check at the HTTP boundary

The first full landing mutation run scored 84.17 percent, exit 1.
It included all nine source files and all 1,605 mutants.
Counts: 1,339 killed, 12 timed out, 209 survived, 45 uncovered.
Logs and full report: `land-mutate-first.log`, `land-mutation-first.json`.
The floor of 85 and the source list are unchanged.

Every service or control action already checks quote and hold deadlines
before reading or editing state.
The separate hold wait operation and watcher repeated that check.
They had no further HTTP behavior to prove; both are removed.
No timer or watcher is moved outside a resource.
Payment keeps its resource-owned timers and watcher for outgoing webhooks.
The supplier's only expiry work stays in its data-writing operation.
The existing late grader seat-edit test still passes.

The quote test now keeps a newer valid batch while deleting an expired one.
It books a retained quote after that cleanup.
Both expired lookup and missing lookup checks assert the exact wire errors.
No new test title is added; all 86 tests pass.
Build and check pass too.
Logs: `land-cleanup-build.log`, `land-cleanup-check.log`,
and `land-cleanup-test.log`, each exit 0.
All logs are under `tools/flight-trial/.logs/`.

### Landing proof: 85.76 percent

Commits: `04dc483e` quote lifetime; `b887586d` plain errors;
`af3fedf4` one deadline check at the HTTP boundary.
The ready commit `d81d6cda` became `0c84b012` after the clean rebase.
Fetch and rebase exited 0; install exited 0.

The final package mutation lane passed at 85.76 percent, exit 0.
It ran alone under `/tmp/mutation.lock`.
All nine source files stayed included; the floor remains 85.
There are no exclusions or threshold changes.
All 1,573 mutants completed: 1,330 killed, 19 timed out,
179 survived, 45 uncovered, zero errors.
No code or test changes followed that passing run.

The redundant supplier wait and watcher contained 31 mutants:
11 killed, one timed out, and 19 survived in the first landing run.
Their removal keeps expiry at the same HTTP state boundary.
The stronger HTTP checks killed four real survivors:
expired cleanup losing a newer quote, expired lookup losing its error code,
and missing offer or order lookup losing its error code.
Proof: `land-dead-hold-mutants.json`, `land-quote-kill-proof.json`.

Final file scores:

- `services/http.ts`: 80.38 percent.
- `services/payment/index.ts`: 86.12 percent.
- `services/payment/main.ts`: 50.00 percent.
- `services/supplier/index.ts`: 87.48 percent.
- `services/supplier/main.ts`: 53.57 percent.
- `src/errors.ts`: 41.18 percent.
- `src/flights.ts`: 95.10 percent.
- `src/schema.ts`: 100.00 percent.
- `src/index.ts`: included, exports only, zero mutants.

Each final gate exited 0:
build, check, all 86 flight-trial tests, four-process HTTP proof,
strict style census, prose, all 16 validation lanes,
TSDoc, graph audit, and the full package mutation lane.
Logs: `land-final-build.log`, `land-final-check.log`,
`land-final-test.log`, `land-final-process.log`,
`land-final-style.log`, `land-final-prose.log`,
`land-final-validate.log`, `land-final-tsdoc.log`,
`land-final-graph.log`, and `land-final-mutate.log`.
The check has zero errors and the same 28 workspace warnings.
No class remains in the services or error registry.
Operation inputs stay inferred; the pure helper list stays at six.

Jev checks exited 0.
Test review has zero flags across 27 supplier tests.
README review has zero confident gaps across all 86 test titles.
The two unsure titles are already promised by the README:
no automatic webhook in never mode, and release of an expired business hold.
Preflight has zero file flags and two flagged units.
The pay operation returns promised Duffel wire refusals;
it does not signal a failed Core operation for those replies.
The listener resource defers its own close after listening;
the native signal and HTTP stop tests prove socket closure.
Those three false labels are saved with the earlier watcher label
in `land-jev-labels.jsonl`; the shared case file is untouched.
Logs: `land-final-jev-preflight.log`, `land-final-jev-tests.log`,
and `land-final-jev-promises.log`.

The full report and gate index are saved as
`land-final-mutation.json`, `land-final-mutation-summary.json`,
and `land-final-gates.json` under `tools/flight-trial/.logs/`.
The red offer regression and green full suite are retained in
`land-offer-red.log` (exit 1) and `land-final-test.log` (exit 0).

### Services routing: start

Owner: Sol writer; branch `trial/services-routing`.
Base: `92b8937f`.
Next: move routes to Hono and keep the HTTP replies fixed.
Verify: build, check, tests, process proof, prose, strict style,
plain forms, and full mutation at 85 or more.
The board card already exists and stays with the lead.

Assumptions:

- Route rule names are plain keys, not operation choices.
  Operations may read a rule by its name.
  Only Hono chooses the operation for a request.
- Keep the bracket-key form reader in small Hono middleware.
  Hono dot keys differ from the fixed Stripe-style bracket keys.
- Shared middleware may run its one operation before and after `next()`.
  This records pending calls and saves replies without dispatch.
- Use the versions already locked for the Start scaffold:
  Hono 4.13.8 and its Node adapter 1.19.17.
- Keep six pure helpers and two process entries.
  No public Core symbol changes, so no SCIP impact block is needed.
- Store ticket-local Jev labels under this track.
  The shared case file is outside the allowed paths.

### Services routing: Hono owns routes

Removed both dispatch, action, lookup, control, and route trees.
Removed the whole-request schema and body decoding operation.
Hono handlers read body values or one ID and run one operation.
The payment key middleware reads its header and keeps its reply.
The extension gives middleware the existing service scope.
The shared resource owns the Node adapter and closes its port.
No scope is made outside the two process entries.

The pure helper list is still six, before and after:

- `reply`, `reject`, and `rejectPayment`.
- Supplier `readCurrent` and `createState`.
- Payment `createState`.

`rejectPayment` moved to `http.ts` for shared fault replies.
The two `main` process entries stay separate from the pure list.
No tests changed.

Assumptions and fixed wire details:

- A native `Response` carries the operation's body, status, and headers.
  It accepts a number without a cast to Hono's status type.
- Keep chunked replies and the exact JSON content type.
  The unchanged pipelined HTTP test checks that framing.
- Disable the adapter's global Request and Response changes.
  The resource serves its own app without changing process globals.
- Close the listener after accepted responses finish.
  Killing its sockets early lost the promised stopped reply.
- Hono's automatic HEAD-to-GET fallback is disabled for these routes.
  The old services returned a missing-route reply for HEAD.
- Unknown payment control paths keep the common Duffel error shape.
- Use Hono path patterns that require the final prefix slash.
  A wildcard also matched `/control`, which the old token guard did not.
  `/control/:rest{.*}` keeps the old control boundary.

Step proof, under `tools/flight-trial/.logs/`:

- Setup install, build, and prose: exit 0.
  Logs: `routing-install.log`, `routing-setup-build.log`,
  and `routing-setup-prose.log`.
- Build, check, all 86 unchanged tests, and strict style: exit 0.
  Logs: `routing-green-build.log`, `routing-green-check.log`,
  `routing-green-test.log`, and `routing-green-style.log`.
- Check: zero errors and the same 28 warnings as the saved base proof.
- Early framing and stop failures are in `routing-code-test.log`.
  The stopped reply then returned 500 in `routing-fix-test.log`.
  Both logs exit 1; the unchanged tests pass after the fixes.

### Services routing: keep the route field at the wire boundary

Review found that an extra `name` body field could replace `route`.
The first handler spread fields after the renamed value.
Put the wire route last so an extra field cannot replace it.
A missing route still returns HTTP 400 `invalid_route_rule`.
One new HTTP test checks that reply through both service apps.
The original 86 tests remain unchanged.

Red proof: `routing-rule-name-red.log`, exit 1.
The old handler returned 200 where the wire contract requires 400.
The first mutation run was stopped after this review finding.
Its exit is 130; log: `routing-mutate-first.log`.
It is not a score proof for the final code.
The final lane will run all source files again under the lock.

### Services routing: final checks before mutation

Source commits: `94945b46`, `e25ff31f`, and `f0df08f8`.
All gates in `routing-gates.json` have observed exit 0.
The full chain rebuilt the workspace before check and tests.
All 87 package tests and all workspace test tasks passed.
Check has zero errors and 28 warnings.
The four-process proof answered both APIs and stopped all children.
Strict style, TSDoc, routing audit, graph audit, and prose passed.
All 16 validation lanes passed.

Jev source review exited 0.
Each flag has a reason in `routing-jev-labels.jsonl`.
The source judges found resource state and stop paths to review.
The resource owns live clock waits, pending keys, and listener closure.
The stop operation checks its signal after waits.
The stopped HTTP test proves its promised reply reaches the caller.
Private module exports connect the services, not the package API.
Expected Duffel refusals remain returned HTTP replies.

Jev new-test review found no flags.
README review found no confident gaps among 87 titles.
Its four unsure titles already follow the saved README:

- Never mode waits for manual webhook control.
- Bad route changes are rejected; the wire field is `route`.
- The listed passenger kinds are supported.
- An expired business hold frees its cabin for the default adult.

The label tool writes only its fixed shared bank path.
Assumption: copy it to an ignored log path and change only that destination.
Its parser, state, label IDs, and arguments remain the tool's own.
This keeps the allowed paths fixed and gives the lead labels to merge.
No shared Jev file changed.
Core feedback: none.
The full locked mutation lane is still running.

### Services routing: stop Hono's HEAD fallback

Hono sends HEAD through its GET matcher before looking at routes.
An explicit HEAD route does not stop that fallback.
Shared middleware now checks the native method and returns the old 404.
Service route rules still run before that reply.
The two unused HEAD route rows are removed.

The new HEAD HTTP test failed with 200 instead of 404.
Red log: `routing-head-red.log`, exit 1.
It checks both services through their public control API.
The original 86 tests remain unchanged.
The second mutation run was stopped for this wire fix, exit 130.
Its log is `routing-mutate-second.log`.
The final mutation run will include every source file again.

HEAD fix proof, under `tools/flight-trial/.logs/`:

- First check found that Hono's missing-route reply may be a promise.
  Await that reply before assigning it to the response.
  Log: `routing-head-check.log`, exit 1.
- Build, check, and all 88 tests then passed, exit 0.
  Logs: `routing-head-green-build.log`,
  `routing-head-green-check.log`, and `routing-head-green-test.log`.
- Both new tests have red proof before their wire fix.
  Every original test is unchanged.

### Services routing: saved for lead review

Source commits:

- `94945b46`: Hono and Node adapter from the workspace catalog.
- `e25ff31f`: Hono routes, shared middleware, owned listener.
- `f0df08f8`: wire route names cannot be replaced by an extra body field.
- `896fd848`: shared middleware preserves the old HEAD 404 reply.

Every final gate has observed exit 0.
The full list and each exact log path are in `routing-gates.json`.
The workspace build ran before check and all tests.
All 88 package tests passed; the original 86 remain unchanged.
Both new wire regression tests have red proof before their fix.
Check has zero errors and 28 warnings.
Workspace tests, four-process proof, strict style, TSDoc, routing audit,
graph audit, prose, and all 16 validation lanes passed.
Jev source, new-test, README, and label checks all exited 0.
The two new tests have no Jev test flags.
README review has zero confident gaps among 88 titles.
Its three unsure titles have the existing README promises noted above.
Every source flag is answered in `routing-jev-labels.jsonl`.

Full mutation passed at 88.46 percent, exit 0.
It ran alone under `/tmp/mutation.lock`.
All nine source files were included; the floor stayed at 85.
No file, mutant, or new source was excluded.
The report contains 1508 mutants.
Counts: 1284 Killed, 35 NoCoverage, 139 Survived, 50 Timeout.
The two earlier interrupted runs have exit 130 and are not score proof.
No code or test changes followed the passing run.

Final mutation proof, under `tools/flight-trial/.logs/`:

- `routing-final-mutate.log`.
- `routing-final-mutation.json`: the full report.
- `routing-final-mutation-summary.json`: counts by file.

The plain list is six before and after:
`reply`, `reject`, `readCurrent`, both `createState` functions,
and `rejectPayment`.
Only `rejectPayment` moved, from payment to shared HTTP code.
Both `main` entries remain separate from that pure list.
`PLAIN.md` and the routing audit record their paths and call sites.

Core feedback: none.
No changes to Core, apps, or `tools/writer-trial/`.
No push; the branch waits for the lead's review.
The board card stays with the lead because it is outside the allowed paths.

### Services routing: lead fix round

The lead asked for eight fixes before review.
Shared middleware and the three common control routes now register once.
The token check runs before body decoding and rule waits.
Body decoding is again an operation.

Assumption: keep the public app extensions and all old test callers.
Each service borrows its start event for the shared HTTP start hook.
Core has no nested extension list on an extension.
No helper takes a scope or creates one.

Assumption: bind the error shape in one service session.
The root owns that session and closes it on the same stop signal.
The listener and payment watcher use that session's state and tags.
This keeps the old public test setup and the six plain functions.

All eight fixes now have their own commits.
The retry test first failed with a saved 500, exit 1.
Log: `tools/flight-trial/.logs/review-3-red.log`.
The remaining wire tests first found seven failures, exit 1.
Log: `tools/flight-trial/.logs/review-4-red.log`.

All 95 package tests now pass, exit 0.
The original 86 tests are unchanged.
Log: `tools/flight-trial/.logs/review-4-test.log`.
Build and check passed before those tests.
Check has zero errors and the same 28 warnings.
Strict style and TSDoc passed, exit 0.
Logs: `review-style.log` and `review-tsdoc.log` in the same folder.

The body decoder keeps the old JSON and form rules.
A rule starts by waiting and selecting; a separate operation saves its reply.
No start operation accepts a response to switch its job.
The extra old save-forwarding step is gone.
A handler throw cannot save a rule reply or a payment reply.
Its log entry stays at status zero.

The listener owns its pending response promises.
It waits for their finish or close events, then closes all connections.
An unfinished body is destroyed on stop so it cannot hold shutdown open.
This keeps the old delayed-call 503 reply and the forced socket cleanup.

Assumption: use a real missing Core driver to test a handler throw.
The test extension runs an operation with an unbound required tag.
Core raises its managed error; Hono makes the wire reply.
No service cells, service operations, HTTP code, or globals are patched.

Jev accepted all nine routing test titles, exit 0.
All ten source flags have a label and a reason in `routing-jev-labels.jsonl`.
The source review, test review, README review, and label commands exited 0.

README review found seven gaps for the new wire tests.
The lead's fixed wire contract promises each of these cases:

- A thrown payment handler lets the same key retry.
- An empty offer ID keeps the `offer_not_found` reply.
- A deep offer path keeps the `offer_not_found` reply.
- Call logs keep percent encoded paths.
- Route rules keep percent encoded keys.
- A thrown handler leaves the call log status at zero.
- A thrown handler cannot seed a route replay.

These are bug checks for the lead's brief, not new product features.
The package README is outside the allowed paths and stays unchanged.
The README checker has no label judge in `tools/jev/bank.mjs`.
Its seven flags are answered here.

A Start plain-checker probe exited 1.
Log: `tools/flight-trial/.logs/review-final-plain.log`.
It assumes Start entry names, bans this trial's pure data initial values,
requires literal `From` and `why` words in param docs,
and counts a resource's wake callback as a plain function.
It cannot run unchanged on the flight service layout.
The routing audit checks this brief's rules with the TypeScript parser instead.
It passed at six plain functions, with every helper's params and callers checked.
Log: `tools/flight-trial/.logs/review-final-routing-audit.log`.
The Start checker and all shared check scripts are unchanged.

Core feedback: extension config has no nested extension list.
This shape has an unknown `extensions` field:

```ts
extension({
  label: "supplier",
  extensions: httpRequests,
});
```

The service start hook borrows its owned event for the shared start hook.
The shared hook owns the one HTTP stack and the common control routes.
No extra scope helper is needed.

### Services routing: control expiry fix

Owner: Codex writer; branch `trial/services-routing`.
Starting head: `e55ddac2`.
Next: prove the clock rewind bug through HTTP, then fix route order.
Verify: red test exit 1, green test exit 0, build, check,
all flight tests, four-process proof, prose, and strict style.
The lead owns mutation and the board card.

Red proof on unchanged `e55ddac2` service code: exit 1.
Log: `tools/flight-trial/.logs/expiry-red.log`.
The rewind returns 200; the test requires 404 `offer_not_found`.
The workspace build passed first, exit 0.
Log: `tools/flight-trial/.logs/expiry-base-build.log`.

The shared HTTP hook now registers only the middleware stack.
A shared resource registers the three common control routes.
The supplier resolves it after adding its deadline middleware.
Payment resolves it at the same point as before.
No plain function was added; the count stays six.
Both services explain why their ID reads keep the raw path.
`PLAIN.md` again promises a deadline check on each HTTP call.

Green rewind proof: exit 0, `expiry-green.log`.
All 96 package tests pass, exit 0, `expiry-tests.log`.
Build, check, four-process proof, prose, strict style, and TSDoc pass.
Check prints zero errors and the same 28 warnings.
All logs are under `tools/flight-trial/.logs/`.
Mutation was not run; the lead runs it.

Final proof for source commit `c0075622` is in `routing-gates.json`.
That file keeps the prior gate run under `previousGateRun`.
Workspace tests pass, exit 0, `expiry-workspace-tests.log`.
All 16 validation lanes pass, exit 0, `expiry-validate.log`.
No source or test changed after these checks.

Jev preflight, test review, README review, and labels all exit 0.
The new control-route resource and all ten routing tests have no flags.
The ten source labels are false, with reasons in the track's label bank.
Nine match saved cases without changes.
The added `startIntentKey` case owns no separate stop path:
the HTTP listener drains accepted calls, and payment middleware
resolves each pending key in `finally`, including a thrown handler.
The label tool copy changes only its bank path and local imports,
as in the earlier fix round; shared Jev files stay unchanged.
The seven README gaps are the same wire cases answered above.
The new rewind test matches the README's control-call expiry promise.

Next: lead review and mutation.
Core feedback: none from this fix.

## trial/flight-rounds

Writer: Codex.
Branch: `trial/flight-rounds`.
Base: `0f0a83fe`.
The board stays with the lead; it is outside this writer's paths.
Next: lead review of the fix proof, then wire the writer image.
Verify: reference passes twice; a wrong answer fails by name.

### Round 1 reference

The answer copies the Start scaffold and adds public flight search.
The teacher uses only the page and the HTTP services.
Reference logs are in `tools/flight-trial/reference/.logs/`.

- Round 1 pass 1: exit 0, `r1-pass-1.log`.
- Round 1 pass 2: exit 0, `r1-pass-2.log`.
- Planted wrong price: exit 1, `r1-break.log`.
- Proof driver: exit 0, `/tmp/flight-rounds-r1-proof.log`.
- Workspace build: exit 0, `/tmp/flight-rounds-r1-build.log`.
- Reference build: exit 0, `/tmp/flight-rounds-reference-r1-build.log`.
- Check: exit 0, `/tmp/flight-rounds-r1-check.log`.
  Zero errors and 29 warnings; none from this work.
- Prose: exit 0, `/tmp/flight-rounds-r1-prose.log`.

Assumptions:

- Search shows economy saver fares for one adult.
- Shared flight IDs merge across suppliers.
- The service supplies the full UTC times shown on the page.
- Reference proof can use its own copy of the scaffold.
- Root declaration builds need the browser's DOM type declarations.
  The reference has a compiler directive for those types.
- The scaffold dependencies are linked into this private reference.
- A separate cache folder avoids shared Vite cache writes.
- Flight controls can return the known `scenario_failed` reset error.
  State was written before that error; logs and rules were not reset.
  Checks clear used rules and count from a saved log position.
  Other control errors still fail.

The reference uses ClientOnly for its new page.
This shows the controls after the browser can handle their clicks.
No scaffold file was changed for this.

### Rounds 1 and 2 ready

Packets 1 and 2 are final at this step.
The reference now searches all three suppliers at once.
Each reply updates the page before slower replies finish.
Shared flights keep the cheapest offer.
A new search aborts the old browser request and ignores its late replies.

Proof logs in `tools/flight-trial/reference/.logs/`:

- Round 2 pass 1: exit 0, `r2-pass-1.log`; six checks pass.
- Round 2 pass 2: exit 0, `r2-pass-2.log`; six checks pass.
- Planted duplicate rows: exit 1, `r2-break.log`.
  The cheaper late fare check fails with duplicate flight rows.
- Proof driver: exit 0, `/tmp/flight-rounds-r2-proof.log`.
- Reference build: exit 0, `/tmp/flight-rounds-reference-r2-build.log`.
- Check: exit 0, `/tmp/flight-rounds-r2-check.log`; 29 warnings.
- Prose: exit 0, `/tmp/flight-rounds-r2-prose.log`.
- Style census: exit 0, `/tmp/flight-rounds-r2-style.log`.
  It checks authored folders and skips the generated route tree.

The first full workspace test run had two supplier test timeouts.
Log: `/tmp/flight-rounds-r2-workspace-tests.log`, exit 1.
The build after it passed, so the shell's last exit was 0.
That does not make the earlier test run green.
A fresh full workspace test run follows without other heavy checks.
The final report will include its exit code.

Next: round 3 holds.
Verify: two browser users race; exactly one supplier hold succeeds.

### Round 3 handoff repair

Owner: Codex, resumed writer.
Next: rebase onto the service wire fixes, then prove round 3.
Verify: two passes and a named planted failure.
The inherited empty-search bug is fixed.
The reference keeps Node's built-in Response objects.
Hono's default replacement makes `Response.json()` fail TanStack's check.
The supplier contract uses nested `payment_status` fields.
Packets 1 and 2 are unchanged.

Assumptions:

- The board stays with the lead, outside this writer's paths.
- Existing proof containers belong to this flight proof.
- A local Docker exec relay reaches them after the workspace rebuild.
- The relay changes no host or Docker settings.
- The reference's HTTP serve adapter may keep native web objects.
- Hold expiry means no awaiting payment and no paid time.

Proof:

- Workspace build: exit 0, `/tmp/flight-rounds-takeover-build.log`.
- Shape check: exit 0, `/tmp/flight-rounds-r3-shapes-check.log`.
- Style census: exit 0, `/tmp/flight-rounds-r3-style.log`.
- Old round 3 proof: exit 1, `/tmp/flight-rounds-r3-proof.log`.
  Empty search passes; the old HTTP adapter still broke hold replies.

### Round 3 live-write repair

The seat watcher now writes into the page's own scope.
Passing a call signal had opened a child session with private data writes.
The call now borrows its stop signal as input instead.
The seat API already returned zero; the old page still showed one.
The same race check now passes.
Supplier calls also consume JSON before their operation ends.
Their callers receive an owned plain reply, with no live response body.
The copied checks needed the missing `components.json` file.

Proof:

- Round 3 pass 1: exit 0, reference `.logs/r3-pass-1.log`.
- Round 3 pass 2: exit 0, reference `.logs/r3-pass-2.log`.
- Removed price check: exit 1, reference `.logs/r3-break.log`.
- Proof driver: exit 0, `/tmp/flight-rounds-r3-proof.log`.
- Watch check: exit 0, `/tmp/flight-rounds-r3-watch-check.log`.
- Scaffold seams: exit 0, `/tmp/flight-rounds-r3-seam.log`.
- Browser import guard: exit 0, `/tmp/flight-rounds-r3-boundary.log`.
- Schema check: exit 0, `/tmp/flight-rounds-r3-schema.log`.

The earlier round 3 proof log path now holds the passing rerun.
The failed attempts are described above; they did not count as ready.

### Round 3 ready

Packet 3 is frozen at this ready step.
Next: round 4 payments.
The branch includes service fixes through `d934d2b1`.
The first rebase stopped on this progress file with exit 1.
Both writers' notes were kept; its continuation exited 0.
Later rebases also exited 0.
No stash was used.
Packets 1 and 2 match `610144d0` byte for byte.

Final round 3 proof:

- Driver: exit 0, `/tmp/flight-rounds-r3-final-proof.log`.
- Reference pass 1: exit 0, `.logs/r3-pass-1.log`; nine checks pass.
- Reference pass 2: exit 0, `.logs/r3-pass-2.log`; nine checks pass.
- Missing price check: exit 1, `.logs/r3-break.log`.
  Only the named stale-price check fails; the seat race passes.
- Good, broken, and restored builds: exit 0.
  Logs: `.logs/r3-build-good.log`, `.logs/r3-build-break.log`,
  and `.logs/r3-build-restored.log`.
- Workspace build: exit 0, `/tmp/flight-rounds-r3-ready-build.log`.
- Check: exit 0, `/tmp/flight-rounds-r3-ready-check.log`.
- Style: exit 0, `/tmp/flight-rounds-r3-ready-style.log`.

Reference logs above are under `tools/flight-trial/reference/`.
The full workspace tests and validate follow the last round.

### Round 4 ready

Packet 4 is frozen at this ready step.
Next: round 5 confirmation mail.
Payments save their intent before confirmation can send a webhook.
Repeated requests reuse the saved execution and take no extra payment calls.
Only signed webhooks choose the final booking state.
A private stream lock orders webhook effects and tab updates.
An expired hold refunds in full, once.

Proof:

- Reference pass 1: exit 0, `.logs/r4-pass-1.log`; 13 checks pass.
- Reference pass 2: exit 0, `.logs/r4-pass-2.log`; 13 checks pass.
- Bypassed signature check: exit 1, `.logs/r4-break.log`.
  Only the forged-event check fails.
- Driver: exit 0, `/tmp/flight-rounds-r4-proof.log`.
- Good, broken, restored builds: exit 0, `.logs/r4-build-good.log`,
  `.logs/r4-build-break.log`, and `.logs/r4-build-restored.log`.
- Reference step build: exit 0, `/tmp/flight-rounds-r4-build-step.log`.
- Fixed check: exit 0, `/tmp/flight-rounds-r4-check-fixed.log`.
- Schema: exit 0, `/tmp/flight-rounds-r4-schema.log`.
- Style: exit 0, `/tmp/flight-rounds-r4-style.log`.
- Prose: exit 0, `/tmp/flight-rounds-r4-prose.log`.

Reference logs above are under `tools/flight-trial/reference/`.
The first check found one excess branch, exit 1.
Log: `/tmp/flight-rounds-r4-check-step.log`.
Filtering the saved booking by owner removed that branch.

Assumptions:

- Price strings are exact USD amounts; charge and refund use cents.
- This service sends one signature and two payment event kinds.
- Signatures allow at most five minutes of clock difference.
- A failed payment leaves its hold until expiry.
  The traveler can search and hold again to try another payment.
- The service has no automatic webhook retries.
  Grader controls send the repeated and late events.
- Private HTTP pay requests use a booking ID and an execution UUID.
- Safe repeat proof covers concurrent requests in this one app process.
  The trial does not test a crash between saved intent and confirmation.

### Round 5 mail proof and late strict rules

Round 5 sends one real SMTP confirmation after the signed payment result.
A failed send saves a partial result and keeps the booking Confirmed.
Retry shares the saved execution and updates the same private stream.
A second tab and reload keep the mail state.
Anonymous retry returns 401; another traveler gets 403.
A refunded payment sends no mail.

The first proof passed 16/16 twice, each exit 0.
The planted mail break failed only the failed-mail case, exit 1.
The driver and all three reference builds exited 0.
Logs: `/tmp/flight-rounds-r5-proof.log` and reference
`.logs/r5-pass-1.log`, `r5-pass-2.log`, `r5-break.log`,
`r5-build-good.log`, `r5-build-break.log`, `r5-build-restored.log`.
Schema and style checks exited 0 in
`/tmp/flight-rounds-r5-schema.log` and
`/tmp/flight-rounds-r5-style.log`.
Prose exited 0 in `/tmp/flight-rounds-r5-prose-step.log`.

The lead's late note adds ADR 0099 and 0100 to this reference.
Packets 1–3 remain frozen.
The note permits adding the scaffold check requirement to packets 4–5.
Signature verification now owns its secret and clock in an operation.
Supplier payment and refund choice are an operation.
The one-caller merge, event reader, and mail text helpers were inlined.
The remaining price comparator has two callers and per-param TSDoc.
The scaffold strict writer has not committed its check yet.
The new check and server entry update are the next step before round 5 ready.

The workspace build exited 0 in `/tmp/flight-rounds-final-build.log`.
The first full test run exited 1 in `/tmp/flight-rounds-final-tests.log`:
services' many-search bound test reached its five-second timeout.
It ran beside the browser proof; rerun without that browser job.
The first validate exited 1 in `/tmp/flight-rounds-final-validate.log`.
Its only red lane was format: it ran while the planted break was present.
The restored source must pass before the final gate.

Mail proof assumptions:

- Sent means SMTP accepted the mail, not that the traveler read it.
- Mailpit needs Chaos enabled at startup to prove a real SMTP failure.
  [Mailpit documents the startup flag](https://mailpit.axllent.org/docs/integration/chaos/).
- The existing Mailpit had Chaos disabled.
  This proof starts its own temporary container from the same local image.
  It changes no Docker config and stops only that owned container.
- The local relay can choose this mail host through `FLIGHT_PROOF_MAIL_HOST`.
  App SMTP stays on the same local port; teacher uses `MAILPIT_URL`.
- The teacher clears its sender fault after every failure case.
  Mailpit's control and inbox URLs have no auth in this local proof.
- Saved execution rows prevent repeated finished sends.
  The resource shares only unfinished sends in one process.
  This proof makes no crash claim between SMTP acceptance and the DB save.
- The first send and retry use the saved account email and flight values.
  No account verification or scaffold auth rule was changed.

### Gates after the strict services rebase

Rebase onto `bc4a00e5` exited 0.
Log: `/tmp/flight-rounds-rebase-strict-services.log`.
Install and workspace build exited 0:
`/tmp/flight-rounds-install-strict-services.log`,
`/tmp/flight-rounds-build-strict-services.log`.
Services alone passed 72 tests, exit 0:
`/tmp/flight-rounds-services-tests-solo.log`.
Full parallel tests still hit the same services timeout, exit 1:
`/tmp/flight-rounds-final-tests-retry.log`,
`/tmp/flight-rounds-final-tests-services-rebase.log`.
The same full task set passed with one task at a time, exit 0:
`/tmp/flight-rounds-final-tests-serial-fixed.log`.
Command: `vp run --concurrency-limit 1 -r test`.
An earlier command put the option after `test`.
Vitest rejected it, exit 1: `/tmp/flight-rounds-final-tests-serial.log`.
This is a task runner option and belongs before the task name.
No test timeout or source file was changed.

Restored validate passed all 16 lanes, exit 0:
`/tmp/flight-rounds-final-validate-restored.log`.
Reference typecheck exited 0:
`/tmp/flight-rounds-reference-typecheck.log`.
The first typecheck command used a missing root binary, exit 127.
The successful command uses the reference's linked binary.
TSDoc check read 62 authored files with zero rows, exit 0:
`/tmp/flight-rounds-final-tsdoc.log`.
Seam proof and browser boundary checks exited 0:
`/tmp/flight-rounds-final-seam.log`,
`/tmp/flight-rounds-final-boundary.log`.
Packets 1–2 and packet 3 byte checks exited 0:
`/tmp/flight-rounds-frozen-12.log`,
`/tmp/flight-rounds-frozen-3.log`.
The only packet 4 change is the lead-approved check line:
`/tmp/flight-rounds-packet4-approved-addition.log`.
Forbidden source directories equal the services base, exit 0:
`/tmp/flight-rounds-scope-proof.log`.

### Jev answers before the strict scaffold copy

`main..HEAD` preflight exited 0:
`/tmp/flight-rounds-jev-preflight.log`.
It lists 3 file flags and 46 unit flags across inherited and authored code.
No package tests were changed, so package test and promise judges do not apply.
Teacher checks are public HTTP and browser checks in `.mjs` files.
Label reasons stay here because `tools/jev/` is outside this ticket's paths.
The lead may place these answers in the label bank.

- `memoKeyIgnoresInput`, old server entry: false for the fixed single process config.
  The stricter server entry will replace the module getter when the scaffold lands.
- `configNotTag`, feature flights and payment: false.
  Supplier URLs and payment secret are required tags.
  Relative app routes, Duffel paths, currency, cabin, and fare rules are fixed contracts.
- `stopOnlyInDefer`, hold/state/seat operations: false.
  These operations start no work that lives after the call.
  Supplier fetch reads `ctx.signal`; the native DB call is awaited.
- `effectWithoutDefer`, seat and hold watchers: false.
  A resource starts each operation and stops and waits in its deferred cleanup.
  The watcher also reads root, tab, call, and borrowed stop signals.
- `stopOnlyInDefer`, watcher and search resources: false.
  The watcher reads all four signals; search reads call and stop signals.
  Deferred stop releases the retained cancel handle.
- `effectWithoutDefer`, search operation: false.
  It consumes the body before returning and its graph tracks the run.
  The retained stop handle belongs to a resource.
- DB, auth, mail, notification, and sync flags repeat the copied scaffold flags.
  Pool and SMTP cleanup are deferred; URLs and secrets are tags.
  Protocol cursors, revision counters, and keyed pending sends are private bookkeeping.
  Profile retry's typed execution guard is part of the scaffold contract.
  The strict scaffold copy and its checks will decide the entry and body ownership forms.
- Service flags are outside this ticket's source paths.
  The strict services commits already replaced its plain service helpers.
  The old `S21` wall-time line is also in that earlier services version.
- The noisy `~wrapsCallersStep` and the `ℹ` notes owe no labels.

### Core feedback from the hold repair

A call signal makes a child session, so this root-write assertion fails:

```ts
const value = data({ initial: 0 });
const change = operation({
  depends: { value: value.controller },
  run({ value }) {
    value.set(1);
  },
});
const root = createScope();
await root.run(change, {
  signal: new AbortController().signal,
});
const saved = root.resolve(value);
await root.close({ graceful: true });
assert.equal(saved, 1);
```

The failed assertion prints actual 0 and expected 1, exit 1:
`/tmp/flight-rounds-core-signal-probe.log`.
Borrowing the stop signal through operation input keeps the write in the root.
That public Core probe prints 1 and exits 0:
`/tmp/flight-rounds-core-input-probe.log`.
The live seat and hold watchers use that borrowed input.
The first draft read the root after close and failed with Disposed instead.
The corrected probe captures the value before closing, then checks it.
No Core or React source was changed.

### Search body ownership under ADR 0100

The search response body and stop handle now belong to a request resource.
Its opening operation borrows the parsed query and supplier settings.
Only the background search call binds the supplier tag.
Binding a tag on the opening call made a shorter child session.
That first attempt closed the body too soon and failed all six browser cases.
Driver exit 1: `/tmp/flight-rounds-stream-resource-proof-first.log`.
Teacher detail: `/tmp/flight-rounds-stream-resource-first-pass.log`.
The corrected request owner passed 6/6 twice, each exit 0.
The planted duplicate-row break failed its named case, exit 1.
Driver and good, broken, restored builds exited 0:
`/tmp/flight-rounds-stream-resource-proof.log`,
reference `.logs/r2-build-good.log`, `r2-build-break.log`, `r2-build-restored.log`.
Teacher logs: reference `.logs/r2-pass-1.log`, `r2-pass-2.log`, `r2-break.log`.
Check exited 0: `/tmp/flight-rounds-stream-resource-check-fixed.log`.
This changes the reference's ownership form, not frozen packets 1–3.

The strict check draft was read in the other worktree without editing it.
Its interim rows were used only to prepare this reference.
The final proof must use the committed check.
The check uses the TypeScript 5.9 API; the repo CLI is TypeScript 7.
The private reference tool folder installed `typescript-api@npm:typescript@5.9.3`.
Install exit 0: `/tmp/flight-rounds-private-typescript-install.log`.
The installed tool resolves under this worktree and touches no system directory.
The draft plain list is not a ready artifact yet.

### Strict Start source copied into the reference

The strict writer committed source `1486bc00`.
Its source diff from the original `0f0a83fe` was applied to the reference.
The three-way apply kept the flight changes with no conflicts, exit 0:
`/tmp/flight-rounds-strict-scaffold-apply-src.log`.
The first apply also named copied tests that this answer does not carry.
It exited 1 and applied nothing:
`/tmp/flight-rounds-strict-scaffold-apply.log`.
The source-only apply was the correction.
No `apps/` file changed in this worktree.

The copied server entry owns its roots.
Response bodies and the telemetry queue now belong to resources.
One-caller readers use schema objects.
The plain function list records params and call sites.
The reference's own supplier readers take only their needed string keys.
Its own price comparator has per-param TSDoc.
The TypeScript API uses private dependency links, not edits to `apps/`.
`run.mjs` also passes extra command args to the reference CLI.

Check and typecheck exited 0:
`/tmp/flight-rounds-strict-check-fixed.log`,
`/tmp/flight-rounds-strict-copy-typecheck.log`.
The earlier copied-source check had one await-thenable warning.
The search body's opening result is synchronous, so the excess await was removed.
That earlier log is `/tmp/flight-rounds-strict-copy-check.log`, exit 0.
Seam proof and browser boundary checks exited 0:
`/tmp/flight-rounds-strict-seam.log`,
`/tmp/flight-rounds-strict-boundary.log`.

The full flight answer passed 16/16 twice with this strict source, exit 0 each.
The planted mail break failed only its named case, exit 1.
All good, broken, and restored builds exited 0.
Driver: `/tmp/flight-rounds-r5-strict-proof.log`, exit 0.
Logs: reference `.logs/r5-pass-1.log`, `r5-pass-2.log`, `r5-break.log`,
`r5-build-good.log`, `r5-build-break.log`, `r5-build-restored.log`.
This reruns every earlier round after the ownership changes.
The check draft passed 97 files and 22 plain functions, exit 0:
`/tmp/flight-rounds-draft-plain-strict-copy.log`.
The committed strict check is still due from the scaffold writer.
It must pass before the round 5 ready commit.

### Committed strict check and browser lifetime

The reference now carries the exact `check-plain.mjs` from `5d5f2fad`.
Its five final source changes were applied, exit 0:
`/tmp/flight-rounds-strict-final-apply-check.log`,
`/tmp/flight-rounds-strict-final-apply.log`.
JSON parsing is in operation input callbacks, so Core manages a bad input.
The browser page-close listener was still outside a resource in the copied source.
The reference now owns and removes that listener from a resource.
The router entry supplies its existing close callback through a tag.
This keeps the same pagehide behavior and closes both roots.

The draft list check first rejected the old printed list, exit 1:
`/tmp/flight-rounds-page-resource-draft-plain.log`.
The committed check regenerated `PLAIN.md` after its entries were read.
It passes 97 files and 22 plain functions, exit 0:
`/tmp/flight-rounds-canonical-plain.log`.
Command: `npm --prefix tools/flight-trial/reference run check:plain`.
Vite+ does not find this private package's task outside workspace globs.
The first `run.mjs run check:plain` invocation exited 1 with Task not found.
The check's direct Node command and npm script both pass.
The same check's 26 planted failures each exited 1 by their rule name.
Its proof driver exited 0:
`/tmp/flight-rounds-final-plain-proof.log`.
Each red log is `/tmp/start-plain-proof-<case>.log`.
The driver names every case and full path.

The page-resource and final source answer each passed 16/16 twice, exit 0 each.
Each planted mail break failed only its named case, exit 1.
Drivers and all builds exited 0:
`/tmp/flight-rounds-r5-final-proof.log`,
`/tmp/flight-rounds-r5-canonical-proof.log`.
The latest logs are reference `.logs/r5-pass-1.log`, `r5-pass-2.log`,
`r5-break.log`, `r5-build-good.log`, `r5-build-break.log`, `r5-build-restored.log`.
The final check exited 0 with zero authored warnings:
`/tmp/flight-rounds-canonical-check.log`.

The workspace build and serial full tests exited 0:
`/tmp/flight-rounds-final-strict-build.log`,
`/tmp/flight-rounds-final-strict-tests.log`.
All-source TSDoc read 97 files with zero rows, exit 0:
`/tmp/flight-rounds-final-all-tsdoc.log`.
Schema, all-source strict style, prose, and typecheck exited 0:
`/tmp/flight-rounds-final-schema.log`,
`/tmp/flight-rounds-final-style.log`,
`/tmp/flight-rounds-final-prose.log`,
`/tmp/flight-rounds-final-typecheck.log`.
Validate passed all 16 lanes, exit 0:
`/tmp/flight-rounds-final-strict-validate.log`.
Jev exited 0, two file flags and 47 unit flags:
`/tmp/flight-rounds-final-jev.log`.
The earlier answers still apply to fixed paths, awaited native IO, and private bookkeeping.
The leakedInternal file flag and inputDefaultMasks reader flag are in inherited services.
The latest services graph commit replaces that version.
The reference no longer has the old scope getter, queue class, or free delivery function.
The browser listener is now owned even though the check did not flag it.
The strict services commits arrived during this proof.
Next: rebase the saved reference onto them and rerun proof before ready.

The first save was rejected by prose for a word on its banned list.
Prose and commit exited 1; no commit was made.
The following rebase also exited 1 because the save had not succeeded.
Logs: `/tmp/flight-rounds-canonical-prose.log`,
`/tmp/flight-rounds-canonical-commit.log`,
`/tmp/flight-rounds-rebase-latest-services.log`.
The prose line was fixed before retrying the save.

### Final service rebase and page account load

The saved branch was rebased onto services `ce22a63f`.
The first retry stopped on this progress file, exit 1.
Both writers' notes were kept; continuation exited 0.
No stash was used.
Logs: `/tmp/flight-rounds-rebase-latest-services-fixed.log`,
`/tmp/flight-rounds-rebase-latest-continue.log`.
Install, workspace build, and serial full tests exited 0:
`/tmp/flight-rounds-final-install.log`,
`/tmp/flight-rounds-final-rebased-build.log`,
`/tmp/flight-rounds-final-rebased-tests.log`.

The first final flight proof passed 16/16 once, exit 0.
Its second pass failed one hold case with Sign in required, exit 1.
The proof driver exited 1 and restored the source and build, exit 0.
Logs: `/tmp/flight-rounds-r5-ready-proof.log`,
`/tmp/flight-rounds-r5-ready-auth-failure.log`.
Flights had no page loader, so its account was still empty when a fast search ended.
The background sync eventually loaded it, after the hold click.
Flights now loads the account snapshot before showing its controls.
This uses the same loader as Bookings and the account page.
The checks and frozen packets were not changed to hide the failure.
Assumption: the public Flights page may load the viewer's private account snapshot.
The existing account and booking pages already use that scoped snapshot.

The corrected flight proof passed 16/16 twice, each exit 0.
The planted mail break failed only its named case, exit 1.
Driver and all good, broken, and restored builds exited 0:
`/tmp/flight-rounds-r5-ready-proof-fixed.log`.
Teacher logs: reference `.logs/r5-pass-1.log`, `r5-pass-2.log`, `r5-break.log`.
Build logs: reference `.logs/r5-build-good.log`, `r5-build-break.log`,
`r5-build-restored.log`.

The first last check found doc spacing, exit 1:
`/tmp/flight-rounds-ready-check.log`.
The first strict style command included the generated route file, exit 1:
`/tmp/flight-rounds-ready-style.log`.
Authored files pass, exit 0:
`/tmp/flight-rounds-ready-style-fixed.log`.
The strict check found old type spacing in its function list, exit 1:
`/tmp/flight-rounds-ready-plain.log`.
Regenerating the list passed strict checking but failed Markdown format.
Logs: `/tmp/flight-rounds-ready-plain-fixed.log`, exit 0,
`/tmp/flight-rounds-ready-check-fixed.log`, exit 1.
The supplier environment now has a named plain type.
That keeps the exact committed check's list in a form the formatter accepts.
No check rule was changed.
Assumption: generated router code is excluded from authored style checks.
The published strict check also excludes generated code and declarations.

The last page-load change has no new Jev flags, exit 0:
`/tmp/flight-rounds-ready-jev.log`.
The full-branch answers remain above.
TSDoc, typecheck, seam proof, boundary, and schema checks exited 0:
`/tmp/flight-rounds-ready-tsdoc.log`,
`/tmp/flight-rounds-ready-typecheck.log`,
`/tmp/flight-rounds-ready-seam.log`,
`/tmp/flight-rounds-ready-boundary.log`,
`/tmp/flight-rounds-ready-schema.log`.
Forbidden directories match services `ce22a63f`, exit 0:
`/tmp/flight-rounds-final-scope.log`.
Frozen packets 1–2 and 3 match their ready commits, exit 0:
`/tmp/flight-rounds-final-frozen-12.log`,
`/tmp/flight-rounds-final-frozen-3.log`.

### Round 5 ready

Packet 5 is frozen at this ready step.
Rounds 3, 4, and 5 have each passed twice and caught their planted break.
The full round 5 check reruns every earlier round after the strict changes.
The last page-loader repair passed 16/16 twice and the mail break failed.
The only later source change names a TypeScript type; emitted behavior is unchanged.
The answer uses the exact committed strict check from `5d5f2fad`.
It passes 97 files and 22 plain functions.
The same check's 26 planted bad forms were each caught with exit 1.
Its proof driver exited 0: `/tmp/flight-rounds-final-plain-proof.log`.

Last gates, all exit 0:

- Check: `/tmp/flight-rounds-done-check.log`.
  Zero errors, 28 existing warnings, no authored warnings.
- Plain check: `/tmp/flight-rounds-done-plain.log`.
- Typecheck: `/tmp/flight-rounds-done-typecheck.log`.
- TSDoc: `/tmp/flight-rounds-done-tsdoc.log`; 97 files, zero S26 rows.
- Authored style: `/tmp/flight-rounds-done-style.log`.
- Prose: `/tmp/flight-rounds-done-prose.log`.
- Validate: `/tmp/flight-rounds-done-validate.log`; all 16 lanes pass.
- Jev last change: `/tmp/flight-rounds-done-jev.log`; no flags.
  Full-branch Jev and its answers are above.
- Seam proof: `/tmp/flight-rounds-ready-seam.log`.
- Browser boundary: `/tmp/flight-rounds-ready-boundary.log`.
- Schema: `/tmp/flight-rounds-ready-schema.log`.
- Workspace build: `/tmp/flight-rounds-final-rebased-build.log`.
- Full tests: `/tmp/flight-rounds-final-rebased-tests.log`; nine tasks, run serially.
- Reference good, broken, restored builds: reference `.logs/r5-build-*.log`.
- Rebase onto services: `/tmp/flight-rounds-rebase-latest-continue.log`.
- Install: `/tmp/flight-rounds-final-install.log`.
- Scope and frozen checks: `/tmp/flight-rounds-final-scope.log`,
  `/tmp/flight-rounds-final-frozen-12.log`, `/tmp/flight-rounds-final-frozen-3.log`.

No package, app, or service source was changed by this writer.
The lead owns the board, landing, and mutation runs.
All assumptions and failed attempts are recorded above.
Next: lead review, then run the independent harness on the ready branch.

### Lead review: one fix round

Review base: `98e6fa56`.
Packets 1–3 stay byte-frozen; packets 4–5 may change.
The review finds hidden UI and browser transport assumptions in the checks.
It also finds supplier polling that breaks packet 2's refresh rule.
Next: make the checks follow the packets, replace polling with hold events,
and prove every round and each new payment break.

The writer-facing service doc is `tools/writer-trial/flight-services.md`.
It contains only the supplier and payment HTTP sections of the service README.
Grader-only sentences were removed; no control paths, token, ports,
scenarios, or clock controls are shipped in it.
The harness must copy this file into the writer app as `SERVICES.md`.
The lead owns that harness change.
The harness image must also ship the scaffold's committed `check:plain` script,
its TypeScript API dependency, and its checked `PLAIN.md` list.
The writer rules no longer require Jev, which is absent from that image.

Assumptions for this fix round:

- Page controls and saved rows prove actions; browser request paths do not.
- An empty history may omit its table once the page load completes.
  Nonempty history checks poll for the saved rows.
- Bookings expiry is checked on load or reload, not by live supplier polling.
- Public seat events contain only supplier, flight, cabin, and remaining seats.
  They expose no private booking or traveler data.
- Idle proof uses a three-second wall-time condition and call logs.
  It does not move a service clock or sleep.
- The teacher secret must match the app and payment service.
  This is needed to prove correct old signatures, exact bytes, and fresh repeats.
- Button checks and route-repeat checks use separate bookings.
  Each repeat case supplies one teacher-owned execution ID.
- Mail times must match the saved Flights display values exactly.

### Hold events and fair action checks

The results and Bookings polling resources and their refresh routes are gone.
A hold transaction publishes a public seat change in the saved event stream.
Only matching supplier, flight, and cabin rows change in an open results page.
The public stream lock keeps parallel app holds and seat events in order.
Bookings reads supplier expiry once per page load through a server function.
There is no background supplier offer or order polling.

Search waits for the packet's Search button, not an unnamed heading.
The race winner comes from Held history; the loser needs visible Sold out text.
Held setup polls a second history tab so navigation cannot cancel its hold.
Expiry checks reload inside their poll.
An empty history accepts an absent or empty table after the browser load event.
Table headers and cells are read in one DOM snapshot.
The first run read them across hydration and got an empty object, exit 1:
`/tmp/flight-rounds-review-r3-proof.log`,
`/tmp/flight-rounds-review-r3-first-pass.log`.
The fixed round 3 passes 10/10 twice, each exit 0.
Its planted price break fails by name, exit 1.
Driver and all builds exit 0:
`/tmp/flight-rounds-review-r3-proof-fixed.log`.

Payment and email button checks observe Processing and Sent, not request paths.
Separate route cases create a teacher execution ID and repeat it concurrently,
then once after the result, checking HTTP 200 and the exact receipt.
They count real supplier, payment, refund, and Mailpit effects.
Packet 4–5 now name HTTP 200 and show filled receipts.
Packet 5's mail times are the saved Flights Departs and Arrives strings.
The time check reads those shown values before clicking Hold.

The signature checks add correct old signatures, changed request bytes,
and a fresh correctly signed repeat of the same result event for a real intent.
Assumption: the teacher may sign a result for that real service intent.
It sends the same event ID and body again with a fresh timestamp.
The service's own repeated deliveries remain covered in their original case.
The proof driver keeps the old bad-digest break and adds timestamp and refund breaks.
Its mail break now raises through the real failed-send path before saving partial.

Round 1 proof stages the reference's supplier list to A only.
Assumption: this reproduces the first packet's scope using the current strict source.
The driver changes no teacher rule and restores the full source in finally.
Round 2 and later proofs use the full three-supplier answer.

Saved source gates, all exit 0:

- Check: `/tmp/flight-rounds-review-source-check-first.log`.
- Plain: `/tmp/flight-rounds-review-source-plain.log`; 96 files, 22 plain functions.
- Types: `/tmp/flight-rounds-review-source-types.log`.
- Style: `/tmp/flight-rounds-review-source-style.log`.
- Seam proof: `/tmp/flight-rounds-review-source-seam.log`.
- Boundary: `/tmp/flight-rounds-review-source-boundary.log`.

Next: run proof 1, 2, 4, and 5, including every new break, then final gates.

### Review proof: search and payment

Round 1 passes 3/3 twice, each exit 0.
The price break fails by name, exit 1.
Round 2 passes 6/6 twice, each exit 0.
The duplicate-row break fails by name, exit 1.
Both drivers and every build exit 0:
`/tmp/flight-rounds-review-r1-proof.log`,
`/tmp/flight-rounds-review-r2-proof.log`.
The original round 3 behavior and idle proof are green above.

The first round 4 run passed the new signature and route-repeat cases,
then lost its supplier, payment, and database relay processes.
The app stopped and later fetches failed.
That run is not proof; its driver exited 13:
`/tmp/flight-rounds-review-r4-proof.log`.
Its first pass exited 1: reference `.logs/r4-pass-1.log` before the rerun.
The stop routine had subscribed after the server had already exited.
It now saves logs and restores source even when the server has already ended.
All containers were still healthy; new owned service and relay processes were started.
Assumption: the lead's Chaos Mailpit container may be reused until proof ends.
The lead explicitly permits stopping that container afterward.
Owned service logs: `/tmp/flight-rounds-review-owned-services.log`,
`/tmp/flight-rounds-review-owned-relay.log`.

The owned-service round 4 passes 17/17 twice, each exit 0.
All three breaks fail by their named case, each exit 1:
bad digest, ignored timestamp, and missing refund.
Driver and every good, broken, and restored build exit 0:
`/tmp/flight-rounds-review-r4-proof-owned.log`.
Reference logs: `.logs/r4-pass-1.log`, `r4-pass-2.log`,
`r4-break.log`, `r4-break-timestamp.log`, `r4-break-refund.log`.
Each red log names the failed packet promise.

Receipt checks compare the returned execution ID, not the whole JSON object.
Assumption: harmless extra receipt fields are allowed.
No packet says its receipt is a closed object shape.
Next: round 5 proof and final gates.

### Lead review fixes complete

Round 5 passes 21/21 twice, each exit 0.
Its new email-route case proves concurrent and later repeats use one execution.
The improved failed-send break fails the original named partial-mail case, exit 1.
Driver and all good, broken, and restored builds exit 0:
`/tmp/flight-rounds-review-r5-proof.log`.
Reference logs: `.logs/r5-pass-1.log`, `r5-pass-2.log`, `r5-break.log`.
Every earlier round is rerun by this proof.

Review items:

1. Service HTTP doc added; the lead must ship it as `SERVICES.md`.
2. Search waits for the Search button.
3. Held setup and race winners use saved history; losers need visible Sold out.
4. Buttons are checked by outcomes; route repeats use their own execution IDs.
5. Expiry polls reload before reading.
6. Supplier polling is removed; hold events update live seats.
   Idle results prove zero supplier offer GETs over a wall-time condition.
7. Empty history accepts no table or an empty table after page load.
8. Packets 4–5 specify HTTP 200 and show filled receipt bodies.
9. Teacher settings include WEBHOOK_SECRET.
   Old signatures, changed bytes, and fresh real-intent result repeats are covered.
   Old bad-digest and new timestamp breaks are both caught.
10. Mail time strings match the Flights display values saved before Hold.
11. Jev was removed from writer rules.
    The lead must ship the committed scaffold `check:plain` script and its tools.
12. The reset-error allowance and its teacher doc section are gone.
13. The new-search poll needs a JFK row and rejects AMS rows.
14. The mail break uses the real failed-send path; the refund break is caught too.
15. The rounds section's stale next step is updated.

Final gates, each exit 0:

- `vp check`: `/tmp/flight-rounds-review-final-check.log`.
  Zero errors, 28 existing warnings, none from authored changes.
- Reference `check:plain`: `/tmp/flight-rounds-review-final-plain.log`.
  It checks 96 files and 22 plain functions.
- Typecheck: `/tmp/flight-rounds-review-final-types.log`.
- Style: `/tmp/flight-rounds-review-final-style.log`.
- TSDoc: `/tmp/flight-rounds-review-final-tsdoc.log`; 96 files and zero S26 rows.
- Workspace build: `/tmp/flight-rounds-review-workspace-build.log`.
- Full tests: `/tmp/flight-rounds-review-workspace-tests.log`; nine tasks run serially.
- Validate: `/tmp/flight-rounds-review-final-validate.log`; all 16 lanes.
- Scope: `/tmp/flight-rounds-review-scope.log`.
- Frozen packets 1–3: `/tmp/flight-rounds-review-frozen.log`.
- Diff whitespace: `/tmp/flight-rounds-review-diff-check.log`.
- Jev: `/tmp/flight-rounds-review-final-jev.log`.
  No file flags; five unit flags are answered below.

Jev answers:

- `stopOnlyInDefer`, holdFlight and saveBookingState: false.
  They await their work inside the operation and start no background task.
  Supplier calls consume their response under their call signal.
  Native DB calls are awaited; the pool belongs to its resource.
- `configNotTag`, holdSeat, payHold, and retryConfirmation: false.
  Their relative app routes are fixed packet contracts, not settings.
  Supplier and payment URLs and secrets remain required backend tags.
- Deleted route files print missing-path notes; no source remains to judge there.
  The label bank is outside this writer's allowed paths.
  The lead can use these reasons in its labels.

Assumptions are listed in this fix round's earlier sections.
No stash, package, app, or service source change was made.
No frozen packet was edited.
Next: lead copies the service doc as `SERVICES.md`, adds `check:plain` to the image,
and supplies the matching WEBHOOK_SECRET to the teacher before harness proof.

Last doc prose and handoff check exited 0:
`/tmp/flight-rounds-review-final-prose.log`,
`/tmp/flight-rounds-review-handoff-check.log`.
The owned supplier/payment group and relay stopped with exit 0.
The lead's allowed Chaos Mailpit container stopped with exit 0:
`/tmp/flight-rounds-review-cleanup.log`.
The original Postgres and Mailpit containers were left running.

## trial/flight-integration

Writer: Codex.
Branch: `trial/flight-integration`.
Next: lead review; then start the Hono trial at packet 1.
Verify: rounds 1 to 5 pass twice; five planted breaks fail.

Assumptions:

- Main owns all service code, data code, and service tests.
- Keep main for older merged files outside the allowed paths.
- Keep both writers' round and harness proof notes.
- The existing Doing card stays with the lead.
- This writer does not edit the board outside the brief's limits.
- Only replaced flight images and proof folders may be removed.

Rounds merge exited 1 for conflicts.
Those conflicts are now resolved with main's services kept.

Harness merge exited 1 for conflicts.
Main's files outside the allowed paths are kept.
The harness proof stays in `HARNESS-PROGRESS.md`.
The flight rules keep the rounds' HTTP rules and the harness' app rules.
Workspace and reference builds exited 0 before the rounds commit.

### Integration: landed scaffold and teacher settings

The rounds merge is `b31299f9`.
The harness merge is saved after it.
Packets 1 to 5 still match `10ff6e72` byte for byte.
Main's service, data, and service-test files are unchanged.

Creation now freezes the service guide and copies `SERVICES.md`.
The teacher reads repo files only.
Its `grader.env` receives the same WEBHOOK_SECRET as the app.
Scaffold hash sorting now supplies a compare function.
The services image copies the landed native TypeScript process entries.
It packs current dependencies, so a later Hono dependency is included.
The new rebuild command is in the writer-trial README.
Each image gets an idle keeper and its saved tar.

The reference used an older scaffold and its older callback API.
Assumption: the full gate must use main's exact scaffold bytes.
The reference now copies main's scaffold, process entry, and shipped tests.
Feature calls use the current sync request API.
Native flight requests belong to a resource.
Settings use schemas directly; repeated fare comparisons are inlined.
The strict plain-function cap stays at 17, with no exclusions.
The reference uses the same strict check as the image.

The first strict check failed on the old callbacks and plain functions.
Log: `tools/writer-trial/.logs/integration-reference-plain-errors.log`.
The corrected list check exited 0.
The first code check found old settings types and a missing resource label.
Both are fixed before proof.

### Integration: proof setup

The five requested steps are saved as separate commits.
Both images and their tar files are saved.
Create and stage 1 exited 0.
The sealed network proof exited 0.
The worker folder proof exited 0.
Logs are under `tools/writer-trial/.logs/`.

The first reference archive omitted its dependency link and failed.
The proof now adds the image's read-only dependency link.
The runner uses the same frozen Jev judges as saved trial checks.
Exact starter bytes keep their existing teacher-owned trust.

Copied reference tests were picked up by the parent service test config.
That config has no app aliases, so the workspace test failed.
The duplicate tests are removed from the repo.
The proof archive instead keeps the image's shipped tests and test config.
It adds empty bookings to the two existing sync fixtures.
The earlier separate app test run passed all 37 tests.
The strict census passed when run on source and test files only.
The first broad census counted a generated router and the test fixture
as production code; its output is kept beside the corrected run.

### Integration: saved proof, blocked on scaffold startup

The full workspace gate chain exited 0.
The writer harness passed all 79 tests.
The reference's own gate passed all 37 shipped tests.
Its schema, build, seam, strict plain check, and frozen Jev gate passed.

The round 1 teacher exited 1 on browser startup.
All three checks hit `Disposed` before the app renders.
The full reference run exited 1 and stopped at round 1, pass 1.
Round 1, pass 2, rounds 2 to 5, and the five planted breaks are not proven.
Logs, image IDs, saved tar paths, and next commands are in
[INTEGRATION-GATES.md](INTEGRATION-GATES.md).

The failing code is
`apps/start-scaffold/src/scaffold/frontend/router.tsx:28`.
The reference and writer image use main's exact scaffold bytes.
`tabLifetime.bind()` calls `ctx.defer()` after its factory has returned.
Core rejects that call with reason `resource factory already finished`.
The browser stack names `defer` and `Object.bind`.
The public Core probe prints the same error and exits 1.

Core feedback, with the failing shape:

```ts
const listener = resource({
  label: "late cleanup proof",
  factory: (_deps, ctx) => ({
    bind: () => ctx.defer(() => {}),
  }),
});
const scope = createScope();
await scope.ready;
scope.resolve(listener).bind();
```

Assumption: keep the exact scaffold rule and the brief's path limits.
The lead must move cleanup registration into the scaffold's factory.
This writer does not change Core, apps, or service code to mask the error.
The lead then rebuilds the writer image with a new tag,
copies the fixed scaffold into the reference, and runs the saved proof.

Jev labels are saved in `INTEGRATION-JEV.jsonl` under the allowed doc path.
There are 34 false labels and one true label.
The true label covers a completed mail retry refused by a later guard.
That guard now runs after the completed-result check.
The lead can import these labels when landing.
The shared Jev bank is unchanged; no calibration is claimed.

The Jev promise scan exited 1 because it assumes a `tests/` folder.
The writer harness keeps its `.test.mjs` files at the package root.
This missing-folder result is recorded, not counted as a pass.
No mutation lane is required by this integration brief.

The prepared trial is `flight-integration-01`, staged at packet 1.
No model run started.
Both images have idle keepers and saved tar files.
Old flight images and proof folders stay until the new full run passes.

### Integration: resume after the landed startup fix

The lead fixed the scaffold in `1ff5402f`.
The rebase first exited 1 on the two old merge conflicts.
Both keep main outside this writer's paths.
The final rebase continue exited 0.
The rebase kept both reviewed branch histories.
A stale harness launcher added by the merge was removed to match main.

The reference now copies the fixed scaffold from main.
Assumption: use fresh `.2` image tags and keep old saved images
until the five-round proof and workspace gates pass.
The writer image includes main's new tab-lifetime test.

The Jev promise tool reads a `tests/` folder and `.test.ts` names.
Assumption: scan a saved copy of the harness test files and README,
with `.mjs` copied to `.ts` for this title-only scan.
This keeps the scanner unchanged and reads the real test titles.
Also scan the reference proof folder with its shipped tests.

The title-only snapshot also strips `void` before `it()` or `test()`.
The titles stay exact; 58 titles are found across ten real test files.
The first valid harness promise scan found 22 missing README lines.
Those checked rules are now stated in the harness README.
The real scaffold test folder scan exited 0 with one advisory gap:
`the server side has no page and binds without listening`.
That new main test is outside this writer's changed tests.
Its source uses `pageEvents(undefined)` on the server.
No app README change is made by this writer.

The repeat promise scan exited 0 and found four more README gaps.
Those four lines are also now stated in the harness README.
All flagged titles from both valid scans have a saved README line.
The promise scan is advisory; unsure rows are not defects.

The `.2` image used the starter registry's old test list.
It omitted main's new `tab-lifetime.test.ts`.
The `.2` round 1, pass 1 full gate exited 0.
The run was stopped with exit 130 during pass 2.
It does not count toward the final `.3` image's proof.
The image script now copies every shipped app test into its seed.
A fresh `.3` image and proof include the landed lifetime test.

The final `.3` writer and services image build exited 0.
Both saved tar files exist and both idle keepers are running.
Image IDs and saved paths are in `INTEGRATION-IMAGES.json`.
The image's tab-lifetime test matches main byte for byte.
Create, stage 1, and worker folder proof for `flight-integration-03`
all exited 0, including an explicit check for that new test.
No model run started.

The reference promise scan reads its real saved project folder.
It exited 0 and found 39 titles, including both new lifetime tests.
Both new titles were advisory gaps in the copied app README.
The reference README now states both behaviors.
The new listener-state label is false:
`tabLifetime` owns a close callback and its page listener,
not state rendered by a view.
The label is saved in `INTEGRATION-JEV.jsonl`.

Final image proof: round 1 passed twice with exit 0.
Its planted fare break exited 1 on
`r1 public search shows real fares and asks each active supplier once`.
Own checks, exact scaffold, strict plain check, and Jev all exited 0
for both good passes and the planted break.
Results are saved in `INTEGRATION-RESULTS.json`.
Rounds 2 to 5 are still running; old proof folders stay.

Final image proof: round 2 passed twice with exit 0.
Its planted merge-key break exited 1 on
`r2 a cheaper late fare merges and a failed supplier keeps good rows`.
The broken app's own checks, seam, plain check, and Jev exited 0.
Round 3 is now running.

The full run stopped at round 3, pass 1, with exit 1.
The app's own checks, seam, plain check, and Jev exited 0.
Two browser checks failed: changed price and the last-seat race.
Red log: `tools/writer-trial/.logs/resume-reference-final.log`.

The hold fails before its HTTP request.
Core's default UUID source calls `crypto.randomUUID()`.
Chrome has no such function on the private HTTP app address.
The browser probe exits 1 and prints
`crypto.randomUUID is not a function`.
Log: `tools/writer-trial/.logs/resume-flight-http-uuid-red.log`.

Assumption: give the teacher the browser features a HTTPS app gets.
Chrome now trusts only the app address from APP_URL.
The first native UUID probe with that flag also exits 1.
Log: `tools/writer-trial/.logs/resume-flight-http-uuid-green.log`.
That file's old green name does not mean it passed.
No Core, app, service, or reference source change is needed.
A fresh full run uses the corrected teacher setting.
Old proof folders and images still stay until that run passes.

The default headless shell ignores the trusted-address flag.
The teacher now chooses full Chromium with `channel: "chromium"`.
Its config and cache paths are `/tmp` because the image is read-only.
The full Chromium UUID probe exited 0 and prints `secure: true`.
Log: `tools/writer-trial/.logs/resume-flight-http-full-chromium-green.log`.
The earlier full Chromium probe failed before these writable paths
were set; its crashpad error is kept in its red log.

### Integration: capacity-error handoff

The next writer took over at `05f73935` with a clean worktree.
The existing reference process is PID 640336.
It runs from `reference-trusted-final`; no second run was started.
Rounds 1 and 2 each passed twice with exit 0.
Each planted break exited 1 on its named round check.
The updated rows are in `INTEGRATION-RESULTS.json`.
Round 3 is running.

Assumption: keep the current image fixed through this proof.
After success, rebase onto `origin/main` for `f847c99c`.
The saved image still has the older Core build.
Its browser proof keeps the secure-origin flag.
New images built with `f847c99c` no longer need that flag.
Old flight images and proof folders stay until the gates pass.

The trusted-origin run also proved round 3.
Both full gates exited 0.
The planted break exited 1 on
`r3 a changed price is refused before any hold order`.
Own checks, scaffold, strict plain check, and Jev exited 0.
The nine saved rows now point to `reference-trusted-final`.
Round 4 is running.

Trusted browser proof: round 3 passed twice with exit 0.
Its planted price-check break exited 1 on
`r3 a changed price is refused before any hold order`.
Own checks, scaffold, plain check, and Jev exited 0 in all three runs.
Both good browser passes report 10/10 checks.
Logs: `reference-trusted-final/round-3/` under the writer log folder.
Round 4 is running.

Trusted browser proof: round 4 passed twice with exit 0.
Its planted signature break exited 1 on
`r4 payment waits for a valid signed webhook and syncs across tabs`.
Both good browser passes report 17/17 checks.
Scaffold, plain check, and Jev exited 0 in all three runs.
The break also made the app's own check exit 1:
`timingSafeEqual` became unused after removing the signature comparison.
The browser reached the forged event and rejected the broken app by name.
Its test and build still passed.
Assumption: this meets the brief's named-break rule;
the brief does not require the broken app's own check to pass.
Logs: `reference-trusted-final/round-4/` under the writer log folder.
Round 5 is running.

The prior writer resumed while the takeover writer was working.
Its round 3 proof commit `21b7e1af` is kept.
The takeover writer asked it to leave edits and the rebase alone,
keep PID 640336 alive, and report that process's final exit.
No duplicate reference process was started.

Trusted browser proof: round 5 passed twice with exit 0.
Its planted mail-retry break exited 1 on
`r5 failed mail keeps the booking valid and retry sends once`.
Own checks, scaffold, plain check, and Jev exited 0 in all three runs.
Both good browser passes report 21/21 checks.
Logs: `reference-trusted-final/round-5/` under the writer log folder.

PID 640336 finished with exit 0.
The prior writer captured and reported that exit from its running command.
The full log ends with `PASS full reference gates and named planted breaks`.
The saved-result check also exited 0:
`tools/writer-trial/.logs/takeover-reference-verified.log`.
It checked ten full passes, five named breaks, image IDs, and frozen files.
All 15 rows are now in `INTEGRATION-RESULTS.json`.
Next: rebase onto main, run all workspace gates, then remove old proofs.

### Integration: rebase onto the UUID fix

The rebase onto `origin/main` at `f847c99c` finished with exit 0.
The first attempts stopped on the two known old merge conflicts.
Main's services, data, tests, and other out-of-scope files were kept.
The trial files match the proved pre-rebase tree byte for byte.
Scope proof: `tools/writer-trial/.logs/takeover-rebase-scope.log`, exit 0.

Core now builds a v4 UUID with `crypto.getRandomValues`
when a plain HTTP page has no `crypto.randomUUID`.
The secure-origin flag is no longer required with this Core build.
Assumption: keep the already proved `.3` image fixed.
It still packs the older Core, so its teacher keeps the flag.
A later image rebuild can drop the flag and test plain HTTP directly.
No Core, app, or service source was changed by this writer.

The post-rebase workspace gate chain exited 0.
Install, build, check, all package tests, harness tests, prose,
and `pnpm validate` each exited 0.
The check has zero errors and 28 warnings.
Nine package tasks, 79 harness tests, and all 16 validation lanes passed.
Log: `tools/writer-trial/.logs/takeover-final-gates.log`.
The current gate and image list is in `INTEGRATION-GATES.md`.
Next: remove replaced images and proof folders, keeping final proof.

The fresh Jev preflight exited 0 with no file flags.
It gave advice on 24 units; six judge/unit pairs were new.
Those six pairs were read against the unchanged starter source.
All six have false labels with a source-based reason in `INTEGRATION-JEV.jsonl`.
The strict source census exited 0: `takeover-style.log`.
Logs are under `tools/writer-trial/.logs/`.
No code or shared Jev bank was changed; the lead can import these labels.
No calibration run is claimed before landing.

### Integration: final cleanup and review handoff

Cleanup exited 0: `tools/writer-trial/.logs/takeover-cleanup.log`.
The removed paths and image IDs are in `INTEGRATION-CLEANUP.json`.
It removed 12 replaced trial folders, 7 old reference folders,
15 old image tags, and 8 old saved image folders.

Every removed trial had no model agent ID.
Before removal, its host files and any live worker files were archived.
The old reference folders were also archived before removal.
Archives stay in `tools/writer-trial/.logs/cleanup-archives/`.
No model attempt or session was invented for these setup proofs.
The old workspace entries, containers, networks, volumes,
and their exact trust entries were removed with the replaced trial folders.
The stock-suite legacy proof was left alone.

The `.3` writer and services images, their keepers, and both tars remain.
Postgres and Mailpit image keepers remain.
The final proof and `flight-integration-ready-01` remain.
The prepared trial is still at packet 1; no model run has started.
Its frozen-file and worker-folder checks passed after cleanup.
Log: `tools/writer-trial/.logs/takeover-ready-retained.log`, exit 0.
The final reference result check passed again after cleanup.
Log: `tools/writer-trial/.logs/takeover-reference-retained.log`, exit 0.

Status: Review.
All work in the integration brief is saved with passing proof.
The lead owns review and landing; this writer did not push.

### Integration: Hono services follow-up

The lead landed services routing at `0da81a82` and asked for one more pass.
The rebase finished with exit 0 after the two known merge conflicts.
Main's Hono service files were kept.
Both tracks' progress notes were kept.
Trial source bytes stayed unchanged by the rebase.
Logs: `hono-rebase-continue-2.log` and `hono-rebase-scope.log`, exit 0,
under `tools/writer-trial/.logs/`.

Install and workspace build exited 0 after the rebase.
The requested services rebuild command exited 0.
It saved the new image tar and started its idle keeper.
Log: `tools/writer-trial/.logs/hono-services-image.log`.
The new tag, ID, and tar path are in `INTEGRATION-IMAGES.json`.
The old services ID and tar path stay there as prior proof inputs.
The writer image is unchanged.

Assumption: add `--once` to the existing reference runner.
It runs the same own, teacher, scaffold, plain, and Jev gates.
It selects only `pass-1` for each round, with no planted break.
The default still runs two passes and a named break per round.
The Hono run uses a fresh `reference-hono-final` proof folder.

The Hono follow-up workspace gate chain exited 0.
Install, build, check, all package tests, harness tests, prose,
and `pnpm validate` each exited 0 on `0da81a82`.
The check reports zero errors and 28 warnings in 590 files.
All nine package tasks, 79 harness tests, and 16 validation lanes passed.
Log: `tools/writer-trial/.logs/hono-workspace-gates.log`.
The first runner check found formatting in the generated config;
formatting was fixed before the green check and the image commit.
The five-round Hono reference run is still running.

Hono rounds 1 and 2 each passed the full gate with exit 0.
The saved rows are in `INTEGRATION-HONO-RESULTS.json`.
Round 3 is running; no planted breaks are selected.

The Hono isolation proof exited 0: `hono-isolation.log`.
It blocks internet, private controls, and writer Mailpit Chaos.
SMTP, Postgres, service APIs, and signed callbacks work.

Assumption: a fresh prepared trial must pin the newly proved image.
Created and staged `flight-integration-hono-01` at packet 1.
No model run started.
Create, stage, worker-folder, frozen-file, and image-pin checks exited 0.
Logs: `hono-ready-create.log`, `hono-ready-stage.log`,
`hono-ready-proof.log`, and `hono-ready-pin.log`,
all under `tools/writer-trial/.logs/`.
The older ready trial stays as the prior services proof.

Hono rounds 3 and 4 each passed the full gate with exit 0.
The teacher reports 10/10 and 17/17 checks.
Own, scaffold, plain, and Jev checks also exited 0.
Four rows are saved in `INTEGRATION-HONO-RESULTS.json`.
Round 5 is running.

### Integration: Hono follow-up complete

The Hono reference run exited 0.
Rounds 1 to 5 each passed once through the full gate.
Own, teacher, scaffold, plain, and Jev checks all exited 0.
Teacher counts were 3/3, 6/6, 10/10, 17/17, and 21/21.
No planted break was rerun, as the lead asked.
All five rows are saved in `INTEGRATION-HONO-RESULTS.json`.
Run log: `tools/writer-trial/.logs/hono-reference-final.log`.
Saved-result check: `hono-reference-verified.log`, exit 0,
under `tools/writer-trial/.logs/`.
It checks the five passes, the new image ID, and the frozen files.

The new services ID is
`sha256:daaf65a9b1d6bb8cc1d821a0e3deac56735b4480d57a8ac9bdc32b28b01542b7`.
Its tar and idle keeper remain.
`INTEGRATION-IMAGES.json` records the exact tag and saved tar path.
`INTEGRATION-GATES.md` records the full current proof and workspace gates.

The fresh prepared trial is `flight-integration-hono-01`.
It is staged at packet 1 and pins the new Hono image.
No model run started.
The earlier two-pass proof and its five named breaks remain saved.
The earlier cleanup is complete; prior final proof images stay for replay.

Status: Review.
No work remains in this writer's brief or the Hono follow-up.
The lead owns review and landing; nothing was pushed.

### Integration review fix 1: host gateway

The new probe failed on the old network code with exit 1.
Host ports 2377, 7946, and 5355 accepted writer connections.
Log: `tools/writer-trial/.logs/review-gateway-red.log`.
Both internal networks now inhibit the bridge IPv4 address.
Docker accepted `com.docker.network.bridge.inhibit_ipv4=true`.
No host, Docker daemon, or firewall settings changed.
The same proof passed with exit 0 after the fix.
Log: `tools/writer-trial/.logs/review-gateway-option.log`.
The probe checks gateway ports 2377, 7946, 5355, 22, and 80.
The earlier no-host-route claim was too broad and is corrected.

### Integration review fix 5: frozen root files

The frozen config now creates its parent with `dirname`.
It no longer creates an empty `config.jso` folder.
The test checks every top-level frozen entry.
Logs under `tools/writer-trial/.logs/`:
`review-root-path-red.log`, exit 1 before the fix;
`review-root-path-green.log`, exit 0 after it, 11 tests pass.

### Integration review fix 2: teacher hashes

Create now saves every teacher file hash and one hash for the full set.
Checks compare the live files with that saved set before starting Docker.
Changed, added, missing, or unpinned files make the check unavailable.
Those checks earn no score and cannot pass.
The grader receives the same bytes that passed the hash check.
A second comparison catches changes made while the check ran.
Every new reference result saves `teacherHash`.
Existing trials without teacher pins need a fresh create.

The test uses a separate checkout copy and calls the real checker.
It covers changed, added, missing, and unpinned teacher files.
It checks unavailable status and no score for each case.
Logs under `tools/writer-trial/.logs/`:
`review-teacher-red.log`, exit 1 before the fix;
`review-teacher-green.log`, exit 0 after it, 20 tests pass.

### Integration review fix 4: one webhook secret

One constant now supplies the app, payment service, and teacher.
The final isolation proof will check the signed callback again.

### Integration review fix 6: proof limits

Round 1 uses one supplier on purpose, as its packet asks.
Pass 2 reuses pass 1 Jev answers for unchanged file bytes.
The secure-origin flag stays in the teacher browser.
It is harmless with the new Core build and was needed for the old image.
This corrects the earlier note about removing the flag.
These limits are now stated in `INTEGRATION-GATES.md`.

### Integration review fix 3: new writer image

The writer image rebuild and tar save exited 0.
Log: `tools/writer-trial/.logs/review-writer-image.log`.
The build used main `0da81a82`, which includes Core fix `f847c99c`.
Core, React, and scaffold source bytes match that main.
The packed Core bytes match the current workspace build.
The image contains the `getRandomValues` fallback.
The secure-origin flag stays.

Writer tag: `tinker-writer-flight:20261003.integration.4`.
Writer ID:
`sha256:798c43f875b1054fa29f2a31eedbe7c06461dc7b85f7194674c4146faae82f7a`.
The tar path and Core hash are in `INTEGRATION-IMAGES.json`.
The idle image keeper is running.
Assumption: prepare the writer context, then build and save only that image.
This keeps the current Hono services image fixed, as requested.
The exact build steps are saved in `.logs/review-writer-image.mjs`.

### Integration review fixes: final proof and fresh stage

The isolation proof on the new writer image exited 0.
It includes the new gateway probes and a signed callback check.
Log: `tools/writer-trial/.logs/review-isolation.log`.
The old network red log remains saved with exit 1.

The new `--once` reference run exited 0 through all five full gates.
Each round passed own, teacher, scaffold, plain, and Jev checks.
Teacher counts were 3/3, 6/6, 10/10, 17/17, and 21/21.
No planted break was rerun.
All five result files save the same frozen teacher hash.
Run log: `tools/writer-trial/.logs/review-reference.log`.
Saved-result check: `review-reference-verified.log`, exit 0,
under `tools/writer-trial/.logs/`.
Rows: `INTEGRATION-REVIEW-RESULTS.json`.

The workspace gate chain exited 0.
Install, build, check, all package tests, harness tests, prose,
and `pnpm validate` each exited 0.
The check has zero errors and the same 28 warnings as before.
All nine package tasks ran without cache hits and passed.
All 80 harness tests and 16 validation lanes passed.
Log: `tools/writer-trial/.logs/review-workspace-gates.log`.
Jev preflight for this fix round exited 0 with no new source flags.
Log: `tools/writer-trial/.logs/review-jev-preflight.log`.
No TypeScript source or tests changed in this fix round.
The prior labels and style census remain saved.

Removed `flight-integration-hono-01` after the green proof.
Its Paseo project, containers, volume, networks, trust entry, and folder are gone.
Its host files were archived before removal.
Log: `tools/writer-trial/.logs/review-cleanup-old.log`, exit 0.

Created `flight-deepseek-01` and staged packet 1.
The create, stage, and saved-state checks each exited 0.
Logs under `tools/writer-trial/.logs/`:
`review-ready-create.log`, `review-ready-stage.log`, and `review-ready-proof.log`.
It pins the new writer, current Hono services, and proved teacher hash.
Both networks inhibit host IPv4.
It has the scaffold, five skills, tests, service guide, and packet 1 only.
It has no teacher files, model agent, or saved attempt.
No model run started.

`INTEGRATION-GATES.md` now records the current proof and each gate log.
`INTEGRATION-IMAGES.json` records both image IDs and saved tars.
The final proof docs prose check exited 0:
`tools/writer-trial/.logs/review-proof-prose.log`.
Status: Review; all requested fixes and proofs are saved.
The lead owns review and landing; nothing was pushed.

## DeepSeek baseline, 2026-10-03

Trial `flight-deepseek-01`, made from `8993474b`.
Writer: `pi/writer-gateway/deepseek/deepseek-v4.1-flash`, thinking high.
Agent: `cc4af911`. Images: app `798c43f8`, services `daaf65a9`.
Teacher hash: `ef01fd5e`.

Baseline: **0**. Round 1 failed; `score.json` records it.

What DeepSeek built: a `/flights` page, one supplier operation,
one server function, 7 new tests, and a browser script.
Its own check, test, build, and `check:plain` passed.
Jev passed on all 11 changed files.
It fixed two starter type casts in `src/server.ts` that Jev blocked.

Hidden checks, round 1:

- Pass: public search shows real fares and asks supplier A once.
- Fail: empty route replaces old rows.
  It waits for `Search complete` after a search with no flights.
- Fail: a supplier failure is shown and the form works again.
  It waits for `Search complete` after a failed search.

Cause: DeepSeek made the notices one-of states.
Packet 1 lines 30-31 say "When the supplier has answered,
show Search complete. If there are no flights, show No flights."
So an empty answer shows both.
The failure case is less clear: line 32 does not say
whether a failed supplier counts as "answered".

Incident: the writer's Jev link pointed into the integration
worktree, which the lead removed after launch.
Jev failed for the first pass; the lead fixed the link
and resumed the agent for the Jev step only.

### Retries (user, 2026-10-03: "1, be more autonomous")

Retries measure how far DeepSeek gets with one teacher note a round.
The baseline stays 0. Up to 3 tries a round.
Later rounds are staged with `stage --explore` (`275cae5c`).

- Round 1, try 2 (agent `e56bd6c9`): **pass**, hidden checks 3 of 3.
  Feedback named the two failed cases and the notice rule.
  DeepSeek now shows `Search complete` beside the outcome line.
- Round 2, try 1 (agent `aa50f105`): **pass**, hidden checks 6 of 6
  (round 1's three again, plus three for metasearch).
- Round 3, try 1 (agent `735eccbf`): **pass**, hidden checks 10 of 10.
  It holds seats, saves bookings in a new table, and pushes
  sold-out changes to other open pages over the sync stream.
  The two-traveler race for the last seat passed.
- Round 4, try 1 (agent `3450b4c4`): fail, hidden checks 15 of 17.
  Rounds 1 to 3 still pass. Two real bugs:
  two requests with one execution ID, sent at the same moment,
  made 2 create-intent calls; and an `Expired` booking kept its Pay button.
- Round 4, try 2 (agent `e09fcf8f`): **pass**, hidden checks 17 of 17.
  It moved the pay decision into one locked transaction,
  with a test that failed before (2 intents) and passes after (1).
- Round 5, try 1 (agent `58b5f54a`): **pass**, hidden checks 21 of 21.
  One confirmation mail per paid booking; a failed send keeps the booking
  confirmed, marks the email Failed, and offers a retry.

### Result

- Baseline (first try only): **0**. `score.json` keeps it.
- With one teacher note a round: **all 5 rounds pass**, in 7 tries.
  Rounds 2, 3, and 5 passed first try; rounds 1 and 4 needed a second.
- Writer cost: about $1.96 for all 7 tries ($0.07 to $0.43 a try).
- Own checks, `check:plain` (17 of 17 plain functions), the seam check,
  and Jev passed on every saved try.
- Every failure was a real app bug or a missed packet line,
  never the scaffold rules: notices shown as one-of states (round 1);
  a check-then-act race on repeated payments, and a Pay button
  left on expired holds (round 4).

Harness faults found and fixed during the run:
the Jev link into a removed worktree (`trial/jev-link`),
starter casts that Jev blocked (`start/starter-casts`),
no way to stage past a first failure (`--explore`),
and a stale `FEEDBACK.md` left between rounds (follow-up).

## Services protocol, 2026-10-04

Card: `trial/services-protocol`.
Writer: Sol, branch `trial/services-protocol`.
Next: save the wire check, then move replies to Hono.
Verify: zero wire changes, all gates green, mutation at least 85.

Assumptions:

- The old code is fixed at `880f1c4f`.
  The check reads it with `git show`; no other worktree changes.
- Node adds a wall-time Date header outside the service clock.
  The check validates that date and compares all other headers exactly.
  It compares body bytes, including seeded IDs, and full call logs.
- The allowed paths rule bars changes to `src/errors.ts`.
  Service error kinds will live beside their wire maps.
  Operations use Core's managed `ctx.raise` from ADR 0067.
- Existing tests already prove all public failure routes.
  The wire check adds old-code proof before the refactor.
- The board already has this card in Doing, with its owner and proof.
  The allowed paths rule bars edits to `TODO.md`.

### Step 1: wire check

The same-code check passed: exit 0, zero differences.
It compared 2,130 calls and all 30 error codes.
Log: `tools/flight-trial/scripts/logs/wire-same-busy.log`.
The quote-limit case uses the real ICN to NRT fixture route.
The earlier route also passed: 7,426 calls, zero differences.
Its log is `tools/flight-trial/scripts/logs/wire-same.log`.
The check still fills the full 65,536-quote limit through HTTP.
Build, check, and prose passed with exit 0.
Check has zero errors and the existing 28 warnings.
Logs: `wire-build.log`, `wire-check.log`, and `wire-prose.log`
under `tools/flight-trial/scripts/logs/`.

The two new boundary tests fail against old operations.
They find whole wire inputs and HTTP replies inside the graph.
Red proof: `tools/flight-trial/scripts/logs/protocol-red.log`, exit 1.
Next: move validation and reply mapping to Hono.

### Step 2: protocol owns both directions

Hono validates bodies, unwraps supplier envelopes, and settles one operation.
Operations return domain values or raise a managed error kind.
One table per service maps kinds to status and the existing wire body.
Control failures on payment still use the old Duffel error body.
Thrown handlers still reach Hono, keep call status zero, and never seed a replay.
Route and payment key operations return replay facts, not built replies.
Hono reads and sends the saved wire snapshots.
The signed webhook resource owns the outgoing Stripe body and signature.
Its stream returns each delivery's status to the call log in the old order.

The error-map resource needs `target: "session"`.
Its bindings belong to each service's owned session, not the root.
The first test run caught that missing binding; the fixed run passes.

Build and check: exit 0; check has zero errors and the same 28 warnings.
All 98 flight-trial tests pass: exit 0.
The two tests that failed before the change now pass.
Source check: 31 operations, no built wire replies in operations.
Plain helpers: 6 before, 3 after.
The two permitted process entries stay at 2.
Logs under `tools/flight-trial/scripts/logs/`:
`step2-build.log`, `step2-check.log`, `step2-test.log`,
and `step2-protocol.log`.
Next: full old-versus-new wire proof, workspace gates, and locked mutation.

### Jev and allowed paths

Jev preflight, tests, and promises each exited 0.
Logs: `final-jev-preflight.log`, `final-jev-tests.log`,
and `final-jev-promises.log`, under `tools/flight-trial/scripts/logs/`.
The test judge flagged zero of 98 titles.
Eight source labels are false, with a reason for each.
Their exact sliced code and reasons are in `PROTOCOL-JEV.jsonl`.
The flagged clock, socket, and pending-key state is private resource bookkeeping.
Running webhook work watches both stop and operation signals.
The listener drains owned replies before closing sockets.
The middleware factory itself is synchronous.
The noisy `noOpRejected` note on repeated payments owes no label.

The allowed paths rule bars edits to `tools/jev/cases.jsonl`.
A copy of the label CLI changes only its bank path and import paths.
It saves these labels in this track instead of the shared bank.
Log: `tools/flight-trial/scripts/logs/final-jev-labels.log`, exit 0.
The lead can import them and run shared calibration at landing.
No Jev rule changed.

The promises judge reports eight README-only gaps.
These are the two new boundary promises and six old routing guarantees.
They are stated in the allowed `services/PLAIN.md`, under Protocol checks.
The brief bars changing the package README.
`PROTOCOL-JEV-PROMISES.json` records one reason per title.
The fixed base for review is `880f1c4f`; shared main moved during this task.
No shared main files were edited.
Core feedback: no new request or workaround.

### Full wire and workspace proof

Old-versus-new wire diff: exit 0, zero differences.
It compared 2,130 calls and all 30 error codes.
Log: `tools/flight-trial/scripts/logs/wire-diff.log`.
The same-code proofs also exited 0 with zero differences.
No source changed after the new-code wire run started.

The workspace gate chain exited 0.
Build, check, every package's own test task, four-process proof,
source check, strict style, prose, and validation all passed.
The check has zero errors and the same 28 warnings as the base.
Validation passed all 16 lanes.
The four-process proof saw four distinct PIDs and clean group shutdown.
Logs under `tools/flight-trial/scripts/logs/`:
`final-build.log`, `final-check.log`, `final-tests.log`,
`final-process.log`, `final-protocol.log`, `final-style.log`,
`final-prose.log`, and `final-validate.log`.
The follow-up doc prose gate passed: `proof-prose.log`, exit 0.
The workspace already sets the required esbuild build permission.
No temporary workspace config edit was needed.
Next: full mutation under the lock, floor 85, no exclusions.

### Final mutation and handoff

Full mutation passed: 89.74 percent, exit 0.
It ran alone under `flock /tmp/mutation.lock`.
The floor stays at 85 and the config matches the fixed base byte for byte.
All nine source files and all 1,676 cases remain included.
All 399 static cases remain included.
No case was ignored; there were no compile or runner errors.
Counts: 1,360 killed, 144 timeouts, 140 survivors, 32 without coverage.
The Stryker score includes timeouts as detected cases.
Log: `tools/flight-trial/scripts/logs/mutation.log`.
Full report: `tools/flight-trial/scripts/logs/mutation-report.json`.
Counts, file scores, and source hashes: `PROTOCOL-MUTATION.json`.
Each gate's command, exit code, and log path: `PROTOCOL-GATES.json`.
No source or test changed after the passing gates and mutation run.

Status: Review.
The lead owns the board update, shared Jev-bank import, and landing.
Nothing was pushed.
No app, Core, React, writer-trial file, or container was changed.
No stash was used.
The only differences from the brief are the allowed-path choices above:
local Jev labels, protocol promises in PLAIN, and service-local error maps.
Node's wall-time Date header is checked separately from the service clock.

### Lead fix round: wire replay and clock wake

Owner: services-protocol writer.
Next: finish the three requested fixes, one commit each.
Verify: every gate exits 0; full locked mutation meets floor 85.
Assumption: use the fixed base `880f1c4f` for every old-code proof.
The lead owns landing and the board update.

The wire proof now saves a supplier order and replays it twice.
The next order must report sold out, proving the repeat count ran out.
Payment rule replay uses `Idempotency-Key` on both repeated calls.
After the rule runs out, the saved key replays and a fresh key creates an intent.
Both services also wait on a delayed rule, then wake through `/control/clock`.
The proof compares pending and completed call logs as well as reply bytes.

Fix 1 wire diff: exit 0, zero differences across 2,160 calls and 30 error codes.
Log: `tools/flight-trial/scripts/logs/review-fix1-wire.log`.
Build, check, and prose each exited 0.
Logs: `review-build.log`, `review-fix1-check.log`, and `review-fix1-prose.log`.
The new cases reached both saved-reply paths and both clock wakes.

### Lead fix round: missing order kind

`readOrder` now raises `UnknownOrder`.
The supplier map keeps its old `not_found` code and 404 status.
Unknown routes still use `NotFound`.
Build, all 98 service tests, and the operation check exited 0.
Logs: `review-fix2-build.log`, `review-fix2-test.log`,
and `review-fix2-protocol.log`, under `tools/flight-trial/scripts/logs/`.
Next: full wire and workspace gates, then mutation alone under the lock.

### Lead fix round: checked error maps and full plain count

The operation check reads each service's bound error table and shared kinds.
Each literal raised kind must have a row in its own service's table.
Shared operations must have rows in both service tables.
A raised kind that cannot be read statically also fails the check.
The plain count now includes top-level arrow and function values,
including exported values, as well as named function declarations.
The real count stays at 6 before and 3 after; process entries stay at 2.

The planted proof edits only a temporary copy under the script logs.
Missing supplier, payment, and shared kinds each fail with exit 1.
A dynamic raise, a top-level arrow, and an exported function also fail.
All six failures are expected; the clean copy exits 0.
The planted-proof gate exits 0.
Build, check, and the operation check also exit 0.
Logs under `tools/flight-trial/scripts/logs/`:
`review-fix3-build.log`, `review-fix3-check.log`,
`review-fix3-protocol.log`, and `review-planted.log`.
Next: rerun every final gate, then full locked mutation.

### Lead fix round: final proof and handoff

All three requested fixes are saved in separate commits:
`6d513386`, `7fac8477`, and `a7966569`.
The final gate chain exits 0.
All nine package test tasks pass, with 1,211 Vitest tests passed.
The existing skipped workspace test stays at one.
All 98 service tests pass.
The four-process proof sees four distinct PIDs and clean shutdown.
Check has zero errors and the same 28 warnings.
Validation passes all 16 lanes.
The strict style check passes.
Jev's file and test flags stay at zero.
The saved source labels and eight README gap reasons still apply.

Both final wire proofs exit 0 with zero differences.
Each compares 2,160 calls and all 30 error codes.
The old-versus-new run includes the `UnknownOrder` change.
The same-code run includes all new replay and clock-wake cases.
Logs: `review-wire-diff.log` and `review-wire-same.log`,
under `tools/flight-trial/scripts/logs/`.
The plain count, including top-level arrow and function values, stays at 6 to 3.
The six planted faults each exit 1 as expected; the clean copy exits 0.
Log: `tools/flight-trial/scripts/logs/review-final-planted.log`.

Full mutation exits 0 at 87.13 percent, above floor 85.
It ran alone under `flock /tmp/mutation.lock` after the other jobs finished.
All 1,678 cases, including all 401 static cases, stayed included.
The config matches `880f1c4f` byte for byte.
No case was ignored; there were no compile or runner errors.
Counts: 1,396 killed, 66 timeouts, 184 survivors, 32 without coverage.
The score includes timeouts as detected cases.
The full report's source text matches every current file with cases.
Log: `tools/flight-trial/scripts/logs/review-mutation.log`.
Full report: `tools/flight-trial/scripts/logs/review-mutation-report.json`.
`PROTOCOL-MUTATION.json` holds counts, scores, and source hashes.
`PROTOCOL-GATES.json` holds each final command, exit code, and log path.

Status: Review.
Next: the lead lands the saved fixes.
No source or test changed after the final gates or mutation run.
No new Core feedback, app change, push, or stash.

## S24 on, 2026-10-04

Card: `trial/s24-on`.
Owner: Sol writer; lead owns review and landing.
Branch: `trial/s24-on`, from `5166969a`.
Next: prove the new message and scaffold exception red, then green.
Verify: Jev tests, writer-trial tests, check, prose, and validate exit 0.

Assumption: the brief's path limits override board edits.
The existing Doing card in `TODO.md` stays with the lead.
Assumption: exempt only `src/scaffold/http-backend.ts` from S24,
including that path below a repo or app root.
The older suites keep their current fetch checks.
Frozen trial files stay unchanged; no trial refresh is part of this card.
No live trial folder or container is read or changed.

The scaffold exports `httpRequest` from `src/scaffold/backend/http.ts`.
Its caller depends on `httpRequest.controller` and runs that controller.
The input has `url` and `method`; headers and body are optional.
The result has `status`, `headers`, and a text `body`.
The message will promise spans and cancel signals, as ADR 0102 does.
It will not promise retries, which this scaffold does not supply.

Initial workspace build: exit 0.
Log: `tools/writer-trial/.logs/s24-on/build-initial.log`.

### S24 step 1: message and backend exception

The app finding names `httpRequest.controller` and a filled-in GET call.
The exception matches only `src/scaffold/http-backend.ts` at a path end.
The shipped backend passes in writer mode and repo mode.
The existing fetch and global-fetch tests still pass.

Logs under `tools/writer-trial/.logs/s24-on/`:

- `red-message.log`: exit 1 on old code.
- `green-message.log`: exit 0 with the fix.
- `red-backend.log`: exit 1 on old code.
- `green-backend.log`: exit 0 with the fix.
- `build-plain.log`: exit 0.
- `jev-plain-step.log`: exit 0; all Jev tests pass.

Next: remove the flight skip and prove its gate blocks.

### S24 step 2: flight gate

Removed the suite filter from the broker.
The gate blocks a bare fetch in flight and all nine older suites.
The rule uses the Jev files from the supplied folder, as before.
No frozen trial file was read or changed.

Assumption: also fix the live flight rules and Jev README.
Their old fetch permission and removed-helper example contradicted S24.
The saved trials keep their earlier rule files.

Logs under `tools/writer-trial/.logs/s24-on/`:

- `red-flight-gate.log`: exit 1 with the flight skip.
- `green-flight-gate.log`: exit 0 without the skip.
- `build-gate-step.log`: exit 0.
- `writer-gate-step.log`: exit 0; 91 tests pass.
- `check-gate-step.log`: exit 0; 28 warnings, no errors.
- `prose-gate-step.log`: exit 0.

Step 1's first check found formatting and too many branches.
The format and shared app-path test fixes passed the next check.
Logs: `check-plain-final.log` and `jev-plain-final.log`, exit 0.
No failed check is claimed as a main defect.

Next: run the full workspace tests and validation, then save proof.

### S24 final proof and handoff

Status: Review; the lead owns review and landing.
The writer did not push.

Code commits:

- `a92a85fe`: S24 message, fix line, backend exception, and Jev tests.
- `47b953e3`: restore the flight gate and update its live rules.

The final gate chain exited 0.
Logs under `tools/writer-trial/.logs/s24-on/`:

- `final-build.log`: `vp run -r build`, exit 0.
- `final-check.log`: `vp check`, exit 0; no errors, 28 warnings.
- `final-jev-tests.log`: `vp run jev#test`, exit 0; 146 tests.
- `final-writer-tests.log`: writer-trial tests, exit 0; 91 tests.
- `final-prose.log`: `vp run prose`, exit 0.
- `final-validate.log`: `pnpm validate`, exit 0; all 16 lanes.
- `final-gate-chain.log`: the chain and its exit 0.
- `build-workspace.log`: build before all workspace tests, exit 0.
- `workspace-tests.log`: `vp run -r test`, exit 0; nine tasks.
- `jev-preflight.log`: advisory preflight, exit 0; no flags.
- `scope.log`: branch, path limits, and workspace config, exit 0.

All three changed test promises have red and green proof:

- Flight app finding and its `httpRequest.controller` fix:
  `red-message.log`, exit 1; `green-message.log`, exit 0.
- Scaffold built-in fetch backend exception:
  `red-backend.log`, exit 1; `green-backend.log`, exit 0.
- Flight gate blocks bare fetch, as every older suite does:
  `red-flight-gate.log`, exit 1; `green-flight-gate.log`, exit 0.

The first two red tests ran before changing Jev.
The gate red test ran before removing the broker's flight skip.
The final full suites also pass all three tests.

Assumption: pin preflight to `5166969a..HEAD`, the assigned base.
The shared main branch moved while this writer worked.
Preflight reads changed TypeScript files; none changed here.
Its package test judges read TypeScript package tests,
so they do not apply to these `.mjs` test files.
No flags need labels.

The workspace already allows esbuild for validate.
No config edit was needed.
Core feedback: none; this card needed no Core workaround.

### S24 review round: exact paths and unused suite

Owner: Sol writer; lead verdict READY with one fix round.
Next: tighten the backend exception, then drop unused suite arguments.
Verify: red and green path proof, Jev tests, writer tests, check, and prose.

Assumption: fixes 1 and 2 are one bug fix with its test.
They land together so the commit keeps the tests green.
Fix 3 is a separate cleanup commit.
It changes no behavior and uses the existing writer tests.
No test is added just to check an unused argument.

The new path test fails on `apps/other/src/scaffold/http-backend.ts`.
The old regex wrongly exempts that app.
Log: `tools/writer-trial/.logs/s24-on/review/red-scaffold-paths.log`, exit 1.
The backend test now also covers `/work/src/scaffold/http-backend.ts`.

The exact three-path regex now passes the new regression test.
The backend test passes for relative, `/work/`, and Start repo paths.
Jev tests: 147 pass, exit 0.
Check: exit 0; no errors and the same 28 warnings.
Prose: exit 0.
Logs under `tools/writer-trial/.logs/s24-on/review/`:
`green-scaffold-paths.log`, `jev-paths.log`,
`check-paths.log`, and `prose-paths.log`.

### S24 review round: cleanup and final proof

Path fix and regression test saved in `16ffd233`.
Removed the unused suite argument from the broker and folder reader.
Removed it from the saved-check and reference-runner callers too.
The gate test now calls the shared policy once, without a suite argument.
No suite can pick a different policy through this function.

Final gate chain: exit 0.
Logs under `tools/writer-trial/.logs/s24-on/review/`:

- `final-build.log`: build, exit 0.
- `final-check.log`: check, exit 0; no errors, 28 warnings.
- `final-jev-tests.log`: Jev tests, exit 0; 147 pass.
- `final-writer-tests.log`: writer tests, exit 0; 91 pass.
- `final-prose.log`: prose, exit 0.
- `final-chain.log`: the chain and its exit 0.
- `callers.log`: remaining call sites, exit 0.
- `red-scaffold-paths.log`: new test before the fix, exit 1.
- `green-scaffold-paths.log`: path and backend tests after it, exit 0.

Status: Review; the lead owns landing.
The final docs and reference caller get one last build, check, and prose pass.
Logs: `proof-build.log`, `proof-check.log`, and `proof-prose.log`.

## Reference 0102, 2026-10-04

Card: `trial/reference-0102`.
Owner: Sol writer; lead owns the board and landing.
Next: copy today's scaffold, then port calls and replies.
Verify: plain and S24 green; new images; all rounds twice and breaks.

Assumption: the brief permits this progress file and reference docs.
Other shared docs and the Start README stay with the other writer.
No questions, push, stash, or older trial changes.
The assigned base is `6e254446`.

Initial build: exit 0.
Logs live in `tools/writer-trial/.logs/reference-0102/`.
The first plain run had no reference package links and exited 1.
Log: `red-plain.log`.
Added private local package links, then reran before changing source.
Log: `red-plain-linked.log`, exit 1.
Jev S24: 10 hits, exit 1, including old scaffold telemetry calls.
Log: `red-s24.log`.
Next: restore starter bytes and keep the round features.

### Reference step 1: starter copy

Copied today's scaffold byte for byte.
Updated starter-owned auth, transport, server, UI, config, and scripts.
Kept the flight round changes in the open feature files.
Build and workspace check: exit 0.
Logs: `starter-build.log` and `starter-check.log`.
Scaffold diff: exit 0, empty; log: `starter-diff.log`.
The feature calls still need the port before the full gate can pass.

### Reference step 2: HTTP and search port

Supplier and payment calls now use `httpRequest.controller`.
Each call maps its reply to a domain value or managed error.
Assumption: a 409 hold means OfferSoldOut; a 409 supplier payment needs refund.
Other rejected service calls raise ServiceRejected with the service name.
No status code leaves these call operations.
The webhook returns accepted; the route owns its 200 or 400 reply.

Browser writes now use server functions with `.validator`.
Search copies the sync stream's SSE framing and EventSource queue shape.
Each search has a version so an old reply cannot end the new search.
The app's old routes and packet reply shapes stay available.
Regenerated PLAIN: 17 functions, cap 17.

Plain, S24, app build, types, and three behavior tests: exit 0.
Logs: `green-plain.log`, `green-s24.log`, `port-app-build.log`,
`port-types.log`, and `port-tests.log`.
The supplier-value test fails with the old wire-shaped return: exit 1.
Log: `red-domain-reply.log`; source restored before the green runs.
The first style run included generated router comments and exited 1.
Strict style on authored source and tests: exit 0.
Log: `green-style.log`; the generated file stays router-owned.
Build and workspace check: exit 0.
Logs: `port-build.log` and `port-check.log`.
Next: save the port, build images, then prove every round.

### Reference step 3: proof test boundary

The first workspace test run exited 1.
The services package picked up the new reference test under its own config.
Log: `workspace-tests.log`.
Renamed the app-only file to `flight-http.proof.ts`.
The reference config includes this pattern; the services config does not.
The full gate copies this config and the proof tests into its app container.
Build, all nine workspace test tasks, and the three reference tests: exit 0.
Logs: `proof-build.log`, `green-workspace-tests.log`,
and `green-reference-tests.log`.

Jev preflight: exit 0; no file flags, 18 unit findings across 13 units.
Log: `jev-preflight.log`.
Saved all 18 labels as false, with exact source and a reason per judge.
The source already owns cancellation, settings, and private stream state.
Most remaining findings point at the exact starter copy.
Labels: `REFERENCE-0102-JEV.jsonl`.
The path limit bars the shared Jev bank; the lead can import at landing.
The label CLI copy changes only imports and its bank path.
Log: `jev-labels.log`, exit 0.
Test quality and README promises each have zero findings, exit 0.
Logs: `jev-tests.log` and `jev-promises.log`.
The later file rename changes no test titles or promises.
Writer harness tests: 91 passed, exit 0; log: `writer-tests.log`.
Next: finish image saves and the full round proof.

### Reference step 4: webhook input

The webhook route now validates the wire event and checks its signature.
The booking operation receives only paymentId, amount, and succeeded.
This completes both directions of ADR 0103 at the route.
Build, plain, types, and workspace check: exit 0.
Logs: `webhook-build.log`, `webhook-plain.log`,
`webhook-types.log`, and `webhook-check.log`.
The full round proof uses these final source bytes.
Next: finish that proof and save the image pins.

### Reference step 5: images and Vitest 5

Prepared a new writer image and built services through the named image script.
Each image has a saved tar and an idle keeper.
The old trial and its pins stay untouched.
The first round proof passed teacher, scaffold, plain, and Jev, but own tests failed.
Vitest 5 could not write its API token on the read-only image.
Red log: `rounds/round-1/pass-1/own.log`, check and test exits 1.
The first round result and top-level proof exit 1 are saved under `rounds/`.

The image now links `node_modules/.vitest` to writable `/tmp`.
No host file or shared service changed.
The new tag is `tinker-writer-flight:20261004.reference-0102.2`.
The standalone services tag is `tinker-flight-services:20261004160855439`.
The prepare path's services copy has the same image ID as that standalone build.
The first new tag stays saved as the red evidence; no image was removed.

Build, check, and read-only HTTP tests: exit 0; 20 HTTP tests passed.
Logs: `vitest-image-build-workspace.log`, `image-check.log`,
and `green-readonly-vitest.log`.
Image builders: exit 0.
Logs: `image-build.log`, `services-image-build.log`, and `image-build-2.log`.
The first validate run caught an unformatted image config and exited 1.
Formatted it; all 16 validate lanes now pass, exit 0.
Logs: `validate.log` and `green-validate.log`.
The final round and isolation proofs use the new writer image.
Next: finish all rounds, then save their exits and logs.

### Reference workspace proof saved

The final gate chain exits 0; all 15 named checks pass.
Build ran before checks that read package output.
Workspace check has zero errors and the same 28 warnings.
All nine workspace test tasks pass.
All 91 writer tests and three reference tests pass.
Plain: 17 helpers, cap 17; S24: zero hits; scaffold diff: empty.
Prose, strict authored-source style, types, and all 16 validate lanes pass.
Final test quality and README promises: zero findings.
The promises CLI copy changes only the path and `.proof.ts` title match.
The shared tool accepts package tests named `.test.ts` only.
The webhook Jev follow-up has zero findings across four operations.

Each command, exit, and log is in `REFERENCE-0102-GATES.json`.
That file also pins all four image IDs, tars, keepers, and source hashes.
Fresh final-image isolation exits 0, including private controls and host ports.
Proof containers, networks, and the test volume were removed.
Log: `final-isolation.log`.
Round 1's first full gate is green; the later checks still run.
The round proof stays running in the saved proof file until every row is seen.
Core feedback: none; the Vitest token issue was trial image setup.
Next: finish both passes and the named break for all five rounds.

### Reference step 6: supplier request settings

The first final-image run passed rounds 1 and 2 twice, with named breaks.
Round 3 then failed price-change and seat-race checks.
Own, scaffold, plain, and Jev stayed green; teacher exited 1.
Red log: `rounds-green/round-3/pass-1/teacher.log`.

The supplier URL resource had the default root owner.
Its flightSettings binding lives on the request, so it raised MissingTag.
Changed the existing supplier test to bind settings on the call.
That test fails before the fix, exit 1; log: `red-call-settings.log`.
The resource now has `target: "session"`.
The same three tests pass, exit 0; log: `green-call-settings.log`.
Build and check exit 0; logs: `call-settings-build.log` and `call-settings-check.log`.
This was an owner choice in the reference, not a missing Core feature.
The final proof file stays running; old round rows do not prove the fixed source.
Next: prove round 3 and probe payment, then rerun all final rounds.

### Reference step 7: JSON replies from the server

Round 3 passed twice after the request settings fix.
Its planted price-check break failed by the named teacher case.
Log: `round-3-fixed.log`, harness exit 0.

The payment probe then failed JSON route and webhook checks with HTTP 500.
Own, scaffold, plain, and Jev passed; teacher exited 1.
Red log: `round-4-probe/round-4/pass-1/teacher.log`.

Copying the starter server had dropped the reference's existing
`overrideGlobalObjects: false` setting.
Hono replaced Response; TanStack could no longer match JSON replies.
Restored that setting from the base reference.
Assumption: this is a round change, so the brief allows keeping it.
The teacher's payment and webhook cases are the regression proof.
The fixed payment full gate passed, exit 0.
Green log: `rounds-final-b/round-4/pass-1/teacher.log`.
Every payment, signature, expiry, and refund case passed.
Build and check also pass, exit 0; logs: `release-build.log`
and `release-check.log`.

A later workspace test run hit a supplier startup timeout, exit 1.
Logs: `release-tests.log` and `release-tests-serial-2.log`.
The same two entry tests pass alone, exit 0.
Log: `supplier-entry-probe.log`.
The final rerun uses one Vitest worker, without changing service source.
Jev preflight exits 0, with no file flags and 17 unit findings.
The prior labels cover all unchanged units; saved the new supplier source label.
Logs: `release-jev-preflight.log` and `release-jev-labels.log`.
Next: finish both final passes, each named break, and the workspace rerun.

### Reference final workspace rerun

The fresh build and normal workspace tests pass, exit 0.
All nine tasks pass without a worker override.
Logs: `retest-build.log` and `retest-workspace.log`.
No host build ran during these tests.
The one-worker retry exited 1; its later import error overlapped
with validate rebuilding Core.
Log: `release-tests-one-worker.log`.
The startup failures remain saved, with the later green result.

Every release gate now exits 0, including all 16 validate lanes.
Logs and commands: `release-gates.json` under the named log folder.
The final source has no new check warnings.
Next: finish the round proof, then update the saved gate file.

### Reference final rounds 1 and 4

Rounds 1 and 4 each pass the full gate twice, exit 0.
Each planted break exits 1 and fails its named teacher case.
Both round harnesses finish with exit 0.
Logs: `final-round-1.log` and `final-round-4.log`.
Round 4's signature break also fails own check, exit 1.
Its teacher still rejects the named signature case, so the proof is valid.
All other exits are saved in each result.json.

The shell driver tried to reuse a frozen proof folder for the next round.
The runner refused before starting any app; driver exit 1.
Logs: `driver-round-2-red.log` and `driver-round-5-red.log`.
No frozen proof changed.
The remaining rounds use a new folder per round.
Next: finish rounds 2, 3, and 5, then save all 15 results.

### Reference final rounds 2 and 5

Rounds 2 and 5 each pass the full gate twice, exit 0.
Each planted break exits 1 and fails its named teacher case.
Both round harnesses finish with exit 0.
Logs: `final-round-2.log` and `final-round-5.log`.
Round 3's first final full gate also passes, exit 0.
Its last two runs remain in progress.
Next: save the complete proof once those runs finish.

### Reference 0102: final proof complete

All five final rounds pass the full gate twice, exit 0.
All five planted breaks exit 1 and fail the named teacher case.
Each round harness finishes with exit 0.
Round 3's final log: `final-round-3.log`.
The complete rows, exits, and logs are in `REFERENCE-0102-GATES.json`.
They include each named failure and its actual error.
The audit checks all 15 results, all frozen inputs, all image IDs,
and all 139 saved source hashes; exit 0.
Log: `final-audit.log`.

Final plain: exit 0, 17 helpers, cap 17.
Final S24: exit 0, zero hits.
The scaffold diff is empty, exit 0.
Build, check, all nine workspace test tasks, 91 writer tests,
and three reference tests pass, exit 0.
Types, style, test quality, README promises, and prose pass, exit 0.
All 16 validate lanes pass, exit 0.
Fresh-image isolation and final image pins pass, exit 0.
The writer and services tar files and keepers still match their IDs.

Jev labels: 19 saved false labels with reasons.
Eighteen match current source; one records the earlier supplier resource.
The lead imports the track bank and calibrates at landing.
The path limit barred editing the shared bank.
The promises CLI copy covers the reference's `.proof.ts` files.
The preserved server setting is the brief's allowed round change.
No mutation or timing lane was asked for.
Core feedback: none.
The branch is ready for lead review; nothing was pushed.
Next: lead review, import the labels, then land through the normal gates.

## DeepSeek trial 2, 2026-10-05

Card: `trial/deepseek-02`.
Trial `flight-deepseek-02`, graded from a runner pinned at `77c7ba97`.
Writer: `pi/writer-gateway/deepseek/deepseek-v4.1-flash`, thinking high.
Images: app `bb97e63c`, services `1be10fb5`.
The packet is the same as trial 1.
The retry rule is the same: one teacher note a try, up to 3 tries a round.

- Round 1, try 1 (agent `6cc7c692`): fail, hidden checks 1 of 3.
  Cost about $1.36.
  Own checks, `check:plain` (17 of 17), the seam check, and Jev passed.
  Empty route: `No flights` was a row of the Flights table.
  Supplier failure: `Search complete` was never shown.
  Packet lines 30 to 32 tripped trial 1 the same way.
  The packet stays as it is until this trial ends.
- Round 1, try 2 (agent `ca54c3df`): **pass**, hidden checks 3 of 3.
  Cost about $0.10.
  `Search complete` now shows beside the outcome line,
  and `No flights` is a notice, not a table row.
- Round 2, try 1 (agent `53651551`): **pass**, hidden checks 6 of 6.
  Cost about $0.26.
  Harness note: the `tinker-seams` skill says to import `httpRequest`
  from `src/lib/tinker.server.ts`.
  That made an import loop, so `httpRequest` was undefined at start.
  DeepSeek used `@/scaffold/backend/http`, as GUIDELINES says.
  Fix the skill text after this trial.
- Round 3, try 1 (agent `fbeaf7eb`): **pass**, hidden checks 10 of 10.
  Cost about $0.41.
  Jev blocked one dropped run failure (S22); DeepSeek fixed it with `settle`.
  Its last-seat race test runs a small local supplier,
  because only the teacher may set real stock.
- Round 4, try 1 (agent `e5afd240`): **pass**, hidden checks 17 of 17.
  Cost about $0.39.
  Trial 1 needed 2 tries here (a double-pay race and a Pay button
  left on expired holds); trial 2 passed both on the first try.
  Jev blocked a 200 ms timer in a test; DeepSeek made the test drive the event.
- Round 5, try 1 (agent `f96bfb12`): **pass**, hidden checks 21 of 21.
  Cost about $0.34.
  One confirmation mail per paid booking; a failed send keeps the booking
  confirmed, marks the email Failed, and offers a retry.

### Result

- Baseline (first try only): **0**. `score.json` keeps it.
- With one teacher note a round: **all 5 rounds pass**, in 6 tries.
  Round 1 needed a second try; rounds 2 to 5 passed first try.
- Writer cost: about $2.87 for all 6 tries.
- Writer time: about 4 hours 52 minutes of agent work.
- Own checks, `check:plain` (17 of 17), the seam check,
  and Jev passed on every saved try.

### Trial 1 and trial 2

Same packet, same writer model, same retry rule.
Trial 2 runs on the ADR 0102 and 0103 images.

- Baseline: 0 and 0.
- Rounds passed with retries: 5 and 5.
- Tries: 7 and 6.
- Cost: $1.96 and $2.87.
- Agent time: about 3 hours 38 minutes and 4 hours 52 minutes.
- Round 1: both failed try 1 on packet lines 30 to 32, then passed.
  Trial 2's try 1 cost $1.37: DeepSeek chased test crashes
  caused by its own leftover dev servers in the 2 GiB sandbox.
  Without that, trial 2 costs about the same as trial 1.
- Round 3 took 82 minutes, against 29 in trial 1.
- Round 4: trial 1 needed 2 tries (a double-pay race,
  and a Pay button on expired holds). Trial 2 passed first try.
- Failure kinds in trial 2: only the packet's notice lines.
  No app bug reached the hidden checks.

Harness lessons for `trial/round-lessons`:

- Packet lines 30 to 32 are unclear; both trials tripped on them.
- Leftover servers fill the 2 GiB sandbox; tell writers to stop them.
- The `tinker-seams` skill names an import path that loops.
- The full test run is longer than the writer's 120 s shell limit.
- Only the teacher may set stock, so race tests need a local supplier.

## Round lessons, 2026-10-05

Card: `trial/round-lessons`.
Writer branch: `trial/round-lessons`.

### Changes

- Round 1: Search complete stays beside each outcome.
  The asked supplier must have answered or failed.
  No flights is a notice outside the Flights table.
- Round 2 repeats that notice rule for three suppliers.
  Rounds 3 to 5 inherit it and have no conflicting notice text.
- GUIDELINES says to stop servers before tests.
  It names the 2 GiB memory limit.
  Test-owned servers must close in cleanup.
- `extension.mjs` caps every shell call at 120 seconds.
  `broker.mjs` runs each call through timeout.
  GUIDELINES names the full test run inside npm run check.
  It runs vp check and npm run typecheck alone.
  Then it runs tests file by file.
  It names test:seam, test:boundary, and test:schema.
  Every shipped and added test file must run.
  Chunks run one at a time; each exit code must pass.
- Tests may run a local HTTP supplier for race, failure, and slow replies.
  It may use its own stock.
  They call exported app operations and close the supplier.
  App code and tests may never use the supplied /control/ routes.
  Only the teacher changes the supplied services.
- Three skills now use `@/scaffold/backend/http` for httpRequest.
  The other two were tinker-forms and tinker-feature.
  Fixing only tinker-seams would leave the same bad advice.
- `flight-import.test.mjs` bundles the real scaffold HTTP operation.
  Its small feature exports through a server barrel.
  The old path loops back to the feature and fails at initialization.
  The direct path loads with exit 0.
  Restoring the old advice makes the test fail with exit 1.
- GUIDELINES fell from 6,604 to 5,178 bytes.
  That is 1,426 fewer bytes, or 21.6%.
  Repeated text is shorter; code and test details point to app skills.
  The writer now reads skills for the work it changes.
  TASK stays cumulative so earlier requirements stay in view.
- PLAIN.md is read only when check:plain fails.
  The writer copies the row that check:plain prints.
- The registry was rebuilt from the three changed skills.
  Its starter.json now ships the direct HTTP import.
- Read the teacher round 1 and 2 checks again.
  They still match completion beside rows, empty results, and failures.
  Empty results have no Flights data rows.
  Round 2 keeps good rows when another supplier fails.
- Hidden teacher files stay unchanged.

### Read counts

Read all 13 native pi sessions: seven tries in trial 1, six in trial 2.
Matched their session IDs to saved tries without changing either trial.
[Top files and totals](round-lessons-reads.json).
The summary holds one command to rebuild it.
The per-try counts below stay unchanged.
[Read counter](../../../tools/writer-trial/read-counts.py).

- Counts cover explicit work_shell cat, sed, and rg file requests.
- Globs and the loop that reads all skills are expanded.
- Bytes are read counts times file sizes in each saved archive.
- Partial reads still have a full-file weight.
- Files edited during a try use their final saved size.
- These are requested-byte estimates, not bytes delivered by the shell.
- Pipes, missing files, unresolved paths, and other readers are excluded.
  That includes grep, dependency files absent from archives, and temp logs.
- Estimated file-read tokens use four bytes per token.
  This is not the provider tokenizer or a price estimate.

Per-try counts (R means round; T means try):

#### Trial 1

- **R1 T1** — file requests: 98.
  Files: 85.
  Requested bytes: 307,914.
  Doc bytes: 52,555.
- **R1 T2** — file requests: 29.
  Files: 23.
  Requested bytes: 122,701.
  Doc bytes: 26,197.
- **R2 T1** — file requests: 46.
  Files: 40.
  Requested bytes: 226,274.
  Doc bytes: 50,200.
- **R3 T1** — file requests: 86.
  Files: 70.
  Requested bytes: 387,456.
  Doc bytes: 36,567.
- **R4 T1** — file requests: 88.
  Files: 67.
  Requested bytes: 825,576.
  Doc bytes: 32,327.
- **R4 T2** — file requests: 39.
  Files: 30.
  Requested bytes: 460,855.
  Doc bytes: 33,275.
- **R5 T1** — file requests: 57.
  Files: 50.
  Requested bytes: 488,172.
  Doc bytes: 40,036.

Docs take 9.6% of estimated file-read tokens.

#### Trial 2

- **R1 T1** — file requests: 100.
  Files: 85.
  Requested bytes: 363,577.
  Doc bytes: 61,256.
- **R1 T2** — file requests: 35.
  Files: 32.
  Requested bytes: 112,088.
  Doc bytes: 46,041.
- **R2 T1** — file requests: 51.
  Files: 42.
  Requested bytes: 503,202.
  Doc bytes: 62,611.
- **R3 T1** — file requests: 96.
  Files: 76.
  Requested bytes: 412,136.
  Doc bytes: 74,442.
- **R4 T1** — file requests: 86.
  Files: 75.
  Requested bytes: 391,575.
  Doc bytes: 33,505.
- **R5 T1** — file requests: 96.
  Files: 76.
  Requested bytes: 474,046.
  Doc bytes: 58,715.

Docs take 14.9% of estimated file-read tokens.

#### Top repeated docs

- **`PLAIN.md`** — seen in 13 tries.
  Requests: 18.
  Requested bytes: 136,284.
  Estimated tokens: 34,071.
  Share of estimated file-read tokens: 2.69%.
- **`GUIDELINES.md`** — seen in 13 tries.
  Requests: 13.
  Requested bytes: 85,103.
  Estimated tokens: 21,276.
  Share of estimated file-read tokens: 1.68%.
- **`SERVICES.md`** — seen in 13 tries.
  Requests: 13.
  Requested bytes: 74,464.
  Estimated tokens: 18,616.
  Share of estimated file-read tokens: 1.47%.
- **`AGENTS.md`** — seen in 13 tries.
  Requests: 14.
  Requested bytes: 68,366.
  Estimated tokens: 17,092.
  Share of estimated file-read tokens: 1.35%.
- **`TASK.md`** — seen in 13 tries.
  Requests: 13.
  Requested bytes: 64,015.
  Estimated tokens: 16,004.
  Share of estimated file-read tokens: 1.26%.
- **`.agents/skills/tinker-forms/SKILL.md`** — seen in 7 tries.
  Requests: 7.
  Requested bytes: 89,389.
  Estimated tokens: 22,347.
  Share of estimated file-read tokens: 1.76%.

- Total file requests: 907.
- Total requested bytes: 5,075,572.
- Doc requested bytes: 607,727.
- Estimated doc tokens: 151,932.
- Docs take 11.97% of estimated file-read tokens.
- Native usage reports 167,269,732 total tokens.
  That includes cached and repeated context, plus model output.
  Introduced doc bytes divided by four are 0.091% of that total.
  This does not measure the doc share carried in later prompts.
  The logs do not tag billed tokens by source file.

PLAIN is the biggest repeated doc by requested bytes.
It holds the checked list of functions, so it stays intact.
The writer now reads it only to fix a check:plain failure.
GUIDELINES is read once in every try, so a shorter copy helps every round.
The forms skill is read in seven tries; the new advice loads only needed skills.
No shorter run or lower model cost is claimed before a fresh trial.

To rebuild the summary without changing trial files:

```bash
counter=tools/writer-trial/read-counts.py
sessions="$HOME/.pi/agent/sessions"
trials="$HOME/.local/share/tinker-writer-trial"
out=docs/roadmap/flight-trial/round-lessons-reads.json
python3 "$counter" --summary --sessions "$sessions" \
  --trials "$trials" > "$out"
```

### Image and frozen hashes

The registry puts the skills into the writer image.
GUIDELINES and packets are copied and hashed when a trial is created.
They are not baked into the writer image.
Saved trials keep their old image and frozen bytes.
[Full old and new hashes](round-lessons-hashes.json).

New trials change these frozen file hashes (12-character prefixes):

- `tasks/01-search.md`: `f956cf3a59c2` to `4d181d10683d`.
- `tasks/02-metasearch.md`: `aa616dab5ef7` to `5234cba98f7d`.
- `rules/flight-guidelines.md`: `be36f9610409` to `dfd91d6ea6c5`.
- `config.json` changes when the lead chooses the new writer image tag.

The three skill hashes change inside the new writer image:

- tinker-seams: `85d5057052ea` to `31553fdaf571`.
- tinker-forms: `540aed7d9943` to `919ec2b43310`.
- tinker-feature: `7aa076b0e4ba` to `78b334c71dbe`.

Skills are not individual entries in the trial's frozen file map.
The manifest pins the new writer image ID instead.
No teacher, service contract, extension, broker, or Jev bytes changed here.
Teacher hash stays `ef01fd5ede14`.
Skill text is outside the source/test maps in scaffold.json and starter.json.
These skill edits alone do not change either map.

The lead must pick a new tag; saved tags refuse rebuild.
Set `flight.image` in `tools/writer-trial/config.json` to:

```json
"tinker-writer-flight:20261005.round-lessons.1"
```

Keep `flight.servicesImage` at:

```json
"tinker-flight-services:20261004160855439"
```

Commit that tag before creating any trial:

```bash
git add tools/writer-trial/config.json
git commit -m "Pin round-lessons writer image" \
  -- tools/writer-trial/config.json
```

Then run:

```bash
vp run -r build
node tools/writer-trial/prepare.mjs \
  --suite flight --build --app-only
node tools/writer-trial/workers.mjs \
  create flight-round-lessons-01 --suite flight
node tools/writer-trial/workers.mjs \
  stage flight-round-lessons-01 1
```

This rebuilds only the writer image and saves its tar and keeper.
It leaves the service and dependency images as they are.
Create freezes the new packets and GUIDELINES.
Record the new image ID and config hash from that fresh manifest.
Then launch a fresh writer through Paseo as README says.
The lead still owes a first-try round 1 pass below trial 2's $1.46.
No image was built or published for this card.

### Proof

- `vp install`: exit 0 after each rebase.
- `vp run -r build`: exit 0.
- `vp check`: exit 0; 28 warnings, the same count as origin/main.
- `vp run -r test`: exit 0; all nine test tasks passed.
- `node --test tools/writer-trial/*.test.mjs`: exit 0; 92 tests passed.
- `node apps/start-scaffold/maintain/check-registry.mjs`: exit 0.
  The rebuilt registry installs with a changed lib alias.
  Its copied app build, types, tests, and seam checks pass.
- `vp run prose`: exit 0.
- `pnpm validate`: exit 0; all 16 size and other fixed checks passed.
- Jev preflight: exit 0; no flags or labels.
- Old skill advice: import proof exit 1.
- Fixed advice: import proof exit 0.

The optional readiness limits probe needs a live readiness worker.
Its worker.json was missing; that probe exited 1 before running a test.
It was not used as proof and no worker was started.
The full writer-trial test file set above passed.

No TypeScript source changed and no mutation lane was requested.
Core feedback: no new Core fault was found.
The card waits in Review for the lead's image and model run.

### Review fix round

- Rebuilt the registry with npm run registry:build in apps/start-scaffold.
  Only public/r/starter.json changed after formatting.
  It ships the fixed text for all three skills.
- The stale registry check failed with exit 1 before the rebuild.
  The rebuilt registry passed with exit 0.
- The first full test run exited 1 on a supplier start timeout.
  The registry check was running alongside it.
  All nine test tasks passed with exit 0 when run alone.
- Local suppliers now cover race, failure, and slow-reply tests.
- The full npm run check can exceed the shell limit.
  Run vp check and npm run typecheck alone, then each test file.
- The guide names check:plain, test:seam, test:boundary, and test:schema.
  It drops the worker setting and the root config wording.
- PLAIN.md is read only to fix a check:plain failure.
- Round 1 says the asked supplier.
  Both packets name rows, No flights, and the failure text.
- The read summary is 1,521 bytes and keeps top files and totals.
  The counter's --summary flag rebuilds it with the saved command.
  All per-try counts above stay unchanged.
- Updated the guide size and all changed file hashes.
  GUIDELINES is 5,178 bytes, 21.6% below the original 6,604.
- Commit the new writer image tag before any trial create.
  No image was built or published in this fix round.

### Round 1 rerun, 2026-10-05

Trial `flight-deepseek-03`, graded from a runner pinned at `8aff9d24`.
Image `tinker-writer-flight:20261005.round-lessons.1` (`90af992b`).
Services `1be10fb5`; teacher hash `ef01fd5ede14` (unchanged).

- Round 1, try 1 (agent `f7bd9ab6`): **pass**, hidden checks 3 of 3.
- Cost about $0.35, against $1.37 for trial 2's first try.
- Agent time 38 minutes, against 58.
- `Search complete` sits beside the outcome; `No flights` is outside the table.
- It imported `httpRequest` from the scaffold path on the first try.
- Every long command ran under `timeout 115`; no server was left running.
- Lost turns: a scratch Vitest browser-mode test, then deleted.

The card's goal is met: first try, under $1.46.

### DeepSeek trial 3, 2026-10-05

Same trial as the round 1 rerun: `flight-deepseek-03`, runner `8aff9d24`.
Round 1 passed first try ($0.35, 38 minutes).

- Round 2, try 1 (agent `935319d2`): **pass**, hidden checks 6 of 6.
  Cost about $0.22, in 13 minutes (trial 2: $0.26, 33 minutes).
  It ran each test file in its own call, as GUIDELINES now says.
- Round 3, try 1 (agent `7066c421`): fail, hidden checks 6 of 10.
  Cost about $0.30, in 37 minutes.
  All four round 3 checks passed.
  The `Hold` button sat inside the Seats cell, so four round 1 and 2
  table checks read `50Hold …` instead of `50`.
  The packet says to keep the numeric Seats column: a real app bug.
- Round 3, try 2 (agent `e64d37a0`): **pass**, hidden checks 10 of 10.
  Cost about $0.08, in 7 minutes.
  The Hold button moved to its own cell; a new test reads each cell exactly.
- Round 4, try 1 (agent `59d4804b`): fail, hidden checks 16 of 17.
  Cost about $0.32, in 32 minutes.
  Two pay requests with one execution ID, sent at the same moment,
  made 2 create-intent calls: the same race trial 1 hit here.
- Round 4, try 2 (agent `9eb1142b`): **pass**, hidden checks 17 of 17.
  Cost about $0.12, in 12 minutes.
  It claims the execution ID in the first transaction,
  with a test that sent two requests at once and saw 2 calls before the fix.
- Round 5, try 1 (agent `f05cd53d`): **pass**, hidden checks 21 of 21.
  Cost about $0.18, in 14 minutes.

#### Trial 3 result

- Baseline (first try only): **2**. Rounds 1 and 2 passed first try.
  `score.json` keeps it. Trials 1 and 2 had baseline 0.
- With one teacher note a round: **all 5 rounds pass**, in 7 tries.
- Writer cost: about $1.56. Agent time: about 2 hours 32 minutes.

#### Trials 1, 2, and 3

Same packet checks, same writer model, same retry rule.
Trial 3 runs on the round-lessons image.

- Baseline: 0, 0, and 2.
- Tries: 7, 6, and 7.
- Cost: $1.96, $2.87, and $1.56.
- Agent time: 3 hours 38 minutes, 4 hours 52 minutes, and 2 hours 32 minutes.
- Round 1 failures: trials 1 and 2 (notice wording); trial 3 none.
- Trial 3 failures were real app bugs:
  the Hold button inside the Seats cell (round 3),
  and the same-moment double-pay race (round 4, as in trial 1).
- Second tries cost $0.08 and $0.12: a teacher note fixes a real bug fast.

Lesson: clearer packets and short rules cut cost and time.
They do not stop real bugs; the retry loop still catches those.
