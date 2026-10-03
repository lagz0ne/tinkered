# Flight trial progress

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
