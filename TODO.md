# TODO — Kanban

The live board. Move a card between lanes; keep it in one lane only.
Long ticket notes and proof stay in [the track files](docs/roadmap/).

```text
Ready → Doing → Review → Done
         ↕
       Blocked

Parked = deferred; not scheduled
```

- **Ready:** approved and clear enough to start; ordered top to bottom.
- **Doing:** one card per lead. Name the owner, next step, and proof needed.
- **Review:** work is saved; review or checks still remain. Keep the owner and next step.
- **Blocked:** name the exact missing thing and the next step once it is available.
- **Parked:** an idea or deliberate deferral. Record what would make it worth starting.
- **Done:** proof was observed. Link the result; keep only recent cards here.

Finish approved work through Done. Blocked and Parked cards keep their true state.
[Earlier work and full migration history](docs/roadmap/archive/todo-2026-09-19.md).
[Done cards before the stack-v1 run, and the Parked cards removed on 2026-10-02](docs/roadmap/archive/todo-2026-10-02.md).

## Ready

- **start/sync-400** — the sync endpoint answers 400 only for `openSync`'s own input failure.
  Today any `DataValidationFailed` inside the open run maps to 400 (`endpoint.server.ts:26`); match the error's `label` too.
  Verify: a test where a dep's parse fails gets a thrown failure, not 400; it fails on main.
  Also: the old raw `{ cursor }` call to `openSync` in the tests becomes typed `input`, so its input reads one raw shape.

- **core/size-build-guard** — close the 4 guard gaps the second review found.
  Attributes passed through a function parameter; reads through `any` (a parameter, a call result,
  and a `@ts-expect-error` line). Nothing uses them today; the dist test run would catch a break.
  Verify: each plant from the review fails the build; Core tests on source and dist pass.

- **docs/vertical — phone-readable docs: lists over tables, fences ≤ 60 chars (`docs/writing-style.md` → Vertical layout)**
  Owner: lead (Claude)
  Next: `node scripts/prose-lint.mjs --wide` lists 47 files; convert each when next touched, `TODO.md` and `docs/glossary.md` first; one contributor per package README
  Verify: `--wide` prints 0 files; `vp run prose` clean

- **perf/warm-ctl-trade** — win back `s4_warm_ctl` (+0.3 ns, +2.8% at perf/tagged-close) without losing `warm`: both read through `nodeState`; the fix that inlined the whole warm read (611 → 613 bytes) made the bare controller lookup slower. V8 first (inlining of both loops), then N=31 `SCEN="warm s4_warm_ctl"`. Verify: neither "B slower" vs main before perf/tagged-close.

## Doing

- **perf/rules-lanes** — every remaining case-study ticket (user, 2026-10-08: "Go all"), six lanes, one Sol writer each ([plan](docs/roadmap/perf/CASE-STUDY.md)).
  Owner: lead (Claude, Start scaffold session).
  Core in four batches (A shapes, inline budget, slot order; B borrow, hooks, brands; C dep memo, write hooks, unwatched writes; D deps plan, tagged frames, async stacks).
  React (useRun, useResource lean); telemetry (serialize once, capacity, ingest); sync (frame share, client frame, heartbeat wheel); server (request hops, body hold, static memory, chunks); scaffold (app rules).
  Not in it: sync push revocations, which needs an ADR first.
  Verify: each ticket's test or verdict; mutation floors; ratchets only go down.

Pairs since 2026-09-30: a Sol writer (`codex/gpt-6.1-sol`, high) and an Opus 5.5 (high)
reviewer per card (no Fable); the lead lands, one branch at a time (user 2026-09-30).

- **scaffold/lazy-modules** — the scaffold follows ADR 0107 ([brief](docs/roadmap/start-scaffold/LAZY-MODULES-BRIEF.md)).
  Owner: lead (Claude, lazy-modules session); writer Sol, reviewer Opus.
  Writer: `45f6a90c` (Sol), worktree `../tinkered-scaffold-lazy`, branch `scaffold/lazy-modules`.
  Next: writer saves the red run on the app, then adds the checker extras, then makes the app pass.
  Verify: `vp run lazy` covers the base and the app; `--prove` 0; app tests, plain check, registry, import check 0.

## Review

- **core/rules-batch-B** — lean run hooks and the release Q2 test.
  Owner: Core rules writer (Codex).
  Next: lead review and Jev calibration after the clean fault-test log is saved.
  Verify: all gates pass; runHookBody is 298 bytes; all seven kept N=61 rows avoid slowdown.
  Borrow counts and the shared brand key are dropped on slower rows.
  Core needs 85 on kills alone; the final clean-source fault log is saved after the run.
  [Proof](docs/roadmap/perf/PROGRESS.md).

- **core/rules-batch-A** — hook and controller fields, and slot order.
  Owner: Core rules writer (Codex).
  Next: lead review after the clean fault-test log is saved; Jev calibration before landing.
  Verify: ticket and 19 release checks pass; all five N=61 rows have no slowdown.
  Core needs 85 on kills alone; V9 and run budget are dropped.
  [Proof](docs/roadmap/perf/PROGRESS.md).

- **start/server-lane** — request hops, one body hold, static bytes, server chunks, browser settings.
  Owner: writer (Codex, server lane).
  Next: lead reviews the five commits and the clean fault-test proof.
  Verify: request census at most 45; static hits make no file calls; owned chunks at most 255 slots.
  Start fault score at least 75 on kills alone.
  [Proof](docs/roadmap/perf/SERVER-LANE.md).

- **start/telemetry-lane** — encode records once, send full batches, and keep ingest sync.
  Owner: lane writer (Codex), branch `start/telemetry-lane`.
  Next: lead review after the clean-tree mutation proof is saved.
  Verify: all gates exit 0; Start has 448 passing checks;
  wire equality, pre-tick burst, and sync settle pass.
  Queue A/B says `b is faster`; mutation needs 75 on kills alone.
  I8 belongs to the server lane, outside this lane's source boundary.
  [Proof](docs/roadmap/perf/PROGRESS.md).

- **scaffold/app-rules** — mail runs after reply; copied apps keep server imports out.
  Owner: writer (Codex), branch `scaffold/app-rules`.
  Next: lead review and Jev calibration before landing.
  Verify: all gates exit 0; three regressions fail before the fix;
  run imports 26 -> 2; server-file checks 14 -> 0.
  A1 keeps two async bodies because Core rejects their sync forms.
  [Track](docs/roadmap/perf/PROGRESS.md).

- **react/rules-lane** — lean run and resource hooks.
  Owner: React lane writer (Codex).
  Next: lead review after the clean-tree mutation proof is saved.
  Verify: all gates 0; both identity regressions fail before the fix;
  both hooks have three slots; queued pair: b is faster.
- **start/sync-lane** — share frames, apply tab frames in place, and share heartbeat timers.
  Owner: lane writer (Codex).
  Next: lead review after the clean-tree mutation proof is saved.
  Verify: scope tests, queued speed checks, all gates 0, Start kills ≥ 75.
  [Track](docs/roadmap/perf/PROGRESS.md).

- **core/handle-proto** — shared scope verbs (ADR 0108).
  Owner: writer (Codex).
  Next: lead review after the clean-tree mutation proof is saved.
  Verify: three regressions fail on main; ticket and 19 release lanes pass;
  N=61: session and lifecycle faster; op and run show no difference.
  Mutation needs 85 on kills; its log names the clean source commit.
  [Proof](docs/roadmap/perf/PROGRESS.md).

- **start/rules-batch-1** — auth sharing, abort reasons, streamed compression.
  Owner: writer (Codex).
  Next: lead review; b is faster; clean-tree mutation proof is linked in the track.
  Verify: all gates returned 0; regressions failed before each fix.
  [Proof](docs/roadmap/perf/PROGRESS.md).

- **react/rules-batch-1** — callback errors, sync runs, and cell reads.
  Owner: React batch writer (Codex).
  Next: lead review after the clean mutation proof in the track.
  Verify: all gates returned 0; five bug tests fail on main.
  Sync click: two renders and commits became one.
  Queued A/B: no difference we can see.
  [Track](docs/roadmap/perf/PROGRESS.md).

