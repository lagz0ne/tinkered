# react v1 — build progress

## Namespace reset — 2026-09-30

The user approved form and route sessions with namespace-aware reset.
The brief is [namespace reset](issues/18-namespace-reset.md).
Source: `878ca7ba`; Playground: `a8f131ff`.

React saves each session's namespace head with its live handle.
Nested sessions inherit it; independent roots clear the React key.
`useRelease(project)` selects an explicit key for reset.
`useResource(profile, { ns: project })` selects its read and refetch key.
Scope resources keep their shared release behavior.
A chain reset keeps fallback stores, which a later read can reuse.
An opaque app-owned scope needs an explicit hook key.
Core source and namespace lifetime do not change.

Two browser checks failed before the source fix.
One caught sibling resource loss; one caught a default value being erased.
Both pass after the fix.
React's 20 browser files and all 83 tests pass.
The gzip build is 4,598 bytes under the 10,240-byte cap.
Build, package check, prose, TSDoc, and strict census pass.
The separate reader found no material bugs.

The Playground has a lazy Sessions view with Harbor and Beacon forms.
It shows field reset, form reset, route leave and return, and brief refetch.
The five added app checks pass with all 64 Playground tests.
Browser checks at 1,440, 390, and 320 pixels pass.
They prove preserved sibling drafts, project caches, and ocean document.
All Sessions buttons meet 44 pixels; phone layouts have no side scroll.

The full build, check, and all 17 test tasks pass.
Check reports no errors and the same 28 existing warnings.
All 48 release lanes pass under the shared test lock.
The final source review has no flags.
The three reviewed Jev labels are false; calibration passes.
SCIP confirms the public hook changes and their callers.
The isolated React fault check passes at 93.10, above its floor of 85.
It catches 219 changed versions and 51 that time out.
Twenty survive; no changed version lacks coverage.
The two new surviving branches pass undefined to Core's existing defaults.
Core implements `release` and `releaseNs` with the same function.
No source change is needed for those equivalent branches.

