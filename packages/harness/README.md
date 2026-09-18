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
import { claudeCode, harness } from "@tinker/harness";

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
