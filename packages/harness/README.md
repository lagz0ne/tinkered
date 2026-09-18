# @tinker/harness

A harness is a session thread with ambient state; adapters keep the harness's own types
(ADR 0043).

```text
harness({ label, adapter })
├── adapter.options   (tag)                the SDK's own thread-level options, bound at scope or session
├── adapter           (resource, scope)    factory imports the SDK; returns Harness.Backend
├── x.thread          (resource, session)  backend.start(options merged nearest-first, hooks) — one per session
├── x.status / x.text / x.items / x.usage / x.id / x.events   data cells, written as events arrive
└── x.turn({ label, input?, request, response? })   an op: request(input) → the turn; delivers the SDK result
```

Declare a coder on the Claude Code adapter, bind options, run two turns in one session while
watching `text` and `status`, and resume a conversation by id:

```ts
import { createScope } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";

const coder = harness({ label: "coder", adapter: claudeCode });
const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });

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

The test recipe presets the lazy SDK module with a fake `query`:

```ts
import { preset } from "@tinker/core";

const scope = createScope({
  presets: [preset(claudeCode.sdk, async () => ({ query: fakeQuery }))],
});
```

See `examples/basic.ts` for the fake-`query` tour and `examples/real.ts` for the real adapter.

## Codex

The same frame on the Codex SDK: options are the SDK's own `CodexOptions & ThreadOptions`
(split at thread start — the `Codex` constructor takes its six keys, `startThread` the rest),
turns carry the SDK's input plus its per-turn output schema, and results are the SDK's turns.
Continuity is by thread id (`resumeThread` on the session's `resume` binding):

```ts
import { createScope } from "@tinker/core";
import { codex, harness } from "@tinker/harness";

const coder = harness({ label: "coder", adapter: codex });
const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });

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

See `examples/codex.ts` for the real adapter.

## Approvals

Claude's `canUseTool` is answered by an ordinary operation: pass it as `approve` when you build the
frame, and the turn op depends on it — the approval runs as a **subflow** of the turn (its span nests
under the turn's, it sees the session's bindings and the frame's cells). Its input is the SDK's own
request (`ClaudeCode.Approval`: `toolName`, `input`, the SDK's options), its result the SDK's own
`PermissionResult`. Each decision lands in `items` as `{ kind: "approval", status: "allow" | "deny" }`.
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