- **core/testing-entry** — keep test helpers out of the main entry.
  Owner: lead (Codex, Core package session); Sol writer.
  Next: run the full Core checkpoint before marking Done.
  Proof: main loads no test helpers; packed imports and types pass.
  Build, check, all 32 test tasks, and all 56 release checks returned 0.
  Clean commit: 24 build tasks; 31 test tasks; Core mutation 85.62.
  Testing keeps virtual time, presets, and seeded IDs.
  [Track](docs/roadmap/core-v1/PROGRESS.md#coretesting-entry).

## Blocked

## Parked

- **starter/lazy-check** — ship the ADR 0107 check to apps made from the starter.
  Restart when: a starter user writes graph code, or the scaffold ticket lands and the check is stable.

- **core/size-13k** — the rest of the path to 13 KiB, with the same API.
  Parked 2026-10-06 (user: good for now). Measured, not landed:
  cheaper namespace and resource code 871 B, cheaper hook code 503 B,
  shorter error text 184 B, one tagged-call fast path 356 B (speed risk).
  Restart when Core nears its 16 KiB cap again. Patches and reports: `~/.cache/size-research/`.

- **core/traceparent** — one W3C `traceparent` helper for every package.
  Parked 2026-10-05: no package parses `traceparent` today (hono, http, and nats are gone).
  Restart when a package needs to read or write the header.

None. All Parked cards were removed on 2026-10-02 (user); they are kept in the archive linked above.

## Done

- **start/lazy-modules** — the base and the checker for ADR 0107; landed 2026-10-09.
  `scripts/check-lazy-modules.mjs` checks rules 7–10; `--prove` 90 cases; `vp run lazy` covers `packages/start/src`.
  The base takes Drizzle and TanStack from lazy modules; `drizzleOrm` is public; the sync endpoint passes `rawInput`.
  Reviewer READY at `cbbd2834` (Opus `8b68d523`); start mutation 83.42% at `c8d51075` (floor 75).
  [Proof](docs/roadmap/start-base/PROGRESS.md#startlazy-modules).

- **perf/rules-lanes, five lanes and Core batch A** — landed 2026-10-08/09.
  Scaffold: sign-up, reset, and profile save answer before mail sends (3 tests fail on main).
  Server: Start promises per page 73.6 -> 34.0; static hits read no file (b is faster); page no difference; mutation 84.48.
  React: useRun 9 -> 3 and useResource 6 -> 3 hook slots; about 1,190 -> 107 B per render; render bench b is faster (about -20%); mutation 85.51.
  Sync: one frame encode per cursor; tab frames plain (5 -> 3 promises); one shared clock (heap per stream 15.9 -> 11.7 KB); mutation 84.15.
  Telemetry: encode once (b is faster, -42.8%); full batches sent at once; mutation 83.53.
  Core A: hook fields set at birth, slot order (wide reads 19 -> 5); V9 and run-budget dropped (slower); N=61 all no difference; mutation 85.06.

- **core/handle-proto** — scope handles share their verbs from one class (ADR 0108: a handle is passed, not copied).
  Heap gate 2,924 -> 2,123 B per request; N=61: session and lifecycle b is faster, op and run no difference.
  Core 15,724 -> 15,805 B gzip; mutation 85.07 on kills alone (valid mutants); 3 of 4 new tests fail on main.

- **perf/rules-batch-1** — the case study's six smallest tickets ([plan](docs/roadmap/perf/CASE-STUDY.md)).
  `react/run-callback-errors` (bug): callback errors are reported; runAsync keeps the operation's value. Tests fail on main.
  `react/run-sync-first` (bug): a sync click renders once (2 -> 1 renders and commits). Test fails on main.
  `react/data-zero-alloc`: raw render 89.5 -> 0.3 B, board write 8,222.8 -> 0.3 B; 2 -> 0 varying-shape sites; ab: no difference we can see. React mutation 85.64.
  `scaffold/auth-scope`: one better-auth per process. `start/abort-reasons`: 17 shared reasons, page aborts 1 -> 0.
  `start/compress-stream`: compressed HTML streams early; first byte: b is faster. Start mutation 85.36.

- **playground/storm-layers** — the storm draws only the walls that face the viewer, and the arrow lives in the flat top.
  Compositor layers 873 -> 585 (arrow layers 144 -> 0); DOM nodes 1,241 -> 1,097; wall pixels unchanged at 4 angles.
  Median blocking time 2,199 -> 1,032 ms over a 10 s storm at load under 4; more board updates fit in the same time. No fps or memory claim (buffer estimate 20.9 -> 26.4 MiB).

- **repo/fast-code-rules** and **jev/fast-code-judges** — the fast-code rules are house style ([docs/fast-code.md](docs/fast-code.md)).
  Ratchets in `pnpm validate`: Core slots 341, hot bytecode sizes, OperationCtx inlined (Maglev on), closures in hot functions, no zod in the client.
  Jev preflight judges: madeEveryCall (proven), awaitsSyncWork, waitsOnSideWork, recomputesSameValue, shapeGrowsPerCall (provisional).
  Census: P05 (unit made inside a function), P06 (unused `.then`).
  Case study: [docs/roadmap/perf/CASE-STUDY.md](docs/roadmap/perf/CASE-STUDY.md).

- **start/sync-test-warm** — one warm PGlite per test file; each scope gets and closes its own copy.
  Loaded median test time about 1.5 s to 0.7 s; Stryker's first pass passed 3 times in a row; no timeout raised; mutation 85.42 on kills.

- **perf fixes 2026-10-07** — the study's proven fixes, landed (study: `/home/paseo/perf/index.html`).
  Owner: lead (Claude, Start scaffold session); Sol writers.
  `playground/vendor-chunks`: a fresh build shows 144 tiles again.
  `start/telemetry-fast`: records sized once (b is faster, -54.8%); browser bodies capped at 32,000 B; zod off the client (494 -> 401 KB).
  `start/ssr-telemetry-root`: one telemetry root per process; no page waits on a telemetry send (b is faster, -29.8%).
  `start/serve-fast`: file set read once, compression, compile hint (file misses 956 -> 132 ms, b is faster).
  `start/sync-fast`: one shared read per wake (2,000 -> 1 reads); stalled clients closed by lease and sign-out; one snapshot on `/` (b is faster, -33% at 100 streams, -42.6% at 1,000).
  `core/op-fast`: OperationCtx inlined under Maglev, no per-op closures, one-turn close, shared abort reason.
  N=61: op 64.2 -> 57.7 ns, run 75.5 -> 71.7, tagged 208.6 -> 179.6 (b is faster); session, lifecycle no difference. Core 15,367 -> 15,724 B gzip.

- **release start-v0.7.0** — the first public release (user's go, 2026-10-07).
  [Release](https://github.com/lagz0ne/tinkered/releases/tag/start-v0.7.0): Core, React, and Start 0.7.0 tarballs; sha256 match the manifest.
  Registry: `https://raw.githubusercontent.com/lagz0ne/tinkered/start-v0.7.0/apps/start-scaffold/public/r/app.json`.
  Proof from the real URLs: empty folder, one `shadcn add`, `npm install`, `vp build` EXIT 0, doctor all pass, `GET /` 200 "Hello, world.".

- **repo/no-import-extensions** — no TypeScript import names a `.ts`, `.tsx`, or `.mts` ending, anywhere (user 2026-10-07).
  Owner: lead (Claude, Start scaffold session); Sol writer. No mutation run (user).
  2,453 import paths and 781 paths in strings changed by `scripts/strip-import-extensions.mjs` (rerunnable).
  `allowImportingTsExtensions` gone from 21 tsconfigs; bundler resolution; `tsc` rejects a `.ts` import.
  Kept out by: the coding convention and style census, the contributor brief, trial guidelines,
  doctor (it names the file and line), and `scripts/check-import-extensions.mjs` in `pnpm validate`.

- **start/registry-no-overwrite** — example items add only their own files; nothing needs `--overwrite`.
  Owner: lead (Claude, Start scaffold session); Sol writer.
  Each item names its parts and seam exports; doctor prints the exact switch and export line to add.
  The registry build rejects an item that lists a protected app file (11 targets).
  Proof: nine fresh apps, nine adds, edited files byte for byte the same; mutation 86.39 on kills.

- **start/github-release** — Core, React, and Start ship as one set, 0.7.0, tag `start-v0.7.0` (ADR 0106).
  Owner: lead (Claude, Start scaffold session); Sol writer.
  `node scripts/release.mjs <v> --dry` packs the three tarballs and the registry with release URLs; it has no publish mode.
  `tinker upgrade <v>` writes the three URLs; it stops on edited base bytes.
  Proof: a local stand-in for GitHub; empty folder to `GET /` 200. Steps: `docs/roadmap/start-base/RELEASE.md`.

- **trial/base-image** — the Flight trial image installs packed Start, Core, and React; the gate runs `tinker doctor`.
  Owner: lead (Claude, Start scaffold session); Sol writer.
  Image `tinker-writer-flight:20261007.base.1` (keeper and tar saved; old images kept).
  Doctor check 2 replaces the scaffold hashes; a planted base edit is named and blocked.
  Round 1 on the fixed reference: `machine-pass`, three browser cases; no model writer ran.
  [Proof](docs/roadmap/start-base/proof/19-trial-base-image.txt).

- **start/shadcn-registry** — one `shadcn add <registry>/app.json` turns an empty folder into an app on the base.
  Owner: lead (Claude, Start scaffold session); Sol writer.
  10 items, 142 files built from source; `app` written once; examples by `shadcn add --diff`; base by `tinker upgrade`.
  Proof (local registry at 127.0.0.1; nothing published): empty folder to `GET /` 200; every example builds and passes doctor.
  [PROOF section V](docs/roadmap/start-base/PROOF.md). Publishing waits for the user's go and a domain.

- **start/scaffold-on-base** — `apps/start-scaffold` runs on the base: `tinker({ auth: true, sync: true })`.
  Owner: lead (Claude, Start scaffold session); Sol writers. Landed in two steps on main.
  Step 1 fc276a61: `src/scaffold/` gone; first real proof of auth and sync (better-auth, Postgres, two tabs).
  Step 2 (this landing): seam and boundary checks moved into doctor 5, 6, 10; eight named app checks;
  one command runs them all: `vp run @tinker-start-scaffold#check`.
  Registry: 9 items, 77 files; the runtime item installs `@tinker/start`; nothing published.
  Tests 1,840; mutation 87.30 on kills. Proof: [PROOF sections T and U](docs/roadmap/start-base/PROOF.md).

- **start/base-parts** — telemetry, auth, and sync are base parts, each set in `tinker({ ... })` (ADR 0106).
  Owner: lead (Claude, Start scaffold session); Opus writer. Landed in four steps on main.
  telemetry (on by default) a7b2d685; auth 3af9018b; sync server 5cc843fb; sync client (this landing).
  Each part mounts its routes only while on; doctor names a missing seam name or a refused env key.
  Tests 358; 18 of 18 new breaks caught (full run at 3a: 198 of 198); mutation 87.36 on kills alone.
  Proof: [PROOF sections P to S](docs/roadmap/start-base/PROOF.md#p-the-telemetry-part-030).
  Floor for `@tinker/start` is now 75 (user 2026-10-06).

- **start/base-package** — `@tinker/start` in `packages/start`, the smallest app in `apps/start-min` (ADR 0106).
  Owner: lead (Claude, Start scaffold session); Opus writer, Opus review (two fix rounds).
  `poc/` is gone, history kept. `doctor` reads `extends` as tsc does: `.json` added, chains followed.
  Tests 23 files, 171; 148 of 148 planted breaks caught; mutation 88.21 (88.07 on kills alone).
  `apps/start-min` builds, serves `/`, `/api/health`, `/tinker`; doctor passes.
  [Proof](docs/roadmap/start-base/PROOF.md#0-the-package).

- **start/base** — the Start base is a package, glued by one plugin (ADR 0106, accepted).
  Owner: lead (Claude, Start scaffold session); Opus designer, four Opus stress agents, Opus writer and review.
  POC, now `packages/start` (`@tinker/start` 0.2.0) and `apps/start-min` (two files in `src/`, one glue line each config).
  Stress test: 84 checks, 46 → 79 work, 0 need a change, 5 not supported (listed in the ADR).
  Every known mistake fails the build or `tinker doctor` names file and line; 11 checks.
  Tests: 129 plain unit tests of the glue and scope seams, no wrappers; 140 of 140 planted breaks caught.
  [Proof](docs/roadmap/start-base/PROOF.md).

- **core/extension-slot** — the trial shares its HTTP stack as a session resource; Core unchanged (ADR 0105).
  Owner: lead (Claude, Start scaffold session); Opus designer, Sol writer, Opus review (one fix round).
  Asked by: `trial/flight-services` and `trial/services-routing`.
  The hand call `httpRequests.hooks!.start!` is gone; repeated resolves in one service session register once.
  Wire differences zero over 2,160 calls; 148 trial tests; mutation 88.71 (86.90 from kills alone).
  Held: an extension that includes another, if a shared piece needs a hook other than `start`.

- **core/size-build** — a build step renames 48 private fields: Core 15,683 → 15,367 B gzip (−316 B).
  Owner: lead (Claude, Start scaffold session); Opus writer, Opus review (one fix round).
  A guard stops the build on public names, user-visible keys, gone names, and reads from outside Core.
  Core tests also run on the built files (`core#test:dist`, in validate and ticket.sh).
  Types and exports match main; speed N=61, ten scenarios, no difference; mutation 86.00.
  [Track](docs/roadmap/core-v1/PROGRESS.md#coresize-build).

- **core/size-research** — two rounds of Opus research on Core's size (goal was 13 KiB).
  Owner: lead (Claude, Start scaffold session); eight Opus researchers.
  Landed from it: `core/size-safe` (16,084 → 15,683 B); `core/size-build` next.
  User 2026-10-06: good for now; no more trimming. Plan and patches kept for later.
  [Plan](docs/roadmap/core-v1/PROGRESS.md#coresize-safe).

- **core/size-safe** — round 1's code-only cuts: Core 16,084 → 15,683 B gzip (−401 B), same behavior.
  Owner: lead (Claude, Start scaffold session); Opus writer, Opus review.
  Cuts: close paths 131 B, hot paths 198 B, surface 66 B, error helpers 6 B.
  Public `.d.mts` identical; 856 tests; validate green; promises 0/5/2; mutation 85.92.
  Speed: 13 scenarios at N=61, none B slower; 6 B faster (`taggeddefer` 360 → 237 ns).
  Dropped: span ids at open (275 B): `opobs` B slower (211 → 955 ns).
  [Track](docs/roadmap/core-v1/PROGRESS.md#coresize-safe).

- **core/extension-slot** — the trial shares its HTTP stack as a session resource; Core unchanged (ADR 0105).
  Owner: lead (Claude, Start scaffold session); Opus designer, Sol writer, Opus review (one fix round).
  Asked by: `trial/flight-services` and `trial/services-routing`.
  The hand call `httpRequests.hooks!.start!` is gone; repeated resolves in one service session register once.
  Wire differences zero over 2,160 calls; 123 trial tests; mutation 91.42.
  Held: an extension that includes another, if a shared piece needs a hook other than `start`.

- **core/size-room** — Core runtime 16,379 → 16,084 B gzip: 300 B free, no change in behavior.
  Owner: lead (Claude, Start scaffold session); Astra writer (after a Sol outage), Opus review.
  Cuts: private names 255 B, cold and duplicate code 26 B, shared empty stores 12 B, symbol text 11 B.
  Public types identical to main; 854 tests; validate green; promises 0/5/2; hot names end at slot 249.
  Speed: none of ten scenarios B slower at N=61; `inline` B faster (N=183, both orders).
  [Gate receipt](docs/roadmap/core-v1/size-room/GATES.json).

- **core/graceful-writes** — running work keeps state usable during a graceful close.
  Owner: lead (Claude, Start scaffold session); Sol writer, Sol fix writer, Opus review (two fix rounds).
  Asked by: Harness and Tinkerer live entries.
  A running call and its helper calls finish their writes; new outside calls get `Disposed`.
  A forced parent close still seals a child mid-drain.
  854 Core tests; mutation 85.94 (changed lines 92.31); promises 0/5/2.
  Size: 16,379 of 16,384 B gzip (5 B left): the next Core card must cut bytes first.
  [Gates](docs/roadmap/core-v1/graceful-writes-logs/GATES.json).

- **flight-trial/entries-flake** — entry startup waits now allow a busy box.
  Owner: lead (Claude, Start scaffold session); Sol writer, Opus review.
  Both startup polls wait up to 15 s; what they check is unchanged.
  Proof: 10 straight passes under full-test load (review: 10 more);
  a wrong-port copy still fails at 15 s. 120 flight tests pass.
  [Proof](docs/roadmap/flight-trial/PROGRESS.md#flight-trialentries-flake).

- **trial/services-closing** — the flight services stop owned work on `ctx.closing` (ADR 0104).
  Owner: lead (Claude, Start scaffold session); Sol writer, Opus review (one fix round).
  The payment close hook and the HTTP client's `close()` are gone.
  Review caught a release cleanup hang; fixed with tests for supplier and payment.
  A graceful close refuses new connections and lets running requests finish.
  120 flight tests; mutation 91.17; wire diff zero over 2,160 calls.
  [Proof](docs/roadmap/flight-trial/services-closing/GATES.json).

- **trial/deepseek-03** — DeepSeek on the round-lessons image, next to trials 1 and 2.
  Owner: lead (Claude, Start scaffold session).
  Baseline 2 (trials 1 and 2: 0). All 5 rounds pass in 7 tries, $1.56, 2 h 32 min
  (trial 1: 7 tries, $1.96, 3 h 38 min; trial 2: 6 tries, $2.87, 4 h 52 min).
  Failures were real bugs: a Hold button in the Seats cell, and the double-pay race.
  [Comparison](docs/roadmap/flight-trial/PROGRESS.md#trials-1-2-and-3).

- **start/http-closing** — the scaffold `http` resource stops pending sends on `ctx.closing` (ADR 0104).
  Owner: lead (Claude, Start scaffold session); Sol writer, Opus review (one fix round).
  A direct graceful close with a hung backend now settles (red test proven).
  A closing abort is `HttpRequestFailed`; a caller cancel stays `cancelled`.
  `backendStop` and `requestStop` stay, each covered by a test; 27 HTTP tests.
  ADR 0102 notes the refinement; the core-feedback rows are closed.
  [Proof](docs/roadmap/start-scaffold/PROGRESS.md#http-closing-starthttp-closing).

- **trial/round-lessons** — clearer notices, smaller writer rules, fixed skill import path.
  Owner: lead (Claude, Start scaffold session); Sol writer, Opus review (one fix round).
  GUIDELINES 21.6% smaller; image `tinker-writer-flight:20261005.round-lessons.1`.
  Round 1 rerun (`flight-deepseek-03`): pass first try, 3 of 3, $0.35 in 38 minutes
  (trial 2's first try: fail, $1.37, 58 minutes).
  [Notes](docs/roadmap/flight-trial/PROGRESS.md#round-1-rerun-2026-10-05).

- **trial/deepseek-02** — DeepSeek on the ADR 0102/0103 images, next to trial 1.
  Owner: lead (Claude, Start scaffold session).
  Baseline 0 (same as trial 1). With one teacher note a round: all 5 rounds pass in 6 tries
  (trial 1: 7). Cost $2.87 (trial 1: $1.96); $1.37 of it was round 1 try 1 chasing its own
  leftover servers. [Comparison](docs/roadmap/flight-trial/PROGRESS.md#trial-1-and-trial-2).

- **core/close-hook-scope** — a layer's closing signal fires when closing begins, before the drain (ADR 0104).
  Owner: lead (Claude, Start scaffold session); Sol writer, Sol fix round, Opus review (one fix round).
  `ctx.closing` and `event.closing` abort on graceful or forced close; a child follows every ancestor;
  the close hook event carries `event.scope`; made only on first read (promises 0/5/2).
  Review caught a re-entrant first root close that left `closed` pending; fixed with a red test.
  Core 814 tests, mutation 85.88, size 16,257 B (+101 B, cap 16,384), validate green.
  Known: a re-entrant first root close still runs its close hooks 0 times, as on main.
  [Proof](docs/roadmap/core-v1/close-hook-scope-logs/README.md).

- **start/serve-native-response** — the starter's `scripts/serve.mjs` keeps the native `Response`.
  Owner: lead (Claude, Start scaffold session); Sol writer; lead review.
  `overrideGlobalObjects: false`, as the reference has; `prepare.mjs --app-only` rebuilds just the writer image.
  Proof: a `Response.json` route went from HTTP 500 to 200 (red then green); copied starter; round 1
  passes on the new writer image `bb97e63c`; all gates.

- **trial/reference-0102** — the flight reference passes today's gate; new images; the next trial can run.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY. Folds in `trial/images-0102`.
  Supplier and payment calls run `httpRequest` and map replies to values or managed errors;
  the webhook route picks its status; search streams over SSE (user's choice); `src/scaffold/` matches the scaffold.
  Proof: plain check 32 findings to 0, S24 10 hits to 0; rounds 1-5 twice and each planted break
  on the new images (writer `a46805a4`, services `1be10fb5`, vite-plus 1.0); isolation; all gates.

- **docs/http-0102-0103** — docs and fix texts say exactly what the HTTP and protocol code does.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY after one fix round.
  ADR 0102 and 0103, the glossary, README, and skills match the code: two spans per request,
  the stop tags and the graceful-close limit, the full ban list; S24's fix line compiles.
  Proof: the S24 snippet typechecks (red on the old text); 148 Jev tests; prose.

- **start/protocol-reply** — the scaffold's own operations stop speaking HTTP (ADR 0103).
  Owner: lead (Claude, Start scaffold session); Sol writers; Opus reviewer READY after three rounds.
  Telemetry ingest takes a batch and sync open takes a cursor; their routes own origin, headers, limits,
  statuses, and SSE headers. Auth is a mounted handler; raw headers never reach app code.
  `check:plain` fails an operation that takes a `Request` or returns a `Response`, any app use of the
  global `Response`, and the destructuring, constant-key, and dynamic-import escapes.
  Proof: wire pinned before the move; 177 planted cases; 68 app tests; copied starter; all gates.
  Left: the telemetry route keeps one `.then` to stay under the complexity limit (plain-function cap is full).

- **start/http-graceful** — a server shutdown never hangs on an outgoing HTTP request.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY after one fix round.
  `http` stops through the inherited `backendStop` and `requestStop` tags, so every child session Core makes is covered;
  a stopped request is refused before sending; no Core method is replaced.
  Proof: 7 red-then-green tests incl. the server-function `settle(op, { signal })` shape; 60 app tests; all gates.
  The direct graceful close limit was removed by `start/http-closing` (ADR 0104).

- **repo/vite-plus-1** — `vite-plus` 0.3.1 → 1.0.0 (Vitest 4 → 5).
  Owner: lead (Claude, tinkered-2f). `vp migrate`, plus literal 1.0.0 pins in the examples, the starter, and writer-trial.
  Migrate review: 0 blockers; 58 notes, tests pass (3 unawaited notes are awaited later).
  Proof: tests 1,235 passed as on main; check 0 errors; example:check; test:registry; validate 16/16.
  Mutation: core 85.70%, blueprint 86.04%, flight-trial 92.77%, react 92.75%.
  After pull: `vp install`.

- **trial/services-http** — the services' webhook sender goes through a request operation (ADR 0102).
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY.
  `services/http-client.ts` holds the three HTTP units; each webhook copy is an `http POST` span;
  replies map to delivered, rejected, or unreachable; a graceful close aborts sends in flight; a fetch ban guards the services.
  Proof: 6 red-then-green tests; wire diff 0 over 2,160 calls; mutation 92.83%; all gates.
  Found: the scaffold's `http` resource hangs a graceful close (card `start/http-graceful`).

- **start/http-polish** — close the low gaps left by `start/http-resource`.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY.
  Bans `http2`, `ws`, `ofetch`, raw `net`/`tls`/`dgram`, `XMLHttpRequest`, and `sendBeacon` outside the scaffold;
  `import type` passes; error causes keep name and code, abort included. WebSocket and EventSource stay allowed (ADR 0048).
  Proof: 21 changes red then green; 134 planted cases; 51 app tests; copied starter; all gates.

- **trial/s24-on** — Jev rule S24 bans bare fetch again in every suite, naming `httpRequest`.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY.
  S24's fix line names `httpRequest.controller`; only the scaffold's `http-backend.ts` may call fetch;
  the flight skip is gone, so a flight gate on a bare-fetch app blocks.
  Proof: 4 new tests, each red on the old code; 147 Jev tests; 91 harness tests; check; prose.
  Known gap: S24 matches calls only (aliases pass it); `check:plain` catches them in Start apps.

- **trial/services-protocol** — service operations speak domain; Hono owns the wire both ways (ADR 0103).
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY.
  Operations take params, return plain values, raise managed errors; one error map per service.
  `reply`, `reject`, `rejectPayment` are gone: plain functions 6 to 3.
  Proof: old-vs-new wire diff, 2,160 calls and 30 error codes, zero differences;
  `check-protocol` fails on an unmapped error kind; mutation 87.13%; all gates.

- **start/http-resource** — outgoing HTTP is a resource over built-in fetch (ADR 0102).
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY after two fix rounds.
  `httpBackend` wraps built-in fetch; `http` owns requests in flight; `httpRequest` is one child span per call.
  `check:plain` bans built-in fetch by type (alias, `window`, `self`, tag default), the raw resource,
  the backend tag, and 11 other HTTP clients outside the scaffold; errors keep method, path, and cause code.
  Proof: 113 planted cases; every fix red then green; 48 app tests; copied starter; all gates.
  Open (low): `node:http2` and `ws` imports pass; `import type` from `node:http` fails; abort causes drop their code.

- **trial/deepseek-baseline** — DeepSeek builds the flight app, round by round.
  Owner: lead (Claude, Start scaffold session).
  Trial `flight-deepseek-01`; writer `pi/writer-gateway/deepseek/deepseek-v4.1-flash`, high.
  Baseline **0** (round 1 failed first try). With one teacher note a round,
  all 5 rounds pass in 7 tries (hidden checks 3, 6, 10, 17, 21); about $1.96.
  [Proof](docs/roadmap/flight-trial/PROGRESS.md#deepseek-baseline-2026-10-03).

- **trial/jev-link** — a trial never depends on the checkout that made it.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY.
  Found in DeepSeek round 1: the frozen Jev linked its packages into a removed worktree.
  `create` now copies Jev's packages (about 32 MB) and proves every broker module loads.
  A failed create removes its `frozen/`; at `check`, an unloadable Jev is "unavailable", never a pass.
  Proof: 7 new tests, each red on the old code; 91 harness tests; build, check, validate.

- **start/starter-casts** — starter files ship no code that Jev blocks.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY.
  Found by DeepSeek round 1: it edited `src/server.ts` and Jev blocked two casts it did not write.
  The casts are gone with real types; `inputValidator` is now `validator`.
  Proof: app gate blockers in starter files 6 to 0; plain, seam, registry, 40 app tests;
  build, check, all tests, validate after rebase. Open: a missing router `close` raises
  `StartScopeMissing` (wrong name; never reached); two HTML previews still show `inputValidator`.

- **lead/flight-explore** — a retried model can go past its first failure without changing its score.
  Owner: lead (Claude, Start scaffold session). Needed for the DeepSeek retries (user 2026-10-03).
  `workers.mjs stage <trial> <round> --explore` stages once every earlier round's latest try passed.
  Proof: the new stage test fails without the change, passes now; 81 harness tests; check; prose.

- **trial/flight-integration** — rounds and harness joined on main; the whole trial proven.
  Owner: lead (Claude, Start scaffold session); Sol writer, then Astra (Sol at capacity); Opus reviewer.
  Also closes `trial/flight-rounds` (READY `10ff6e72`) and `trial/flight-harness` (READY `6a2209ea`).
  The writer's network gives the host no address; teacher files are pinned by hash at create.
  Proof: the reference passes rounds 1-5 twice, then once on the Hono services and new Core image;
  one planted break per round fails it by name; the reviewer scanned all ports on the gateway.
  Found and fixed on the way: `start/tab-defer`, `core/uuid-fallback`.
  [Gates](docs/roadmap/flight-trial/INTEGRATION-GATES.md).

- **trial/services-routing** — the trial services route through Hono, not Tinker (ADR 0101).
  Owner: lead (Claude, Start scaffold session); Sol writer, Astra fix writer; Opus reviewer.
  Each handler reads its params and runs one operation; the dispatch operations are gone.
  The shared Hono stack and control routes live once, in `services/http.ts`.
  Proof: 78 old-versus-new HTTP calls match (reviewer); 96 tests; four-process proof;
  expiry rewind fails on `e55ddac2`, passes now; mutation 91.89% (91.11% counting timeouts as misses).
  [Proof](docs/roadmap/flight-trial/PROGRESS.md).

- **core/uuid-fallback** — `ctx.random.uuid()` works on plain-http browser pages.
  Owner: lead (Claude, Start scaffold session). Found by `trial/flight-integration`; user asked for the fix.
  Browsers give `crypto.randomUUID` to secure pages only, so the system source threw there.
  It now builds a v4 id from `crypto.getRandomValues` when `randomUUID` is missing.
  Proof: the new `random.test.ts` case fails with `crypto.randomUUID is not a function`
  on the old source and passes now; a native-path case kills the rest.
  Gates: check, 799 Core tests, all tests, validate, prose; changed lines mutation 100%.

- **start/tab-defer** — the tab close watcher no longer defers after its factory ends.
  Owner: lead (Claude, Start scaffold session). Found by `trial/flight-integration`.
  `bind` called `ctx.defer` late, so Core threw `Disposed` and the page stayed blank.
  The listener now starts in the factory; the page comes in through the `pageEvents` tag.
  Proof: `tests/tab-lifetime.test.ts` fails with `Disposed` on the old shape, passes now;
  plain check, registry, build, `vp check`, all tests, prose green.

- **trial/flight-services** — payment and three suppliers as Tinker apps behind HTTP (ADR 0098).
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer.
  Duffel-shaped suppliers A, B, C and a Stripe-shaped payment, each its own process.
  Each has a service API and a token-guarded control API with a call log.
  Proof: tests use only HTTP; four-process proof; strict forms (ADR 0099, 0100);
  build, check, tests, prose green (lead rerun); mutation 85.76%.
  Next: routing moves to Hono in `trial/services-routing` (ADR 0101).
  [Proof](docs/roadmap/flight-trial/PROGRESS.md).

- **start/strict-forms** — the scaffold enforces ADR 0099 and 0100.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY at `6a840ac8`.
  Ships `check:plain` and `PLAIN.md`: no classes, no Core handles or IO in plain params,
  at most three params, two callers, `createScope` only in entries; cap 17 plain functions.
  Plain functions 45 to 17; the skills teach the rule with a real example.
  Proof: 81 planted cases fail by name; 37 app tests; a clean consumer passes;
  run from another folder fails before `a282fb82` and passes after; validate passes.
  Open signal: no Core form for a private resource procedure (repeated inline steps).

- **trial/flight-data** — real routes, extended by a fixed seed (ADR 0097).
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY at `0b278b73`.
  `tools/flight-trial/data/`: 60 OpenFlights airports, 149 airlines, 4,058 routes, credited (ODbL).
  A seeded generator makes 10,996 flights over three overlapping suppliers.
  Proof: same seed, same JSON hash; another seed differs; pinned hashes match;
  31 tests; mutation 94.72% (lead rerun, alone); validate passes.
  [Proof](docs/roadmap/flight-trial/PROGRESS.md).

- **start/refine** — the scaffold keeps only what a new project needs, plus its skills.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY at `67324417`.
  Stream checks login once per change; sign-in and redirect load data once.
  Proof mode left the app; dev runs on compose (Postgres, Mailpit, Victoria).
  Ships tests, test scripts, project checks, `AGENTS.md`, and five skills.
  Proof: waste tests fail on old code and pass now; 35 app tests;
  a clean shadcn project installs, builds, and passes 35 tests from tarballs;
  compose sign-up, saved todo, and Mailpit mail pass; validate passes.
  [Proof](docs/roadmap/start-scaffold/REFINE-PROOF.md).

- **start/seam** — the fixed scaffold reaches user code only through two seams.
  Owner: lead (Claude, Start scaffold session); Sol writer; Opus reviewer READY at `2bc502be`.
  Values go through `@/lib/tinker` and `@/lib/tinker.server`; types through `Register`.
  Proof: build, check, 30 app tests, all workspace tests, and validate pass.
  Seam check refuses 13 planted import forms; a note-only fixture type-checks the scaffold.
  shadcn rewrites seams under `@/app-lib`; a `runtime` update keeps both seams.
  `test:schema` fails on the old duplicate tables and passes now.
  Two-tab browser sync, sign-out, SSE, and telemetry pass; 0 page errors.
  Open: deep `lib` aliases and the mail assumption in setup.
  [Proof](docs/roadmap/start-scaffold/SEAM-PROOF.md).

- **start/primitive-registry** — keep the four-form Start registry.
  Owner: lead (Codex, Start scaffold session); Sol source-registry writer.
  Proof: build, check, all kept tests, and real copy/update pass in main.
  Three items copy 82 exact files, including portable authoring rules.
  New code outside the four forms must give a TSDoc reason.
  All 14 old catalog addresses return 404; kept payloads match source.
  [Proof](docs/roadmap/start-scaffold/PROGRESS.md#keep-the-plain-start-registry).

- **start/owned-source** — copied integrations, native SSE, and Victoria storage.
  Owner: lead (Codex, Start scaffold session); Astra SSE writer;
  Sol Victoria writer and Sol source-registry writer.
  Proof: build, check, all kept workspace tests, and 30 app seams pass.
  Both real registry installs/updates preserve feature files.
  Browser sync, stored traces/logs from all three sides, and idle SSE shutdown pass.
  Only Core and React libraries remain; old app and nine dependent examples are removed.
  Source files and 95 integration/tool test files stay owned and runnable.
  [Proof](docs/roadmap/start-scaffold/PROGRESS.md#observed-main-proof).

- **start/public-private-sync** — public and private pages use one sync and mutation model.
  Owner: lead (Codex, Start scaffold session); Astra writer.
  Saved: `a8102d62`; reviewed app copied into main.
  Proof: build 25 tasks; check 0 errors and 28 existing warnings; all 32 test tasks pass.
  Nineteen app seams, native middleware, import guards, two-tab auth/sync, and Node exit pass.
  Real registry copies 67 files; dry run changes none; setup update keeps an edited feature.
  Installed consumer build/types and exact highlighted source preview pass.
  Only two approved proof-preset census exceptions; all other strict rows are zero.
  OTEL export, live network services, and full live graph inspection are outside this proof.
  [Proof](docs/roadmap/start-scaffold/PROGRESS.md#public-and-private-sync-proof).

- **start/sync-result-design** — one update path and results for the required work.
  Owner: lead (Codex, Start scaffold session).
  Proof: reviewed graph and result shape; partial keeps the saved profile usable.
  Prose has 0 hits in 176 tracked docs and all five touched docs.
  Three track docs have no wide rows or code lines; diff check passes.
  Design only; runtime seam and browser proof remain pending.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md#shared-state-and-execution-results).

- **authoring/state-exit-proof** — ask state-owned work to stop; ignore late replies.
  Owner: lead (Codex, UI state model session).
  Proof: the old call gets cancelled and its late reply writes nothing;
  a new state instance publishes; all probe assertions pass, exit 0.
  Glossary and rule saved; prose has 0 hits; diff check passes.
  No Core source or public API changed.
  [Track](docs/roadmap/authoring-model/PROGRESS.md#ui-state-exit-2026-10-02).

- **start/failure-input** — infer the failure context from its input reader.
  Owner: lead (Codex, Start scaffold session); Astra writer.
  Saved: `4dde3c8c`; the reviewed todo view is copied into the main workspace.
  Proof: build 25 tasks; check 0 errors and 28 existing warnings;
  all 32 test tasks pass, including eleven app tests; census and TSDoc pass.
  Failure text, retry, Core span, browser Pino, and exact source tabs pass.
  The error reader returns a string; ctx has no type annotation.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md).

- **start/lazy-libraries** — load service libraries only when their unit runs.
  Owner: lead (Codex, Start scaffold session); Astra writer.
  Saved: `a667de7d`; thirteen reviewed files copied into the main workspace.
  Proof: cold import fails before and passes after; build 25 tasks;
  check 0 errors and 28 existing warnings; all 32 test tasks pass, including
  eleven app tests; native middleware, import guard, census, and TSDoc pass.
  Browser Pino, saving and retry, private lists, account switch, and reload pass.
  Seven exact source tabs and the linked graph pass on a phone.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md).

- **start/database-userland** — show the app-owned database resource.
  Owner: lead (Codex, Start scaffold session).
  Proof: seven exact source tabs, phone width, colors, and no page errors pass.
  The database box links to its source; its arrow is bound to backend actions.
  Existing box positions and links are kept; prose and authored census pass.
  The preview reveals existing code; no app TypeScript changed.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md).

- **start/input-states** — inferred todo input and named flow states.
  Owner: lead (Codex, Start scaffold session); Astra writer.
  Saved: `1a14da25`; reviewed and copied into the main workspace.
  Proof: build 25 tasks; check 0 errors and 28 existing warnings;
  all 32 test tasks pass, including eleven app tests; TSDoc, census, and prose pass.
  Saving disables controls; failure clears on retry; failed Core span and reload pass.
  Private account CRUD, account switch, and six exact source tabs pass.
  The write infers input from its reader and takes the owner from a resource.
  The browser flow is one idle, saving, or failed Core data object.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md).

- **start/input-user** — Core input reads and a current-user resource.
  Owner: lead (Codex, Start scaffold session); Astra writer.
  Saved: `0ef74c28`; reviewed and copied into the main workspace.
  Proof: the old input read fails the browser span check; the fix passes;
  build 25 tasks; check 0 errors and 28 existing warnings;
  all 32 package test tasks pass one at a time, including eleven app tests;
  middleware, import guard, TSDoc, census, and prose pass;
  phone CRUD, account switch, input retry, and six source tabs pass.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md).

- **start/todos** — one private todo list per account.
  Owner: lead (Codex, Start scaffold session); Astra writer.
  Saved: `85a93399`; copied and reviewed in the main workspace.
  Proof: build 25 tasks; check 0 errors, 28 existing warnings;
  all 32 package test tasks pass one at a time; eleven app tests;
  native middleware, import guard, TSDoc, strict census, and prose pass;
  phone CRUD, reload, account switch, and blank-title retry pass.
  The code preview shows six highlighted feature files and the editable graph.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md).

- **start/poc** — native Start scope bridge and runnable Core/React proof.
  Owner: lead (Codex, Start scaffold session); Astra writer.
  Better Auth, Drizzle, mail, Pino, and shadcn are wired.
  Proof: build 25 tasks; check 0 errors, 28 existing warnings;
  all 32 test tasks pass when run one at a time; eight app tests;
  unbound bridge, native dedupe, concurrent SSR, and import guard pass;
  phone auth/save/spans pass; prose, TSDoc, and strict census pass.
  The source preview embeds the editable graph and highlights one file at a time.
  Native live inspection and cross-side trace work remain open.
  [Track](docs/roadmap/start-scaffold/PROGRESS.md).

- **stack/t16 generator** — `vp create stack-app` (`@tinker/create-app`, registered in the root `vite.config.ts`) writes a full app into `apps/<name>` on `workspace:*`: server, migrate step and first migration, static store, a synced cell, live updates over NATS, a job and a cron row, mail with a React Email template, auth (sign-up, sign-in, verify, reset), a server-rendered list page, the trace sink, and the dev host; settings read at the root with a `.env.example`; each piece one row. Its tests generate an app in a temp place, then build, check, and test it (28 starter tests, a real browser test) and remove it. Proof: gate EXIT 0 (generator 12, tracker 128; 0 errors, 28 warnings), changed-file mutation 87.27% (48/0/7), validate 56/56. Lead review. Sol writer 04639f26. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t15 server-pages** — the tracker's pages render on the server with TanStack Router 1.170.40 (pinned) under one Hono route: `@tinker/stack`'s `pages()` piece reads the page's cells in the request's session, renders, and streams the HTML through Hono's `stream`, so the session stays open until the stream ends and commits then (ADR 0084); the browser boots from those values, then the SSE wire takes over; 404 pages stay server pages; the dev host renders pages through Vite and an edit shows on reload. Proof: gate EXIT 0 (stack 152, hono 93, tracker 128; 0 errors, 28 warnings), browser proof 4/4, changed-file mutation stack 86.02% (203/2/31), tracker 85.83% (327/3/51), validate 54/54. Lead review. Sol writer 3dc1eaaa. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **authoring/package-roles** — all 16 package roles checked.
  Removed unused `utils`; Drizzle and React entries name their roles.
  Opus high review READY; build, check, full tests, and 54 release checks pass.
  Current-main checks pass; all six docs pass prose and phone checks.
  [Track](docs/roadmap/authoring-model/PACKAGE-ROLES.md).

- **stack/start-log-cleanup** — the stack pieces log through their hook's logger now that core/start-log landed: hono's boot logger resource and its `hono.errors` span are gone; `readExitCode(result, log, phase)` takes a logger instead of `observe` plus `clock`; the server, live, migrate, nats, and jobs pieces drop their direct sink writes (the trace sink keeps its warnings local so they never feed its own queue). Log lines add `extension`. Proof: gate EXIT 0 (all 31 test tasks; 0 errors, 28 warnings), changed-file mutation hono 86.87% (397/0/60), jobs 85.33% (128/5/17), stack 87.25% (267/0/39), validate 54/54. Lead review. Sol writer 4f788859.

- **process/role** — settled as app entry support.
  CLI host adapter; graph modules and helper libraries have clear roles.
  Proof: public API and callers reviewed; 48 Process tests pass;
  prose has 0 hits; all five touched docs pass the phone-width check.
  [Track](docs/roadmap/authoring-model/PROGRESS.md#process-is-app-entry-support).

- **stack/t14 dev-host** — `vp run dev` is one process, the dev host (`@tinker/stack/dev`): it keeps the HTTP listener, one PGlite, a local `nats-server`, and Vite (client HMR) for the whole session; a server edit re-imports the app, stops the old root through its signal, and starts a new one with the lent handles (`runServer(env, stop, host?)`; the store takes `{ kind: "borrow", client }`). Old requests finish; a failed edit keeps the host up and answers the error until the next good edit; SIGTERM closes everything. Only the dev host binds defaults: the tracker in prod now needs `PORT`, `HOST`, `DATA_PATH`, and `NATS_URL` (its no-NATS local mode is gone). `benchctl ab`: a reload beats a restart, 20,882 → 7,288 ms (−65%). Proof: gate EXIT 0 (stack 135, nats 36, drizzle 43, tracker 87; 0 errors, 28 warnings), changed-file mutation stack 85.75% (319/1/52), nats 88.10% (111/0/15), validate 54/54. Lead review of the prod path. Sol writer c4f5f4d3. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **process/thin-entry** — native command and service ownership.
  Object calls, static shells, caller-owned output, and guarded main entries.
  All callers moved; Opus high review READY.
  Proof: full build, check, 31 test tasks; Process 48; strict census and prose.
  Fresh fault scores: Process 86.00, Blueprint 86.23, Tinkerer 91.82.
  Release checks 54/54; three outside-repo example copies pass.
  [Track](docs/roadmap/authoring-model/PROCESS.md).

- **process/model-review** — basic jobs and extra layers reviewed.
  Proof: build, check, 50 tests, and strict style census pass.
  Real probes show lost pipe output, ignored cleanup, and a loader stop gap.
  Smaller command and service cases are proposed; no runtime code changed.
  [Review](docs/roadmap/authoring-model/PROCESS-REVIEW.md).

- **stack/t11 auth-mails** — sign-up sends a verify mail and a reset request sends a reset mail, both through `sendMail` (React Email templates in `@tinker/auth`; an app can pass its own); links use `BETTER_AUTH_URL`, the sender comes from mail; mail stays optional. The mail job is added after Better Auth commits, so PGlite's one connection takes turns; if that insert fails the account stays and the mail is lost (the README says so). Six HTTP tests: verify link marks the email verified, reset link sets the new password, a duplicate sign-up sends nothing. Proof: gate EXIT 0 (auth 25, mail 13, jobs 26; 0 errors, 28 warnings), changed-file mutation 88.03% (103/0/14), validate 54/54. Lead review. Sol writer bcb8d8e0. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **core/start-log** — a log written in an extension's event-form `start` or `close` hook now reaches the scope's sink, with the level filter and clock, named by the extension, no span (on main both printed `[]`; five askers: stack t02, t05, t07, t08, t13). The logger is built once per extension on first use; logging off stays a no-op. Proof: gate EXIT 0 (core 796, all repo tests; 0 errors, 28 warnings), slots headroom 4, size 16,350 B (cap 16,384), N=31 timing all "no difference we can see", changed-line mutation 85.71% (6/0/1), validate 54/54. Lead review. Sol writer c3f272c1. The stack pieces' workarounds can go now (a follow-up card).

- **stack/t09 mail** — `@tinker/mail` on Upyo 0.6.0 and React Email (pinned): the app's operation calls `sendMail` (template + props + to/subject), which adds a mail job through the request's transaction, so a rolled-back request sends nothing; the job renders HTML and text and sends; a retryable failure retries, a permanent one fails once via `failJob(cause)` (new in `@tinker/jobs`); `MAIL_URL` (`smtp://`, login optional so Mailpit works) checked in start; a log backend for dev and Upyo's mock for tests. Proof: gate EXIT 0 (mail 13, jobs 26, stack 114; 0 errors, 28 warnings), mail mutation 89.09% (98/0/12), release checks 54/54. Lead review (one fix: optional SMTP login). Sol writer daf6d3a7. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **authoring/main-entries** — static exports and guarded app entries.
  Proof: READY review; build, check, all 30 test tasks, and prose pass.
  All ten fresh example copies and 52 release lanes pass.
  Thirty imports start nothing; stop probes keep the finished reply.
  Cleanup, strict style census, and TSDoc checks pass.
  [Proof](docs/roadmap/authoring-model/ENTRIES.md).

- **authoring/drizzle-pglite** — static PGlite units and a migration action.
  Tracker and example use namespace config and session transactions.
  Proof: Opus review READY; build/check, 28 test tasks,
  browser-helper 7, 48 release checks, Drizzle faults 87.97 >= 85.
  All 336 inputs match; all 14 package fault scores pass.
  [Track](docs/roadmap/authoring-model/PGLITE.md).

- **stack/t08 jobs** — `@tinker/jobs` runs pg-boss 12.35.0 (pinned) as a driver: each job's operation runs in its own session, success commits, a throw rolls back and retries, after the limit one `job failed` line; an operation adds a job through the request's transaction, so a rolled-back request (including a mapped 4xx, ADR 0084) adds none; cron rows through pg-boss; a queue no row lists raises `UnknownQueue` before touching the database; a restart applies changed rows; Drizzle migrates before pg-boss starts in its own `pgboss` schema; PGlite borrows the store's client, Postgres needs `JOBS_URL` (checked in start). Event-form hooks and the static store resource (ADRs 0093, 0094). Proof: gate EXIT 0 (jobs 25, stack 114, auth 19, tracker 79; 0 errors, 28 warnings), jobs mutation 87.10% (135/0/20), stack 85.87% (553/2/89), validate 52/52. Reviewer READY (b372d629) before the resume; Sol rebase writer 04d6e604; the lead rebased onto stack/t10 and landed. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t10 auth-signin** — `@tinker/auth`: Better Auth 1.7.6 (pinned exact, with its Drizzle adapter and the `auth` CLI) for email and password sign-up and sign-in, mounted at `/api/auth/*` through the hono wiring; its tables live in `pgSchema("auth")` in the app's one migration history (the app's `schemaFilter` is `public` and `auth`, never `pgboss`) with an auth drift check; the signed-in user is read from the cookies BEFORE the request's transaction opens (hono tags may return a promise; a graceful close drains accepted reads and answers 503 meanwhile; 499 after a forced close or a client abort). Review fixes: the refreshed session cookie now reaches every reply (users were signed out after 7 days), including raw `Response` answers. ADR 0084 holds with async tags. Event-form hooks and static database resources (ADRs 0093, 0094). Proof: gate EXIT 0 (auth 19, hono 93, stack 114, tracker 79; 0 errors, 28 warnings), browser proof, auth mutation 86.00% (86/0/14), hono 86.38% (406/0/62), validate 50/50. Reviewer 06eab677 (two rounds; the lead checked round 2). Sol writer cfabd9f8. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **authoring/hooks** — one event hook form; native static Drizzle resources.
  Owner: lead (authoring session); Astra writers, xhigh, one package each.
  Next: complete; namespace instances and session transactions are explicit.
  Verify: build/check, 28 test tasks, 48 release lanes, and 207 event calls pass;
  all 14 fault scores >= 85; fresh Drizzle 96.77, Hono 93.01, Stack 85.91.
  [Track](docs/roadmap/authoring-model/HOOKS.md).

- **stack/t18 roots-signal** — `@tinker/stack` drops `runUntilStop` for `readExitCode(result, observe, phase)` over a plain `Result` (ADR 0085 §6: failed or any teardown error answers 1, else 0, `cancelled` included); the tracker's server root passes its stop signal to `createScope({ signal })`, takes the phase from which way `scope.ready` settled, and awaits `scope.closed`. A failed boot keeps its teardown errors in the log line; a failed telemetry boot is covered. SIGTERM exits 0; a bad `PORT` exits 1 with one "boot failed" line and no database touched. No `runUntilStop` left; the lifetime lint (S19, S27–S29) prints no row. Proof: gate EXIT 0 (stack 114, tracker 79; 0 errors, 28 warnings), browser proof, stack mutation 85.63% (548/3/89), validate 48/48. Review: the first reviewer (5d41ea28) stopped in the 05:53 restart after one fix round; the lead reviewed the final diff. Sol rebase writer f63d5891. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **examples/standalone** — all eleven examples run on their own.
  Owner: lead (Codex); Astra writers; Opus 5.5 READY.
  Proof: every exported copy passed install, check, tests, and run.
  Full build, check, package tests, prose, and strict census passed.
  All 48 release checks passed; Jev calibration is saved.
  [Track](docs/roadmap/examples-v1/PROGRESS.md).

- **stack/t17 hono-commit** — a request commits before it answers: a close that is not clean (failed commit, failed hook, any teardown error) answers a fresh 500 and logs one `RequestCloseFailed` line; any raised error (mapped 4xx, body builder, unmapped, plain Error, HTTPException) rolls the request back and its answer is unchanged; a returned (not raised) 4xx commits; a stream commits at its end and errors on a failed commit (ADR 0084, user 2026-09-29). The server piece shuts its port when close starts and keeps per-start state (`PieceInUse` on a second live root). Rebased onto the authoring-model main (kept its abort and stream-start cleanup, call ownership, trace reads). The new tests fail on main in 9 places. Proof: gate EXIT 0 (hono 86, drizzle 25, stack 111, tracker 79; 0 errors, 28 warnings), browser proof 4/4 uncached, hono mutation 86.85% (370/0/56), stack mutation 85.71% (552/3/89), validate 48/48. Reviewer READY (839f6123) before the resume; Sol rebase writer 4783edd2; landed by the lead. [track](docs/roadmap/stack-v1/PROGRESS.md).

- **authoring/packages** — checked all 14 packages and all three apps.
  Owner: lead (authoring session); source: `46bf1f74`.
  Fixed owner, namespace, setup, and steering gaps with public tests.
  Core call signals stop one action and leave its parent alive.
  Trace is a reusable extension with its own telemetry scope.
  Added the two-service Harness example and the authoring guide.
  Proof: build/check, all 18 test tasks, prose, and 48 release lanes pass.
  All 14 package fault scores pass the floor of 85; Stack is 85.95.
  Main's fresh install and checks pass; all 374 checked inputs match.
  Core is 16,384 bytes gzip at the approved 16 KiB cap.
  Checkpoint tag: `core/tauthoring-packages`.
  [Track](docs/roadmap/authoring-model/PACKAGES.md).

- **process/early-abort** — startup abort stops before the command runs.
  Owner: lead (authoring session); source: `5b7a0cd5`.
  Proof: the public regression failed before the fix and now returns 130.
  Process 50 tests pass; code check has 0 errors; fault score 94.61.
  Root completion uses a signal and waits for `closed`.
  [Track](docs/roadmap/authoring-model/PACKAGES.md).

- **react/namespaces** — reset and refetch keep sibling project stores.
  Owner: lead (Codex); source: `878ca7ba`, Playground: `a8f131ff`.
  Pushed to main; [live Sessions lab](https://playground.tini.works).
  Proof: two red checks before the fix; React 83 and Playground 64 tests pass.
  Full build/check/tests, 48 release lanes, and React fault score 93.10 pass.
  The live image is healthy and its files match the checked build.
  Live resets, route return, caches, and source navigation pass at three widths.
  [Track](docs/roadmap/react-v1/PROGRESS.md).

- **playground/awwwards** — refined sea, Code, and Benchmark are live.
  Proof: source `c55801d3`; build/check, 17 test tasks, 48 release lanes pass.
  Paired storm verdict: b is faster; 25.5% less time in the headless check.
  Deployment done, healthy image, matching live files, desktop and phone checks pass.
  [Track](docs/roadmap/playground-v2/PROGRESS.md).

- **authoring/model** — lazy object hooks and all five module fixes.
  Landed and pushed at `dfaad530`; tag `core/tauthoring-model`.
  Core: 16,373 bytes gzip under the approved 16 KiB cap.
  Proof: build/check, all 17 test tasks, 48 release lanes, and prose passed.
  All 14 package fault scores meet the floor of 85.
  The eight task checkouts and branches were removed.
  [Track](docs/roadmap/authoring-model/PROGRESS.md).

- **migrate/root-lifetime** — Astra writer + Opus review (one fix round); tag `migrate/root-lifetime`; ADR 0085. Every root outside core and stack stops closing itself after a rejected `ready`: the tracker's test fixtures and `src/client/main.tsx`, the examples, and the sync tests (each ran its close hooks twice since core/root-lifetime; a tracker test now counts one close). `examples/mcp/serve.ts` is the model entry: `createScope({ …, signal: AbortSignal.any([stop, ended.signal]) })`, `await scope.closed`, exit code failed → 1, teardown errors → 1, else 0. S29 rows left: only stack's `runUntilStop` (stack/t18). Tracker 79 tests, browser 7, sync mutation 86.60 (398 killed, 9 timeout, 61 survived, 2 no cover), validate 48 PASS. Jev: 2 `inputDefaultMasks` labels; calibrated (proven, sep 54%, ordered 95%).

- **stack/t13 trace-sink** — the stack's trace sink sends spans and logs as OTLP/JSON to `OTEL_EXPORTER_OTLP_ENDPOINT` (our own writer, no dependency, ~10 KB): spans queue by reference and encode at flush (the sink adds ~5 µs per request over local JSON logs); bounded queue; a dead or slow collector never fails a request, a forced close aborts in 4 ms, a graceful close flushes within 1 s; ok spans UNSET, failed spans code 2; logs carry severity and their span's ids; `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` checked in start. NATS publish carries `traceparent`; a subscriber joins the trace; tracing off sends no header. Payload checked against the official OTLP proto code. Proof: gate EXIT 0 (stack 92, nats 24, tracker 79), stack mutation 85.61% (465/5/76), nats mutation 92.74% (166/0/10), validate 48/48. Reviewer READY (52f8099b). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **jev/lifetime-rules** — Astra writer + Opus review (one fix round); tag `jev/lifetime-rules`; ADR 0085 §7. S19 (a helper that takes a scope, controller, or session) now also runs in the repo lint for `apps/*/src`, `examples/`, and `packages/stack/src`, and sees `Scope.RootHandle`. New S29, a root's lifetime written by hand: S29.ready (a `try` that only awaits a root's `ready` and whose `catch` closes that same root, or `ready.catch`/`.then(_, fail)` that does) and S29.stop (a graceful close after a hand-written wait on an abort). The lint reads test files for S29 only. Repo rows today: S19 at `packages/stack/src/stop.ts`, S29.ready at 12 spots that migrate/root-lifetime and stack/t18 remove. Jev tests 144, writer-trial tests 60.

- **core/root-lifetime** — Astra writer + Opus review (one docs fix round); tag `core/root-lifetime`; ADR 0085. `createScope({ signal })` returns a `Scope.RootHandle`: an abort closes the root gracefully once `ready` resolved, and `closed` holds core's one close `Result` (signal roots only, a plain property). `ready` now rejects only after the forced close ended, and core's own closes (a failed start, the signal) go through the handle's `close`, so every close hook runs (they were skipped on a failed start). Two tests failed on main first. Core 750 tests, mutation 85.66 (2742 killed, 29 timeout, 436 survived, 28 no cover), validate 48 PASS, slots end at 254, size 14,981 B, benchd N=61: `create` +0.8% (32/61), `lifecycle` −0.5% (30/61), `cold` +0.5% (35/61), `cold2` +0.7% (36/61), `s1_getctl` −0.6% (24/61), `s2_data` −0.2% (31/61), `s3_doubled` −0.3% (23/61), `session` −0.5% (28/61): all no difference we can see. Known until the migrations land: roots that still catch a failed `ready` and close by hand run each close hook twice (every hook is safe to); a close wrapper that waits before core's close can still see a second close (core/close-hook-scope).

- **stack/t06 migrate-step** — the tracker's tables come from Drizzle migration files: the stack's migrate step (listed right after the server piece) takes a Postgres advisory lock, brings an old hand-migrated database level (a baseline that keeps every row, from any point of its history), runs the migrations, and releases the lock before the port opens; `@tinker/drizzle` runs the folder and gives a drift check (`SchemaDrift` with drizzle-kit's answer); the stack's test helper migrates once and hands each test a PGlite `clone()`. Never `push`. The lock is proven only on PGlite (one connection, never contended). Proof: gate EXIT 0 (drizzle 25, stack 63, tracker 79), browser proof, config test 3/3, drizzle mutation 93.86% (107/0/7), stack mutation 88.89% (253/3/32), validate 48/48. Reviewer READY (49d197f1). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t04 trace-id** — core: every observed span carries a W3C trace id and span id (lazy hex, private id stream: observation never moves a seeded `ctx.random`, ADR 0086); a session can join a remote trace; hono reads `traceparent`, http sends it; core imports no OTel; nothing draws at import (Workers-safe). Cost: `opobs` +8 ns (+4%, N=61), accepted by the user. Proof: gate EXIT 0 (core 731, hono 71, http 86), slots headroom 1, impact 0, mutation core 85.38% at 60 s (2687/29/437; killed 85.22% of decided) / hono 86.09% (291/0/45) / http 89.70% (446/7/45), validate 48/48, N=61: no other row slower. Reviewer READY (43da66df). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t12 live-across** — a save on one server reaches tabs on another: after a commit the stack's live piece sends one empty signal per app over NATS, and every server (the sender too) re-reads from the database; no signal on a GET, a rolled-back save, or a failed commit; a handled 4xx that saved still signals. Reviewer probes: a burst of 10 saves ends on the final list everywhere. Later: send the signal whenever the commit works, not only when the sender's own re-read works. Proof: gate EXIT 0 (stack 58, nats 19, tracker 69), browser proof, stack mutation 89.47% (238/0/28; the stack lane now waits 60 s per mutant: at the default limit it gave 226/15/25 and its timed-out mutants left `/tmp/tinker-nats-*` stores), validate 48/48. Reviewer READY (0420f317). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t07 nats** — `@tinker/nats` on the NATS v3 client (pinned): the extension checks `NATS_URL` in start and connects at boot even with no subscriptions (fail fast on an unreachable server, a deliberate reading of ADR 0081 §4); publish is an operation; a subscription row runs its operation in its own session per message, a failure logs one line and the next message runs; close drains then closes; a second live start of one piece fails `PieceInUse`. Tests run a real `nats-server` v2.15.0, SHA-256 checked, cached. Proof: gate EXIT 0 (nats 19), nats mutation 91.43% (224/0/15 at 60 s; the lane's 10 s limit gave 193/31/15, same score), validate 48/48. Reviewer READY (f9c360e0). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t02 hono-errors** — a managed error becomes its HTTP answer through `@tinker/hono`: an error table maps a kind to a status, or a status plus a body from the payload (Rails `rescue_responses`); an unmapped error logs one line through the scope's sink and answers 500; `HTTPException` keeps its response. The tracker declares its table; every answer is byte-for-byte the same (reviewer probed each kind). Proof: gate EXIT 0 (hono 68, tracker 69), browser proof, hono mutation 85.27% (249/0/41), validate 46/46. Reviewer READY (f0f42868). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t03 drizzle-rc** — the repo runs on one exact Drizzle 1.0 RC: `drizzle-orm` and `drizzle-kit` `1.0.0-rc.4` pinned in the catalog (ADR 0079); `@tinker/drizzle` accepts `^0.45.2 || ^1.0.0-rc.4` (reviewer proved 0.45.2 still works: the package never imports drizzle-orm); the tracker builds its client the 1.0 way. Proof: gate EXIT 0 (drizzle 13, tracker 69), browser proof, drizzle mutation 88.14% (killed 52 / timeout 0 / survived 7; the lane's default 5 s limit starves on this box: 39 / 20 / 0 twice, main 34 / 24 / 1, so the proof run used `--timeoutMS 60000 --concurrency 2`), validate 46/46. Reviewer READY (de555b1a). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t01 sync-sse** — `@tinker/sync/sse` ships the SSE transport, both halves: `createSseServer(write, signal)` over a plain chunk writer (sync imports no Hono) and `createSseClient({ open, onState, onRetry })`; the tracker and the sync example dropped their copies. Reviewer ran 20,000 random event sequences old vs new: 0 differences. Proof: gate EXIT 0 (sync 69, tracker 69), browser proof 4/4 uncached, sync mutation 86.81%, validate 46/46. Reviewer READY (e9e3562c). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **stack/t05 stack-server** — `@tinker/stack` exists: the server stack piece checks `PORT`/`HOST` in its start (one `BadListenSettings` names every bad key), opens the port after every other start, serves the built client; `runUntilStop` answers the exit code; `jsonLines` writes the logs. The tracker's entry uses it; its root is still one function (ADR 0078). Proof: gate EXIT 0 (stack 38 tests, tracker 69), browser proof (7 tests), stack mutation 87.68%, validate 46/46. Reviewer READY (c2cdb8c8). [track](docs/roadmap/stack-v1/PROGRESS.md).

- **entries/follow-suit** — Astra writer + Opus review (one fix round); tag `entries/follow-suit`; ADR 0078. Every backend entry and example root now follows ADR 0078; the S27/S28 lint prints no row over apps, examples, and package source (6 rows on main before). Guarded: `packages/blueprint/src/main.ts`, `examples/mcp/cli.ts`, `examples/process-cli/main.ts`; `examples/mcp/serve.ts` became one root function (stops on SIGINT, SIGTERM, or stdin end; review fix: a closed stdin crashed it with exit 13). `boot()` left `examples/sync/hono.ts`; the sync test builds its own root `[web, src]`. The hono, mcp, and sync tours close a rejected `ready`. The `packages/mcp/README.md` entry snippet is guarded. Browser roots stay out of scope. validate 44 PASS, blueprint mutation 86.27, sync mutation 86.49.

- **perf/tagged-100** — a tagged call copies its bindings into a one-item list first, not an empty list that grows; reads match `readMany` exactly (list iterator once, no caller methods, no re-read). Fable writer (`5234b4b` + fix `5ecc245`); Astra cross-review READY (8 differences fixed; 820 + 627 checks MATCH); tag `perf/tagged-100`. benchd N=61 vs `2148e48`: `tagged` 188.3 → 171.3 ns (−9.0%, 5/61), `taggeddefer` 346.8 → 329.3 (−5.0%); no row B slower in all 23, `warm` no difference we can see. Core mutation 85.59; 715 tests; promises tagged 2; validate 44 PASS. New rule: `tagged` ≤ 200 ns. With every rule kept the floor is about 145–150 ns; 100 needs ADR 0038 dropped for tagged calls and a tag API that allocates nothing; the user chose to stop (2026-09-29) ([budgets](docs/roadmap/core-v1/budgets.md)).

- **perf/lazy-log-obs** — a body's `log` and `obs` tools are built on first read (getters on the ctx prototype; no API change; ADR 0073); retained ctx fields written once. Astra writer, Fable review (9-case behavior probe, gate), lead READY; tag `perf/lazy-log-obs`. benchd N=61 vs `a4baeb0`: `opsink` 251.9 → 72.0 ns (−71.4%, 0/61), `opobs` 248.9 → 208.4 (−16.3%), `op` −18.9%, `run` −15.7%, `tagged` 198.3 → 188.8 (−4.8%); `oplog` no difference we can see; no row B slower in all 23. Core mutation 85.44; 715 tests; promises tagged 2; validate 44 PASS ([budgets](docs/roadmap/core-v1/budgets.md)).

- **perf/tagged-close** — fp3/fable stack + Astra's lazy tagged child session + mutation lift + warm fix (`nodeState` inline again); reviewed by Opus (code), Astra (758 cases vs main: only ADR 0071/0072 outcomes), Fable (62 lazy-session boundary cases; lift READY); tag `perf/tagged-close`. ADR 0071 (an idle session ends in place) and ADR 0072 (a tagged call that ended in place returns its value). benchd N=61 vs `917ee14`: `tagged` 2150.3 → 198.0 ns (−90.8%, 0/61), `session` 1684.9 → 572.8 (−66.0%), `taggeddefer` −83.8%, `taggedres` −22.1%, `create` −36.6%, `op` −15.7%; `warm` no difference we can see; exception (user): `s4_warm_ctl` 10.6 → 10.9 (+2.8%, 53/61), follow-up perf/warm-ctl-trade. Promises tagged 17 → 2; core mutation 85.33; 710 tests; validate 44 PASS. New rules: `tagged` ≤ 250 ns, `promises_tagged` = 2 ([budgets](docs/roadmap/core-v1/budgets.md)).
