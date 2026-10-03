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
It rebuilds the subset and compares every byte.

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
