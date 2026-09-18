# @tinker/mcp

A tool is an operation with description meta; harnesses reach it over MCP
through a driver (ADR 0046).

```text
operation({ label: "search", input: z.object(schema).parse, meta: [tool({ … })], depends, run })
scope: tags: [tools(search), tools(migrate)]                       ← config on the scope
mcpServer(scope, { name: "coder", version })  →  McpServer        ← the driver; tools.all off the scope
   call → session → inline op `mcp search` → the op (subflow) → answerTool(meta, value) | isError
harness: mcpServers: { coder: { command: "node", args: ["tools.ts"] } }   ← every harness, Paseo too
```

Declare a tool — an ordinary operation whose handle carries the static facts.
`Mcp.Tool` is `description` plus the zod shape, with optional `name` (defaults
to the operation label) and optional `respond` (defaults to one JSON text
content):

```ts
import { operation } from "@tinker/core";
import { tool } from "@tinker/mcp";
import { z } from "zod";

const schema = { q: z.string() };

const search = operation({
  label: "search",
  input: z.object(schema).parse,
  meta: [tool({ description: "search the index", schema })],
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});
```

Bind the list on the scope, publish it, connect the transport you want:

```ts
import { createScope } from "@tinker/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mcpServer, tools } from "@tinker/mcp";

const scope = createScope({ tags: [tools(search)] });
const server = mcpServer(scope, { name: "coder", version: "1.0.0" });
await server.connect(new StdioServerTransport());
```

The stdio entry through `@tinker/cli` (`examples/cli.ts`) — the same `search`
declaration, then an entry command that receives the scope `runMain` created,
so `mcpServer` sees the `tools` bindings on it. A harness runs
`node cli.ts mcp`:

```ts
import { operation } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { command, runMain } from "@tinker/cli";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mcpServer, tool, tools } from "../src/index.ts";

const searchShape = { q: z.string() };
const searchSchema = z.object(searchShape);

function parseSearch(raw: unknown): { q: string } {
  return searchSchema.parse(raw);
}

const search = operation({
  label: "search",
  input: parseSearch,
  meta: [tool({ description: "search the index", schema: searchShape })],
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

function serve(scope: Scope.Handle): Promise<void> {
  return mcpServer(scope, { name: "coder", version: "1.0.0" }).connect(new StdioServerTransport());
}

await runMain({
  name: "coder",
  version: "1.0.0",
  scope: { tags: [tools(search), command.entry("mcp", () => serve)] },
});
```

The CLI mirror: a command is an operation with `command` meta from
`@tinker/cli`, so one operation can carry both metas and be an MCP tool and a
CLI command at once:

```ts
meta: [
  tool({ description: "search the index", schema: searchShape }),
  command({ description: "search the index", argv: (argv) => argv[0] }),
],
run: (_deps, ctx) => [`hit:${ctx.input.q}`],
```

Harness adapters share the readers: `readTool(op)` reads the `tool` facts off
one bound op, and `answerTool(meta, value)` maps a value to a tool result
exactly the way the driver answers a call.

Each call runs as a session with an inline operation `mcp search` (span, one
`mcp tool` log line, the operation as its subflow). The value goes back
through `respond` (default: one JSON text content); a failure answers
`{ isError: true, content: [text] }` — a parse failure answers `invalid input`.

Point a harness at the process. Claude:

```ts
claudeCode.options({ mcpServers: { coder: { command: "node", args: ["tools.ts"] } } });
```

Codex:

```ts
{ config: { mcp_servers: { coder: { command: "node", args: ["tools.ts"] } } } };
```

Drive it in a test for real — the in-memory pair plus the SDK's own client:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "test", version: "0" });
await client.connect(clientTransport);
await client.listTools();
await client.callTool({ name: "search", arguments: { q: "owls" } });
```

The MCP SDK and zod are peers, never bundled. A bound op without `tool` meta
cannot be advertised: `mcpServer` throws `ToolUndeclared` with its label.
