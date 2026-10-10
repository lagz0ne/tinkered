# harness v1 — build progress

Harnesses (Claude Code, Codex) as one frame over the harness's own SDK types: adapters are resources
that import the SDK, the thread is a session resource, what the thread knows is ambient data, and a
turn is an operation (ADR 0043). Package `packages/harness` (`@tinker/harness`), peers
`@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk` (imported lazily inside the adapters), size
cap 10 kB gzip, no core change.

- **Decision:** `docs/decisions/0043-harness-is-a-session-thread-with-ambient-state.md`.
- **Glossary:** `docs/glossary.md` → "Harness" (`harness`, `adapter`, `thread`, `ambient state`, `turn`).
- **Gate + tag:** `scripts/ticket.sh harness <NN> "<title>"` → `harness/t<NN>`; validate lanes at t05.
- **SDK facts (read from the packages, 2026-09-18):** Claude Agent SDK 0.3.275 — `query({ prompt, options })`
  → `Query` (AsyncGenerator<SDKMessage>; `interrupt()`, `setPermissionMode()`, `setModel()`), options incl.
  `cwd, model, permissionMode, allowedTools, canUseTool, hooks, mcpServers, resume, abortController,
systemPrompt, maxTurns, effort, thinking, maxBudgetUsd, includePartialMessages`; result message carries
  `session_id, total_cost_usd, usage, model_usage`. Codex SDK 0.155.0 — `new Codex(opts).startThread(threadOpts)`
  / `resumeThread(id)`, `thread.run(input, { signal, outputSchema })` → `Turn { finalResponse, items, usage }`,
  `thread.runStreamed()` → `ThreadEvent` (thread.started, turn.started/completed/failed, item.*, error).

## Order & status

- **harness/t01** — Package + frame + Claude Code adapter + ambient cells + `turn` op; fake adapter + recorded fixtures
  blockers: —
  status: [x]
- **harness/t02** — Codex adapter (same frame), recorded `ThreadEvent` fixtures
  blockers: 01
  status: [x]
- **harness/t03** — Approvals as operations (`canUseTool` / approval mode → a subflow)
  blockers: 01
  status: [x]
- **harness/t04** — Tools as operations (in-process MCP; the tool's run is a subflow of the turn)
  blockers: 01
  status: [x]
- **harness/t05** — Validation milestone: size, mutation, README + cast-free example, validate lanes; SHIP
  blockers: 02–04
  status: [x]

### Verify — see the ticket lines in `TODO.md` (kept there while the milestone is open).

### Landed

- **harness/t01** — sha: 87e5023
  tests: 7
  size (B gzip): 3722
  mutation: 69.27
  notes: The SDK module is a resource (`claudeCode.sdk`) and the seam
  no `Thread.interrupt` (the signal is the interrupt — ops settle before defers)
  a forced close seals the session.
- **harness/t02** — sha: 97e284b
  tests: 14
  size (B gzip): 5279
  mutation: 66.74 (codex.ts 60.00 — t05 adds one all-keys options-split test)
  notes: `Hooks.resume` replaces `withResume`
  Codex options split by key
  agent text growth → deltas
  `turn.failed` → `TurnFailed`
  Codex SDK has no approval callback / in-process tools.
- **harness/t03** — sha: b46ae7f
  tests: 17
  size (B gzip): 6049
  mutation: 64.38
  notes: approve op at frame construction (option A), a subflow of the turn
  `Harness.Calls` type-level record per adapter
  `claudeCode.approval` guard-parse
  the decision lands in `items`. Lead-built.
- **harness/t04** — sha: 658863e
  tests: 21
  size (B gzip): 6746
  mutation: 64.38
  notes: `claudeCode.tool` builder
  `tool:<name>` deps spread into the turn op
  one MCP server per thread (`Hooks.label`)
  zod + MCP SDK devDeps only. Lead-built.
- **harness/t05** — sha: e49fafa
  tests: 22
  size (B gzip): 6746
  mutation: 64.38
  notes: 29 validate lanes (4 harness lanes)
  all-keys Codex options-split test
  README pass. SHIP.

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention, one promise per test, gate re-run,
SCIP refs for public symbols), cherry-picks, runs the mutation lane alone, tags. Reports end with
**Core feedback**.
