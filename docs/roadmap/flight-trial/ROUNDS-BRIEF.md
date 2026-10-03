# Flight rounds brief

Owner: lead (Claude, Start scaffold session); Sol rounds writer.
Built on the services branch; the lead rebases after services lands.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0097, ADR 0098, and `tools/flight-trial/README.md`.

## Goal

Five rounds grow one flight app from the Start scaffold.
Each round has a task packet, hidden teacher checks, and a reference answer.
The reference answer proves each round can pass.
The writer under test never sees checks or the answer.

## Where

- Packets: `tools/writer-trial/flight/0N-<name>.md`, N = 1..5.
- Suite rules: `tools/writer-trial/flight-guidelines.md`.
- Teacher checks: `tools/writer-trial/teacher/flight/`.
- Reference answer: `tools/flight-trial/reference/`, one commit per round.

## Delivery order (staged start)

DeepSeek starts round 1 as soon as rounds 1 and 2 are ready.
So deliver in this order:

1. Packets 1 and 2 final, their checks, and the reference passing both.
   Commit with the subject `trial(flight-rounds): rounds 1-2 ready`.
2. Then rounds 3, 4, and 5, one commit each when it passes.

Never change a packet after its "ready" commit.
A round must be ready before the writer under test reaches it.

## Rounds

1. **Search.** Supplier A only; a public results page.
2. **Metasearch.** A, B, C at once; results stream in as each answers.
   B is slow; C can fail. The same flight from two suppliers merges;
   the cheapest wins. A new search cancels the old one.
3. **Hold.** Sign in; hold a seat with the supplier's hold order;
   re-check the price before holding.
   Two travelers race for the last seat; the loser sees "sold out" live.
4. **Pay.** Pay a hold through the payment service.
   The result comes only by signed webhook; verify the signature.
   A late result after the hold expired refunds.
   Booking history syncs across tabs.
5. **Email.** Send a confirmation through Mailpit.
   A failed send is a partial result: the booking stays valid; retry works.

## Packet rules

- Say what the user sees and does; never how to build it.
- Name the fixed contracts the checks rely on:
  routes, page text, settings keys, and the service URLs from `.env`.
- Each packet adds to the last; never contradict an earlier round.
- Plain words; follow `docs/writing-style.md`.

## Teacher checks

- Drive the app only through its pages, its HTTP routes, and the
  services' control APIs. Never read app internals.
- Two-browser Playwright runs for the multi-user parts.
- Count calls from the services' call logs:
  one search asks each supplier once; no repeated payment calls.
- Every check names what failed in plain words.
- A round's checks also rerun every earlier round's checks.

## Proof, all by exit code

1. The reference answer passes rounds 1–5 in order.
2. A planted break per round fails that round's checks:
   for example no dedupe, no signature check, no refund, no partial mail.
3. Checks pass twice in a row on the same answer.
4. Workspace build, `vp check`, tests, prose, and `pnpm validate` pass.

## Limits

- Work only in your worktree; commit per step.
- Change only `tools/writer-trial/flight*`, `tools/writer-trial/teacher/flight/`,
  `tools/flight-trial/reference/`, `docs/roadmap/flight-trial/`, and the lockfile.
- Do not change Core, React, `apps/`, or the services.
- Do not use `git stash`.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
