# @tinker/mcp

A tool is an operation with description meta; harnesses reach it over MCP
through a driver (ADR 0046).

```text
operation({ label: "search", input: z.object(schema).parse, meta: [tool({ … })], depends, run })
scope: tags: [tools(search), tools(migrate)]                       ← config on the scope
mcpServer(scope, { name: "coder", version })  →  McpServer        ← the driver; tools.all off the scope
   call → session → inline op `mcp search` → the op (subflow) → respond(value) | isError
harness: mcpServers: { coder: { command: "node", args: ["tools.ts"] } }   ← every harness, Paseo too
```

Declare a tool — an ordinary operation whose handle carries the static facts:

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

The `@tinker/cli` entry-command recipe is one line: an entry command that
builds the scope, calls `mcpServer(scope, …)`, and connects stdio.

Each call runs as a session with an inline operation `mcp search` (span, one
`mcp tool` log line, the operation as its subflow). The value goes back
through `respond` (default: one JSON text content); a failure answers
`{ isError: true, content: [text] }` — a parse failure as `invalid input`.

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
