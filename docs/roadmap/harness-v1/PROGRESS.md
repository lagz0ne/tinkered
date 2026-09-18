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

| tag         | ticket                                                                                              | blockers | status |
| ----------- | --------------------------------------------------------------------------------------------------- | -------- | ------ |
| harness/t01 | Package + frame + Claude Code adapter + ambient cells + `turn` op; fake adapter + recorded fixtures | —        | [ ]    |
| harness/t02 | Codex adapter (same frame), recorded `ThreadEvent` fixtures                                         | 01       | [ ]    |
| harness/t03 | Approvals as operations (`canUseTool` / approval mode → a subflow)                                  | 01       | [ ]    |
| harness/t04 | Tools as operations (in-process MCP; the tool's run is a subflow of the turn)                       | 01       | [ ]    |
| harness/t05 | Validation milestone: size, mutation, README + cast-free example, validate lanes; SHIP              | 02–04    | [ ]    |

### Verify — see the ticket lines in `TODO.md` (kept there while the milestone is open).

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention, one promise per test, gate re-run,
SCIP refs for public symbols), cherry-picks, runs the mutation lane alone, tags. Reports end with
**Core feedback**.
