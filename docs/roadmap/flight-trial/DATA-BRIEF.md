# Flight data brief

Owner: lead (Claude, Start scaffold session); Sol data writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0097 and ADR 0098 for the trial this data feeds.

## Goal

The flight trial needs real routes and repeatable flights.
Start from OpenFlights; extend it with a fixed seed.
The same seed must give the same bytes every time.

## Where

A new private workspace package: `tools/flight-trial/`.
Name it `flight-trial`.
This ticket fills `tools/flight-trial/data/` and its generator.
Later tickets add the services and rounds beside it.

## Source data

- Fetch `airports.dat`, `airlines.dat`, and `routes.dat`
  from `jpatokal/openflights` at one pinned commit.
  Record the commit and each file's SHA-256.
- Keep a subset, not the whole set:
  about 60 busy airports and the routes between them.
  Keep only airlines that fly those routes.
- Committed data stays under 1 MB in total.
- Add `tools/flight-trial/data/LICENSE.md`:
  the Open Database License, the Database Contents License,
  and credit to OpenFlights.
  The routes stopped updating in June 2014; say so.

## Generated data

A seeded generator writes the trial's flights:

- Schedules: flights per route per day, departure times,
  and duration from the great-circle distance.
- Fares: from distance, cabin, and fare class,
  with a few price buckets per flight.
- Seats per flight and cabin, a few flights nearly full.
- Three suppliers. Each carries a set of airlines.
  The sets overlap, so the same flight appears at more than one.
  Each supplier marks prices up its own way.
- One fixed date range, so dates never depend on today.

Use Core's seeded random (`makeTestRandom` or the same algorithm)
or a small seeded PRNG in the package. Never `Math.random` or `Date.now`.

Expose a reader the services will use:
search a supplier by origin, destination, and date.

## Proof, all by exit code

1. Two runs with the same seed give the same output hash.
2. Another seed gives a different hash.
3. Tests at the public reader: a known route returns flights;
   an overlapping flight appears at two suppliers;
   a near-full flight has few seats; no flight lands before it leaves.
4. A check script verifies the pinned source hashes.
5. Workspace build, `vp check`, the new package's tests,
   prose, and `pnpm validate` pass.

## Limits

- Work only in your worktree; commit per step.
- Change only `tools/flight-trial/`, `docs/roadmap/flight-trial/`, and the lockfile.
- Do not change Core, React, or `apps/`.
- Do not use `git stash`.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
