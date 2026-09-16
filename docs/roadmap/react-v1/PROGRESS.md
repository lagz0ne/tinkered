# react v1 — build progress

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
   paseo agent: codex/gpt-6-astra, thinking=xhigh, mode=full-access  (read-only reviewer)
   round prompt: "review tag react/r<NN>; git show react/r<NN>; ticket issues/<NN>-*.md"
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
cd packages/core  && scip-typescript index --output ../../.scip/core.scip
cd packages/react && scip-typescript index --output ../../.scip/react.scip
scip print --json .scip/react.scip | head   # inspect symbols/occurrences
```

## Reset (git techniques)

- Undo current (unlanded) work: `git reset --hard react/r<last>` (or `core/base`).
- Redo a landed ticket: `git reset --hard react/r<blocker>`, rebuild, re-run the gate.
- Inspect a checkpoint: `git switch --detach react/r07`.

## Order & status

Linear order (each ticket's blockers are all lower-numbered). Mark `x` when its tag exists.

| tag       | ticket                                  | blockers | status |
| --------- | --------------------------------------- | -------- | ------ |
| react/r01 | Browser harness + async fixture         | —        | [x]    |
| react/r02 | `<ScopeProvider>` + `useScope`          | 01       | [x]    |
| react/r03 | `useData` reactive read                 | 02       | [x]    |
| react/r04 | `useController` write                   | 03       | [x]    |
| react/r05 | `useData` selector + `isEqual`          | 03       | [x]    |
| react/r06 | `useResource` sync value                | 02       | [x]    |
| react/r07 | `useResource` async + Suspense          | 06, 01   | [x]    |
| react/r08 | `useResource` failed build → boundary   | 07       | [x]    |
| react/r09 | `useResolve` success path               | 02, 01   | [x]    |
| react/r10 | `useResolve` error + `reset`            | 09       | [x]    |
| react/r11 | `<SessionProvider>` lifecycle           | 04, 07   | [x]    |
| react/r12 | `target:"session"` per-provider sharing | 11       | [x]    |
| react/r13 | StrictMode double-mount safety          | 11       | [x]    |
| react/r14 | `useRelease` + retry/reset              | 08       | [x]    |
| react/r15 | `useSpans` read                         | 07, 09   | [x]    |
| react/r16 | Opt-in React span emission              | 15       | [x]    |
| react/r17 | v1 validation milestone                 | 01–16    | [x]    |

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

Deferred (noted): react-package **mutation** lane (Stryker × browser mode is its own integration).
