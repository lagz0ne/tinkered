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
