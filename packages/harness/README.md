# @tinker/harness

A harness is one declared graph with an agent thread and state per namespace.
Adapters keep the harness's own types (ADR 0043).

```text
harness({ adapter, label?, approve?, tools? })
├── adapter.options   (tag)                the SDK's own thread-level options, bound at scope or session
├── adapter.sdk       (resource, scope)    the SDK module itself, imported lazily — the test seam (preset it)
├── adapter           (resource, scope)    depends on the module; returns Harness.Backend
├── x.thread          (resource, session)  backend.start(options merged nearest-first (+ resume), hooks) — one per session and namespace
├── x.status / x.text / x.items / x.usage / x.id / x.events   data cells, one value per namespace
├── x.send            (operation)            the SDK turn itself: input is the adapter's turn, result its result
└── approve / tools   (operations)         attached at construction; each runs as a subflow of the send
```

Declare a coder on the Claude Code adapter, bind options, run two turns in one session while
watching `text` and `status`, and resume a conversation by id:

```ts
import { createScope, operation } from "@tinker/core";
import { claudeCode, harness } from "@tinker/harness";

const parsePrompt = (raw: unknown): string => {
  if (typeof raw !== "string") throw new Error("bad prompt");
  return raw;
};
const coder = harness({ label: "coder", adapter: claudeCode });
const ask = operation({
  label: "coder.ask",
  input: parsePrompt,
  depends: { send: coder.send },
  run: async ({ send }, ctx) => {
    const result = await send.run({ input: { prompt: ctx.input } });
    return result.result;
  },
});

const scope = createScope({ tags: [claudeCode.options({ cwd: "/work", model: "sonnet" })] });
const session = scope.createSession();
session.controller(coder.text).watch((next) => process.stdout.write(next));
session.controller(coder.status).watch((next) => console.log("status:", next));

await session.run(ask, { input: "read the README" });
await session.run(ask, { input: "summarize it" });

const resumed = scope.createSession({ tags: [coder.resume("s-9")] });
await resumed.run(ask, { input: "continue" });
await scope.close();
```

The test recipe presets the lazy SDK module — the seam is the module's three members the adapter
calls: `query`, `tool`, and `createSdkMcpServer` (the last two are one-liners in a fake that never
registers tools; see `tests/fixtures.ts`):

```ts
import { preset } from "@tinker/core";

const scope = createScope({
  presets: [preset(claudeCode.sdk, async () => ({ ...toolSdk, query: fakeQuery }))],
});
```

See `examples/harness/basic.ts` for the fake-`query` two-agent relay and `examples/harness/real.ts` for the real adapter.

## Two agents, one frame

Declare the frame and relay once, outside requests or loops.
A namespace is an opaque key for each agent's thread, cells, and `resume` binding.
Both sends run under the relay span in the same session, but use different storage.
`label` only names spans and the in-process tool server; it defaults to `"harness"`.
Changing the label does not select an agent.

```ts
import { createScope, namespace, operation } from "@tinker/core";
import { claudeCode, harness } from "@tinker/harness";

const coder = harness({ adapter: claudeCode });
const a = namespace({ tags: [claudeCode.options({ model: "sonnet" })] });
const b = namespace({ tags: [claudeCode.options({ model: "opus" }), coder.resume("s-9")] });
const relay = operation({
  label: "relay",
  depends: { send: coder.send },
  run: async ({ send }) => {
    const first = await send.run({ input: { prompt: "start" }, ns: a });
    if (first.subtype !== "success") throw new Error("A failed");
    return send.run({ input: { prompt: first.result }, ns: b });
  },
});

const scope = createScope();
const session = scope.createSession();
session.controller(coder.text, { ns: a }).watch(console.log);
session.controller(coder.text, { ns: b }).watch(console.log);
await session.run(relay);
const aItems = session.resolve(coder.items, { ns: a });
const bItems = session.resolve(coder.items, { ns: b });
await scope.close();
```

The two threads keep their own ids and resume their own conversations on later turns.
A session opened with `createSession({ ns: a })` uses A for calls without an explicit `ns`.
The relay must pass `ns` on each send to reach both agents.

