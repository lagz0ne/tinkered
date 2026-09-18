# 0043 A harness is a session thread with ambient state; adapters keep the harness's own types

Date: 2026-09-18. Status: accepted. Refines: 0034 (dedicated capability), 0021 (streaming = data
cells), 0028 (close modes), 0038/0039 (session-level bindings), 0042 (a lazy module is a resource).

## Context

"Claude" and "Codex" are **harnesses**: agent loops with their own tools, sessions, permissions,
and event streams — the Claude Agent SDK (`query({ prompt, options })` → an `AsyncGenerator` of
`SDKMessage` with `interrupt()`, `setPermissionMode()`, `setModel()`, sessions resumable by id)
and the Codex SDK (`new Codex(opts).startThread(threadOpts)` / `resumeThread(id)`,
`thread.run(input, { signal, outputSchema })`, `thread.runStreamed()` → `ThreadEvent`s). Both are:
open a thread, run a turn with a prompt, stream events, get a result with usage, resume by id,
interrupt, ask for approvals, expose tools. Their option sets are large and mostly fixed at
thread start (cwd, model, permission or sandbox mode, allowed tools, MCP servers); only a few
things change per turn (the prompt, an abort signal, an output schema).

Three rules from authoring apply. **Do not reinvent the harness's constraints**: expose the
SDK's own option and result types at the level the SDK allows them, never a normalized
"harness config". **We own the ambient context**: what a thread knows — status, streamed text,
tool activity, usage, cost, its id — is state every operation in the session may read, as data
cells and tags, not a private event stream. **A lazy module is a resource**: an adapter imports
its SDK inside a resource factory, so declaring a harness loads nothing.

## Decision

```text
harness({ label, adapter })               a dedicated capability, generic over the adapter's own types
├── adapter.options   (tag)                the SDK's OWN thread-level options type, bound at scope or session
├── adapter           (resource, scope)    factory imports the SDK; returns Harness.Backend<Options, Turn, Result>
├── x.thread          (resource, session)  backend.start(options merged nearest-first, { resume?, signal, emit }) — one per session
│                                          forced close → interrupt/abort + kill; graceful → let the turn finish
├── x.status / x.text / x.items / x.usage / x.id / x.events   data cells, written by the thread as events arrive
└── x.turn({ label, input?, request, response? })   an op: request(input) → { prompt, ...the SDK's per-turn options };
                                           result = the SDK's own result; span attrs (adapter, model, tokens, cost); one `harness turn` log line
```

- **Adapters keep the SDK's types.** `claudeCode.options` is the Claude Agent SDK `Options`;
  `codex.options` is the Codex SDK's `CodexOptions & ThreadOptions`; a turn's per-call options are
  the SDK's (`TurnOptions` for Codex; prompt shape for Claude). The frame never invents a
  cross-harness config; what cannot change per call in the SDK cannot change per call here.
  Merging follows ADR 0012/0038: nearest binding wins per key, so a session may override `cwd` or
  `model` where the SDK allows it at thread start.
- **The adapter is a resource** whose factory does `await import("@anthropic-ai/claude-agent-sdk")`
  (or the Codex SDK) and returns a `Harness.Backend`. The one interface we own, kept minimal:
  `start(options, hooks) → Thread`, `Thread.run(turn) → Promise<Result>`, `Thread.interrupt()`,
  `Thread.close()`, plus `hooks.emit(event)` for the raw SDK event stream and `hooks.signal`.
  Tests `preset(adapter, () => fake)`; the real SDKs run in examples only (auth + a binary).
  Each adapter's event → cell mapping is a pure function tested with recorded SDK messages.
- **The thread is a session resource** (ADR 0038 reach: a tagged call or a request opens one).
  `x.resume(id)` is a binding on the session that makes `start` resume rather than begin. A
  forced close interrupts the harness and kills its process (the turn settles `cancelled`); a
  graceful close waits for the running turn.
- **Ambient state is data.** The frame declares cells per harness: `status` (`idle | running |
done | failed`), `text` (the assistant text of the current turn, streamed), `items` (tool calls,
  commands, file changes as the SDK reports them), `usage` (input/cached/output tokens, cost
  when the SDK reports it — Claude does, Codex does not), `id` (session/thread id once known),
  `events` (the raw SDK events, the `source`). The thread writes them (write-mode deps); any
  operation in the session reads or watches them (`depends: { status: x.status }`), a TUI or a
  route renders them, and a test asserts them. Static facts (cwd, model, permission mode) are
  already readable: they are the options tag.
- **A turn is an operation.** `x.turn({ label, input?, request, response? })` mirrors http's
  endpoint: `request(input)` returns the prompt plus the SDK's per-turn options; the op depends
  on `x.thread`, runs the turn with `ctx.signal`, and delivers the SDK's result (or `response`'s
  reading of it). Span attributes: adapter, model, input/output/cached tokens, cost, turns; one
  `harness turn` log line.
- **Approvals and tools are later tickets** as operations: the SDK's `canUseTool` / approval mode
  answered by a subflow (t03); an operation exposed in-process (Claude's `tool()` +
  `createSdkMcpServer`, Codex's MCP config) with its span nested (t04).

## Consequences

- One frame, two adapters, and the options are exactly the SDKs' — reading their docs is reading
  ours. A third harness is an adapter resource plus an options tag.
- Everything a harness knows is ambient and inspectable through core's own primitives: cells to
  watch, a tag to read, spans to export.
- Core feedback: a resource that must write several cells needs `data.controller` deps for each —
  fine at five cells; if harnesses grow, "a resource publishes a record of cells" is the candidate.

## Alternatives rejected

- **A normalized harness config** — hides which knobs the SDK allows per call; contradicts "do not
  invent the constraints".
- **A single normalized event union** — a TUI wants status, text, and items separately; the raw
  events stay available as `x.events`.
- **One adapter package per harness** — the frame is the same; the adapters are small resources.
- **An LLM layer first** (`@tinker/ai` over the AI SDK) — deferred; the harness was the ask.
