# Services protocol brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0067, 0099, 0100, 0101, and 0103.

## Goal

The trial services' operations speak domain, not HTTP.
Hono handlers own the wire both ways: envelope and validation in,
status, headers, and envelope out.

## Today

- Operations take the whole wire body, for example
  `order` reads `parsed.data.data.selected_offers` (`supplier/index.ts`).
- They return `reply(201, { data })` and `reject("offer_sold_out", 409)`.
- `reply`, `reject`, and `rejectPayment` are plain functions in `http.ts`;
  about 67 calls across the three files.

## Do

1. Each service operation takes only its params and returns a plain value.
   Failures are managed errors (ADR 0067): one error kind per wire code,
   for example `OfferSoldOut`, `OfferExpired`, `OfferNotFound`.
2. Each Hono handler validates the wire body with zod at the framework edge
   (Hono's validator or the shared body middleware), unwraps the envelope,
   runs one operation with `settle`, and maps:
   - success to the status and envelope the wire contract has today;
   - each managed error kind to its status and wire error body,
     through one table per service (Duffel errors, Stripe errors).
3. Control routes follow the same rule.
4. The call log, token, and route-rule middleware may build a reply,
   because they are the protocol layer. Their operations still return plain values.
5. Remove `reply`, `reject`, and `rejectPayment`. Update `services/PLAIN.md`;
   the plain count must fall.
6. Input readers now see only valid params; a reader that throws is fine.

## Proof, all by exit code

1. The wire contract is unchanged. Write a script that starts the old
   services (from `origin/main` at the start of this card) and the new ones,
   sends the same calls to both (all routes, every error code, bad JSON,
   empty body, form bodies, HEAD, unknown routes, control routes,
   percent-encoded paths, a handler throw), and diffs status, headers,
   body, and the call log. Zero differences. Commit the script.
2. `grep` finds no `reply(`, `reject(`, `status:` or `{ data:` in any operation.
3. All tests pass; the four-process proof passes.
4. Mutation 85 or more, alone under `flock /tmp/mutation.lock`, nothing excluded.
5. Build, `vp check`, all tests, prose, `pnpm validate`.

## Limits

- Change only `tools/flight-trial/services/`, `tools/flight-trial/tests/`,
  `tools/flight-trial/scripts/`, `docs/roadmap/flight-trial/`, and the lockfile.
- Do not change Core, React, `apps/`, or `tools/writer-trial/`.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