The checked source is pushed to main.
[Live Playground](https://playground.tini.works).
Dokploy deployment `jQGlXdi_unIfjjaO_MrMH` is done.
The running container is healthy and uses the checked image.
Its image source is `a8f131ff`; later commits only record proof.
The live index, Core file, and React file match the build byte for byte.
Live browser checks pass at 1,440, 390, and 320 pixels.
All reset, refetch, route return, and sibling cache checks pass.
Source navigation works; the same ocean document stays mounted.
No page errors or side scroll were observed.
Main's fresh build and check also pass, with the same 28 warnings.

Proof files are under `.bench/react-namespaces`.

`@tinker/react`: a thin React adapter over `@tinker/core` (ADR 0030). One green git
checkpoint per ticket. Progress is linear and resettable: land tickets in order, tag
each, reset to any tag if a slice goes wrong.

- **Tickets:** `docs/roadmap/react-v1/issues/NN-*.md` (numbered in dependency order).
- **Decisions:** `docs/decisions/0030`–`0033`. **Glossary:** `docs/glossary.md` (React adapter section).
- **Branch:** `core-rebuild`. Tests run in **vitest browser mode** (Playwright chromium, ADR 0033).

## How a ticket lands (deterministic + correct)

1. Build the slice + its seam behavior tests in browser mode (no mocks; deterministic
   async via the r01 deferred fixture — no sleeps, ADR 0003). Navigate the core API with
   the **SCIP** index (see below) rather than guessing symbols.
2. Gate + checkpoint:

   ```bash
   scripts/ticket-react.sh <NN> "<short title>"
   ```

   The gate runs `vp check` + `vp run -r test` + `vp run react#size` (a build+size lane —
   a hard gate, not swallowed). It commits only if green, then sets tag `react/r<NN>`. A
   red gate makes no checkpoint.

3. **Review loop (mandatory).** Send the just-landed tag's diff to the standing reviewer
   and drive it to `SHIP`:

   ```
   paseo agent: codex/gpt-6-astra
   thinking=xhigh, mode=full-access
   read-only reviewer
   round prompt:
     review tag react/r<NN>
     git show react/r<NN>
     ticket issues/<NN>-*.md
   ```

   The reviewer returns a coverage checklist + all findings at once (blocker/should-fix/nit)
   and a `SHIP`/`FIX` verdict. Address every **blocker** (fix + re-gate, moving the tag with
   `git tag -f`), record accepted-as-is nits, then move to the next ticket. The reviewer is
   told never to edit or ask questions (paseo permission responses are unreliable here).

   **Run serial:** do not start the next ticket until the current one's review is addressed. A
   fix often edits the same file a later ticket also touched, so building ahead makes the fix
   land after the later commit (non-monotonic tags). (r02's StrictMode fix was pipelined and so
   landed in the r03 checkpoint — see commit 277ecc5.)

## SCIP code intelligence

`scip-typescript` (0.4.0) is installed in the persistent home. Regenerate a package index
for cross-reference as the code grows (indexes are gitignored under `.scip/`):

```bash
cd packages/core && \
  scip-typescript index --output ../../.scip/core.scip
cd packages/react && \
  scip-typescript index --output ../../.scip/react.scip
# inspect symbols/occurrences
scip print --json .scip/react.scip | head
```

## Reset (git techniques)

- Undo current (unlanded) work: `git reset --hard react/r<last>` (or `core/base`).
- Redo a landed ticket: `git reset --hard react/r<blocker>`, rebuild, re-run the gate.
- Inspect a checkpoint: `git switch --detach react/r07`.

## Order & status

Linear order (each ticket's blockers are all lower-numbered). Mark `x` when its tag exists.

- **react/r01**
  ticket: Browser harness + async fixture
  blockers: —
  status: [x]

- **react/r02**
  ticket: `<ScopeProvider>` + `useScope`
  blockers: 01
  status: [x]

- **react/r03**
  ticket: `useData` reactive read
  blockers: 02
  status: [x]

- **react/r04**
  ticket: `useController` write
  blockers: 03
  status: [x]

- **react/r05**
  ticket: `useData` selector + `isEqual`
  blockers: 03
  status: [x]

- **react/r06**
  ticket: `useResource` sync value
  blockers: 02
  status: [x]

- **react/r07**
  ticket: `useResource` async + Suspense
  blockers: 06, 01
  status: [x]

- **react/r08**
  ticket: `useResource` failed build → boundary
  blockers: 07
  status: [x]

- **react/r09**
  ticket: `useResolve` success path
  blockers: 02, 01
  status: [x]

- **react/r10**
  ticket: `useResolve` error + `reset`
  blockers: 09
  status: [x]

- **react/r11**
  ticket: `<SessionProvider>` lifecycle
  blockers: 04, 07
  status: [x]

- **react/r12**
  ticket: `target:"session"` per-provider sharing
  blockers: 11
  status: [x]

- **react/r13**
  ticket: StrictMode double-mount safety
  blockers: 11
  status: [x]

- **react/r14**
  ticket: `useRelease` + retry/reset
  blockers: 08
  status: [x]

- **react/r15**
  ticket: `useSpans` read
  blockers: 07, 09
  status: [x]

- **react/r16**
  ticket: Opt-in React span emission
  blockers: 15
  status: [x]

- **react/r17**
  ticket: v1 validation milestone
  blockers: 01–16
  status: [x]

Parallel frontier once r01→r02 land: **r03 ‖ r06 ‖ r09** are independent. Then r04,r05 off
r03; r07→r08 off r06; r10 off r09; r11 needs r04+r07; r12,r13 off r11; r14 off r08; r15→r16.

## v1 complete

All 17 tickets landed and **astra-reviewed to SHIP** (`codex/gpt-6-astra` xhigh via paseo). The seam:
`ScopeProvider` / `SessionProvider`, `useScope`, `useData` (+ selector), `useController`, `useResource`
(sync / async-Suspense / failed→boundary), `useResolve` (success / error / reset), `useRelease`,
`useSpans`, `isError`.

Validation (r17): cast-free `README` + `examples/basic.tsx`; full seam exercised by browser behavior
tests (real chromium). One core change was needed and re-validated: a **sticky rejected build** (r08 —
a failed async build is cached at the owner until release/close, so a Suspense retry doesn't loop).

**Post-v1 revert — r16 emission removed.** The opt-in `react.*` marker emission (r16) and the core
`scope.event()` it used were **reverted**: as built, the markers only re-labeled work core already
spans and never captured React-only facts (component identity, suspend/commit) — near-redundant. The
useful version ("pending stage of a resolve"; per-component lifecycle) needs a real observation
redesign — core records a span only on **close**, so a _pending_ resolve is invisible to `spans()`
(confirmed empirically). Left for a dedicated design pass (a listener-gated, typed event bus +
push-on-open pending spans), not a v1 bolt-on. `useSpans` remains (reads core's own work spans).

Core after the revert: mutation ~77% (≥ 60), size ~15 KB (cap 30), all deterministic `validate.mjs`
lanes PASS. react bundle **3.1 KB gzip** (cap 10).

**Mutation deferral cleared — checked 2026-09-30.**
The Stryker browser lane landed at `3cb27e5c`.
The floor rose to 85 at `887ee5e`; that isolated run scored 93.16.
The current config still uses Chromium browser tests and two workers.
The later authoring package run records React at 92.75, above the floor of 85.
[Saved proof](../authoring-model/package-fault-proof.json).
Only `react/observation` remains Parked.
[Current review](../parked-review/PROGRESS.md#reactobservation).
