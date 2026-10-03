# Flight trial data

OpenFlights provides the airports, airlines, and routes.
The schedules, fares, seats, and suppliers are made up.
Routes stopped updating in June 2014.
See [the data license](data/LICENSE.md).

## Generate

Build Core and this package first.
From the workspace root:

```bash
./node_modules/.bin/vp run @tinker/core#build
./node_modules/.bin/vp run flight-trial#build
./node_modules/.bin/vp run flight-trial#generate
```

The default seed is 97.
A seed is an integer from 0 through 4294967295.
The same seed writes the same bytes; another seed changes them.
The output is compressed JSON at `data/flights.json.gz`.
To write another file:

```bash
node tools/flight-trial/scripts/generate.mjs \
  98 tools/flight-trial/.logs/seed-98.json.gz
```

## Read

Import `readFlights` and `Flights` from `flight-trial`.
The reader loads the saved data once.
It needs no network and no current clock.
Search with exact airport codes and UTC departure dates:

```ts
const reader = await readFlights();
const offers = reader.search({
  supplier: "supplier-a",
  origin: "LHR",
  destination: "JFK",
  date: "2027-01-15",
});
```

A known route returns only matching flights.
A route with no service returns no flights.
The same flight appears at two suppliers with their own prices.
A nearly full flight has one to three seats in each cabin.
No flight lands before it leaves.
Changing a search result does not change the next search.
Each result is a deep copy owned by its caller.
Services may keep and change that copy.

`id` names the flight across suppliers.
`offerId` names the supplier's offer.
Seat stock belongs to the flight and cabin, shared by all fare classes.
Each cabin has saver, standard, and flex prices in USD cents.

## Fixed choices

- Dates: 2027-01-15 and 2027-01-16.
- Dates and times use UTC, not the airport's local time.
- Each airline route has one or two departures per day.
- Distance uses airport positions on a 6,371 km sphere.
- Duration uses 800 km per hour plus 30 minutes.
- Economy has 180 seats; business has 24.
- Every 47th flight has one to three seats left per cabin.
- Other cabins have 20 to 90 percent of seats left.
- Base fares use distance and a small seeded price change.
- Business costs 2.8 times economy before that change.
- Standard costs 1.2 times saver; flex costs 1.5 times saver.
- Supplier A adds 2 percent plus 100 cents.
- Supplier B adds 4.5 percent.
- Supplier C adds 1 percent plus 500 cents.
- Each airline is at two suppliers, by sorted airline ID.
- Missing airline codes use OF plus the OpenFlights ID.

The source selection rule and source hashes are in `data/manifest.json`.
The subset keeps 60 airports with the most routes.
It keeps only nonstop routes without codeshares.
It keeps only airlines used by those routes.
Historical airline names and codes stay as supplied.

## Check

```bash
./node_modules/.bin/vp run flight-trial#test
./node_modules/.bin/vp run flight-trial#check:sources
node tools/flight-trial/scripts/check-seeds.mjs
```

The source check fetches the pinned files.
It checks their SHA-256 hashes and rebuilds the subset.
It checks the total saved data is less than 1,000,000 bytes.
The seed check writes two runs at seed 97 and one at seed 98.
It checks their hashes and the saved default data.
