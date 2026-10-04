# Reference port brief (ADR 0102, 0103)

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0048, 0101, 0102, 0103, `tools/writer-trial/README.md`,
and `tools/flight-trial/reference/README.md`.

## Goal

The flight reference answer passes today's gate again, and the next
trial can run: new writer and services images, proved end to end.

## Why it fails today

The whole-repo review ran today's `check:plain` and Jev S24 on the
reference with today's `src/scaffold/`: 18 failures and 7 S24 blocks.

- Built-in fetch: `backend/flight-http.ts:13`, `flight-search.ts:25`,
  `payment-http.ts:15`, `frontend/bookings.ts:20`, `:39`, `:58`,
  `frontend/flights.ts:48`.
- `.inputValidator` in four transport files (the starter now uses `.validator`).
- Stale `PLAIN.md`; an old `src/scaffold/` copy.
- ADR 0103: `backend/payments.ts:166-182` returns `{ status, accepted }`;
  `flight-http.ts:19` and `payment-http.ts:24` hand `{ ok, status, body }` to callers.
- The pinned images (`tools/writer-trial/config.json:41-42`) predate ADR 0102/0103.

## Do

1. `src/scaffold/` becomes a byte copy of `apps/start-scaffold/src/scaffold/`.
   Other starter-owned files follow today's starter unless a round changed them.
2. Server-side supplier and payment calls run `httpRequest` (ADR 0102).
   The operation that calls a service maps its reply to a domain value
   or a managed error; no caller sees a status code (ADR 0103).
3. The webhook operation returns a domain value; its route picks 200 or 400.
4. Browser calls to the app's own server go through server functions,
   except the search stream: an SSE route plus `EventSource`, copying the
   scaffold's sync stream (user's choice, ADR 0048). The SSE route is
   protocol layer: it reads params, runs operations, writes events.
   Supplier calls inside go through `httpRequest`.
5. `.validator`; regenerate `PLAIN.md`; the plain-function cap holds.
6. The app's own HTTP routes, pages, and texts keep the packet contracts,
   so the hidden teacher checks still pass. Do not edit `teacher/`.
7. Build new images from the current repo (vite-plus 1.0.0):
   writer image via the existing prepare/build path and services image via
   `node tools/writer-trial/flight-services-image.mjs`. Save tars, keepers,
   and update `config.json`. Do not remove the images the DeepSeek trial pins.

## Proof, all by exit code

1. `node apps/start-scaffold/scripts/check-plain.mjs tools/flight-trial/reference` exits 0.
2. Jev S24 finds 0 hits on the reference.
3. `diff -r` between the two `src/scaffold/` folders is empty.
4. On the new images: the reference passes rounds 1–5 through the full gate
   twice; each round's planted break fails that round by name.
5. Isolation proof on a fresh trial; build, `vp check`, all tests, prose, validate.

## Limits

- Change only `tools/flight-trial/reference/`, `tools/writer-trial/`
  (not `teacher/`), `docs/roadmap/flight-trial/`, and the lockfile.
- Never touch `~/.local/share/tinker-writer-trial/flight-deepseek-01`,
  its images, or `../tinkered-trial-runner`.
- Vitest 5: await every `expect.poll` and async assertion.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs, image IDs.