## Turns

Each turn opens one SDK call on the merged options — nearer bindings win per key, and
`includePartialMessages: true` is forced on — then folds the message stream into the result
and the ambient cells: text deltas stream into `text`, tool calls and answers land in `items`,
the result's own usage and cost land in `usage`, the session id lands in `id`, and every
message lands in `events` raw, including kinds the frame does not otherwise read, which never
stop the turn. The author's own `run` maps the result before the turn delivers it — there is
no frame-side mapping. With `observe`, the send span carries the adapter label and one
`harness turn` line logs the harness name and outcome (`done`, `failed`, or `cancelled`).
Core's `send` step line carries elapsed `ms` and `ok` or `failed` when its span closes.
Only text deltas move `text`; any other stream event streams nothing. Only tool
calls add tool items and only tool answers add tool results, so a plain or trailing assistant
message adds nothing. The `id` cell moves only on the init message and the result; any other
system message leaves it alone. A stream that ends with no result rejects with `TurnEnded`.
Continuity is by session id: the namespace's `resume` binding opens its first turn on it, and
each later turn resumes that namespace's last session id, so one thread is one conversation.

## Codex

The same frame on the Codex SDK: options are the SDK's own `CodexOptions & ThreadOptions`
(split at thread start — the `Codex` constructor takes its six keys, `startThread` the rest),
turns carry the SDK's input plus its per-turn output schema, and results are the SDK's turns.
Continuity is by thread id (`resumeThread` on the session's `resume` binding). Each turn folds
the event stream into the result and the ambient cells. Agent text streams into `text` as it
grows — Codex reports the whole text so far, so a rewrite restreams whole and only the last
text stays final, while an empty update streams nothing. Each item lands in `items` with the
SDK's own status where it carries one (`command_execution`, `file_change`, `mcp_tool_call`)
and the event phase (`started`, `updated`, `completed`) otherwise. Usage lands in `usage` with
no cost. A failed turn rejects with `TurnFailed` carrying the SDK's message; a stream that
ends with no completion rejects with `TurnEnded`.

```ts
import { createScope, operation } from "@tinker/core";
import { codex, harness } from "@tinker/harness";

const parsePrompt = (raw: unknown): string => {
  if (typeof raw !== "string") throw new Error("bad prompt");
  return raw;
};
const coder = harness({ label: "coder", adapter: codex });
const ask = operation({
  label: "coder.ask",
  input: parsePrompt,
  depends: { send: coder.send },
  run: async ({ send }, ctx) => {
    const result = await send.run({ input: { input: ctx.input } });
    return result;
  },
});

const scope = createScope({
  tags: [codex.options({ workingDirectory: "/work", sandboxMode: "read-only", model: "gpt-5" })],
});
const session = scope.createSession();
session.controller(coder.text).watch((next) => process.stdout.write(next));

await session.run(ask, { input: "read the README" });

const resumed = scope.createSession({ tags: [coder.resume("t-9")] });
await resumed.run(ask, { input: "continue" });
await scope.close();
```

The test recipe presets the lazy SDK module with a fake `Codex`:

```ts
import { preset } from "@tinker/core";

const scope = createScope({
  presets: [preset(codex.sdk, async () => ({ Codex: FakeCodex }))],
});
```

See `examples/harness/codex.ts` for the real adapter.

## Stopping a turn

`await session.close()` forces shutdown and signals the adapter to stop the active turn.
The frame skips its final status-cell write under abort because the session is already
closing; use the close result and the `harness turn` log for the outcome.
`session.close({ graceful: true })` waits for the turn to finish.

For adapter authors, `hooks.signal` is the interrupt. Wire it to the SDK before starting
work, handle an already-aborted signal, and check again where lazy work actually starts
(for example, before iterating a lazy stream). Thread cleanup runs after the turn settles;
it cannot be the only way to stop that turn. See core's
[resource cleanup](../core/README.md#resource-cleanup) rules.

## Approvals

Claude's `canUseTool` is answered by an ordinary operation: pass it as `approve` when you build the
frame, and the send op depends on it — the approval runs as a **subflow** of the send (its span nests
under the send's, it sees the session's bindings and the frame's cells). Its input is the SDK's own
request (`ClaudeCode.Approval`: `toolName`, `input`, the SDK's options), its result the SDK's own
`PermissionResult`. Each decision lands in `items` as `{ kind: "approval", status: "allow" | "deny" }`,
keeping the SDK request and the decision as its `source`. A throwing approve op rejects the turn
with that same error, not wrapped as `TurnFailed`.
An `approve` op overrides a `canUseTool` bound in `claudeCode.options`; without one, a bound
`canUseTool` still applies. Codex has no approval callback (only `approvalPolicy`), so `approve` is a
compile error for the `codex` adapter.

```ts
import { createScope, operation, tag } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";

const policy = tag<"allow" | "deny">({ label: "policy", default: "deny" });
const approve = operation({
  label: "approve",
  input: claudeCode.approval,
  depends: { policy },
  run: ({ policy }, ctx): ClaudeCode.Decision =>
    policy === "allow" || ctx.input.toolName === "Read"
      ? { behavior: "allow" }
      : { behavior: "deny", message: "policy" },
});
const coder = harness({ label: "coder", adapter: claudeCode, approve });
```

## Tools

A tool is an ordinary operation with `tool` meta from `@tinker/mcp` — the same declaration
the MCP driver serves (`mcpServer(scope)`), shared with every MCP host. The operation's `run`
is the handler, its `input` parse is the edge, and `tool.read(op)` gives any driver or adapter
the facts (description, zod raw shape, name defaulting to the op's label, an optional `respond`
that maps the value to a result — default one JSON text content). Pass tool ops in
`harness({ tools })`, and the send op depends on them: the call runs as a **subflow** of the
send (its span nests under the send's, it sees the session's bindings). Each op registers
under its `tool` meta name, defaulting to the op's label. A bound op without
`tool` meta throws `ToolUndeclared` at construction, naming the op's label.

The in-process path is Claude's zero-process fast path: the adapter registers one in-process
MCP server named after the frame (built once per thread, beside any `mcpServers` you bound —
under the frame's own label the frame's server wins),
one SDK tool per tool op, and maps the value with `answerTool` exactly as the driver does.
The model needs `allowedTools: ["mcp__coder__search"]` (or an `approve` op) to call it
without a prompt. With both `approve` and `tools`, one turn answers the approval and still
calls the tool. Codex has no in-process tools (MCP servers are config for an external
process), so `tools` is a compile error for the `codex` adapter.

```ts
import { createScope, operation, tag } from "@tinker/core";
import { tool } from "@tinker/mcp";
import { claudeCode, harness } from "@tinker/harness";
import { z } from "zod";

const index = tag<string>({ label: "index", default: "docs" });
const searchShape = { q: z.string() };
const search = operation({
  label: "search",
  input: (raw: unknown) => z.object(searchShape).parse(raw),
  depends: { index },
  meta: [tool({ description: "find a phrase in the index", schema: searchShape })],
  run: ({ index }, ctx) => `${index}: ${ctx.input.q}`,
});
const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
const scope = createScope({
  tags: [claudeCode.options({ cwd: "/work", allowedTools: ["mcp__coder__search"] })],
});
```

The universal path is an external MCP server over the SDKs' own config — one `tools.ts` entry
serving the same ops through `mcpServer(scope)`:

```ts
// Claude: an MCP server entry beside the fast path
claudeCode.options({ mcpServers: { coder: { command: "node", args: ["tools.ts"] } } });
// Codex: the same server through its config
codex.options({ config: { mcp_servers: { coder: { command: "node", args: ["tools.ts"] } } } });
```

Paseo reaches the same server through a plugin: the plugin registers the entry per agent, and
the agent's harness calls it over MCP like any other host.

## Testing

Everything above is proven at the seam with no mocks: preset the SDK module (`claudeCode.sdk`,
`codex.sdk`) with a fake that yields recorded SDK messages or events, and assert the cells, the
result, the items, and the spans. A resource dependency is delivered as its value (ADR 0044), so a
fake thread, db, or module never needs an `await` in the body that uses it. See `tests/`.
