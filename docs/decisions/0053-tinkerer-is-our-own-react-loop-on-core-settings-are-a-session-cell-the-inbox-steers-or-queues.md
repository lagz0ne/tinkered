# 0053 Tinkerer is our own ReAct loop on core; settings are a session cell; the inbox steers or queues

Date: 2026-09-21. Status: accepted. Refines: 0043 (harness — the SDK-owned loop; its "LLM
layer, deferred" is this), 0046/0051 (a tool is an operation; drivers take `expose` rows),
0035 (http client frame), 0038 (a tagged call opens a child session), 0050 (extensions).

## Context

`@tinker/harness` wraps loops other people own (Claude Agent SDK, Codex SDK). The ask: a loop
we own, on `@tinker/core`, that talks to Muse Spark 1.3 Contributor over the Meta endpoint
(`https://api.meta.ai/v1/chat/completions`, OpenAI chat-completions shape). Probe of
2026-09-21 (`packages/tinkerer/probe/`): the model returns `tool_calls`, takes `role: "tool"`
messages back, streams SSE. Later, harness adapters plug into tinkerer, not the other way.

**The analogy** is pi's `agent-loop.js` (`@earendil-works/pi-agent-core`): ReAct is a
REPL turned inside out — the model reads and prints, we eval. pi adds three things worth
copying: hooks not subclasses, two user queues (steer, follow-up), and a guard that fails
every tool call in a reply cut by the token limit. pi's `prepareNextTurn` (`{ model?,
thinkingLevel?, context? }`) is the shape of our settings. Ours is simpler: no JSONL tree,
no compaction, no skills; every piece is a core primitive already named in the glossary.

## Decision

```text
tinkerer({ label, tools })            own frame
├── config tag    model, baseUrl, reasoning_effort,
│                 max_completion_tokens, system, headers
├── mode tag      read-only | workspace-write | full-access
├── step          endpoint on @tinker/http:
│                 POST /chat/completions, res.sse()
├── cells         messages, status, text, usage,
│                 settings, inbox
├── turn op       prompt → step → tools → … → answer
├── tools         expose(op, { description, schema }) rows;
│                 read, bash, edit, write in-package
└── persist       an extension on the `session` hook
```

1. **Own frame, not a harness adapter.** The loop, the model call, and every tool call are
   operations: one span per step, one per tool call (subflows). A harness adapter later
   plugs into this frame; the frame never plugs into `harness`.
2. **The model call is an `@tinker/http` endpoint.** Retry, the `backend` tag as the test
   seam, spans, and `HttpResponse.make` on recorded replies come free. `HttpResponse` gains
   one reader, `sse()`, beside `stream()`.
3. **The transcript is the wire shape.** `messages` holds chat-completions message objects
   as sent and received. No converted union (ADR 0043's rule: keep the API's own types).
4. **Settings are a session cell; tags are only the defaults.** `settings = { mode,
options }` — our `mode` plus the provider's own request fields. Seeded from the `mode`
   and `config` tags at turn start; read at **every** step and every tool call; written
   only inside the session, so a change never leaks up (copy-on-write, ADR 0038).
5. **The inbox has two kinds.** An entry is `{ kind, content, mode?, options? }`. `queue`
   waits until the model would stop (a reply with no tool calls). `steer` aborts the step
   in flight: the loop watches `inbox`, aborts the step's controller, gives running tool
   calls an `aborted` error result (so an assistant `tool_calls` is still followed by tool
   messages), keeps partial text as an assistant message, drops partial tool calls, patches
   `settings`, then runs the next step. Fields an entry omits keep the current value.
6. **The mode is a policy string, not an approval op.** Codex's `approvalPolicy` shape.
   `read-only`: `read`. `workspace-write`: `read`, `edit`, `write` under `cwd`; no `bash`.
   `full-access`: all four. A blocked call returns an error result to the model; the loop
   never stops on it. A human-in-the-loop `gate` op is a later ticket, at the same check
   point. (Shipped in tinkerer/t07: `gate((request) => decision)`, a slot
   operation run as a subflow before each tool call — it may read a cell or ask
   a human.)
7. **Persist is an extension on the `session` hook.** Core hooks wrap the root handle only
   (`run`/`write` skip sessions, subflows, and dep-controller writes — core/t35). A write
   flows down, never up (`writeCell` → `flushCell`), so the extension `watch`es `messages`
   on the session's own handle, appends JSONL per session, and seeds the cell on resume.
   No core change.
8. **Stop rules (pi's).** `finish_reason: "length"` fails every tool call in that reply
   with an error result; an unknown tool or a throwing tool returns an error result; a
   forced close aborts the fetch and the turn settles `cancelled` (ADR 0028); a step that
   fails after retries fails the turn with `StepFailed`, the transcript keeps every tool
   result so the next turn continues. No max-steps cap; the signal is the stop. Tool calls
   in one reply run in parallel unless a row says `sequential`; results return in the
   model's order.
9. **Entry points are thin.** `examples/tinkerer/real.ts` and a `@tinker/cli` command run
   the same `turn` operation (cli/t04: a command is an operation).

## Consequences

- One loop serves the lead's contributor use today and harness adapters later.
- Everything the loop knows is a cell or a tag: a TUI, a test, or a persist extension reads
  the same units.
- Core feedback (candidate, not a ticket): hooks that reach session runs, subflows, and
  dep-controller writes (`layer.runners`/`layer.writers` on the primitive, −80 lines of
  handle wrappers, hot path touched). Second asker after `sync`.
- The bearer key is read at the composition root from `/home/paseo/pilot/.muse-token` and
  bound as a header on the config tag; never in the package.

## Alternatives rejected

- **A third adapter on `harness`** — smallest today, but the model call would be an event,
  not a span, and the direction is reversed (harness plugs into us).
- **Our own message union with a convert step** (pi's `AgentMessage`) — a second shape
  for no v1 reader; a UI-only note can be a cell.
- **A gate operation as the only policy** — an unattended contributor needs a string, not
  a callback; kept as a later ticket.
- **Core hooks in sessions first** — blocks tinkerer on a hot-path core change nobody
  else asks for yet.
