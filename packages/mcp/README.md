# @tinker/mcp

A tool is an operation plus its description facts; harnesses reach it over MCP
through a driver (ADR 0046, ADR 0051).

```text
operation({ label: "search", input: z.object(schema).parse, depends, run })   ← a plain op, no meta
expose(search, { description, schema })                ← one wiring row: the op + its tool facts
scope = createScope({ extensions: [mcp({ name, version, tools: rows })] })    ← the driver
await scope.ready; server = scope.resolve(ext) → McpServer                   ← start registers one tool per row
   call → session → inline op `mcp search` → the op (subflow) → answerTool(meta, value) | isError
harness: mcpServers: { coder: { command: "node", args: ["tools.ts"] } }   ← every harness, Paseo too
```

Declare a tool row — an ordinary operation plus its static facts. `Mcp.Tool`
is `description` plus the zod shape, with optional `name` (defaults to the
operation label) and optional `respond` (defaults to one JSON text content):

```ts
import { operation } from "@tinker/core";
import { expose, mcp } from "@tinker/mcp";
import { z } from "zod";

const schema = { q: z.string() };

const search = operation({
  label: "search",
  input: z.object(schema).parse,
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

const ext = mcp({
  name: "coder",
  version: "1.0.0",
  tools: [expose(search, { description: "search the index", schema })],
});
```

Install the extension, resolve the server once ready, connect the transport
you want:

```ts
import { createScope } from "@tinker/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const scope = createScope({ extensions: [ext] });
await scope.ready;
const server = scope.resolve(ext);
await server.connect(new StdioServerTransport());
```

The stdio entry through `@tinker/cli` (`examples/mcp/cli.ts`) — the same
`search` row, then an entry command whose closure resolves the installed
extension off the root (so the root does its own ≤ 30-line glue instead of
`runMain`). A harness runs `node cli.ts mcp`:

```ts
import { createScope } from "@tinker/core";
import { cli, command } from "@tinker/cli";

const shell = cli({
  name: "coder",
  version: "1.0.0",
  commands: [
    command.entry("mcp", async () =>
      serve(scope.resolve(searchMcp), { onClose: scope.onClose.bind(scope) }),
    ),
  ],
});
const scope = createScope({ extensions: [searchMcp, shell] });
await scope.ready;
const run = scope.resolve(shell);
```

The entry must wait for its serving lifetime. `connect()` only opens the transport;
returning it alone makes `runMain` close the scope and exit before tool calls arrive.
Here EOF or a transport close settles the entry; a CLI signal closes the scope and
settles it too. The `finally` closes the transport in each case.

The CLI mirror: a command is a `command(name, op, { input })` row from
`@tinker/cli`, so one operation can ride a CLI row and a separate MCP row
at once:

```ts
const searchRow = command("search", search, {
  description: "search the index",
  input: (argv) => ({ q: argv[0] }),
});
const searchTool = expose(search, { description: "search the index", schema: searchShape });
```

Harness adapters share the readers: `readTool(op)` reads the `tool` meta off
an op that still carries it (kept for harnesses until their own ticket), and
`answerTool(meta, value)` maps a value to a tool result exactly the way the
driver answers a call.

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

The MCP SDK and zod are peers, never bundled. The `tool` meta tag stays
exported for harnesses: `tool({ description, schema })` on an op is read by
`readTool` until the harness ticket migrates it.
