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
`search` row, then an entry command that resolves the installed extension off
the scope `runMain` created. A harness runs `node cli.ts mcp`:

```ts
import type { Scope } from "@tinker/core";
import { command, runMain } from "@tinker/cli";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function serve(server: McpServer, scope: Scope.Handle): Promise<void> {
  const stopped = Promise.withResolvers<void>();
  const stop = () => stopped.resolve();
  scope.onClose(stop);
  process.stdin.once("end", stop);
  server.server.onclose = stop;
  try {
    await server.connect(new StdioServerTransport());
    if (process.stdin.readableEnded) stop();
    await stopped.promise;
  } finally {
    process.stdin.removeListener("end", stop);
    await server.close();
  }
}

async function serveEntry(scope: Scope.Handle): Promise<void> {
  await serve(scope.resolve(searchMcp), scope);
}

await runMain({
  name: "coder",
  version: "1.0.0",
  scope: {
    tags: [command.entry("mcp", () => serveEntry)],
    extensions: [searchMcp],
  },
});
```

The entry must wait for its serving lifetime. `connect()` only opens the transport;
returning it alone makes `runMain` close the scope and exit before tool calls arrive.
Here EOF or a transport close settles the entry; a CLI signal closes the scope and
settles it too. The `finally` closes the transport in each case.

The CLI mirror: a command is an operation with `command` meta from
`@tinker/cli`, so one operation can carry `command` meta for the CLI and a
separate MCP row can expose it as a tool at once:

```ts
const search = operation({
  label: "search",
  input: z.object(searchShape).parse,
  meta: [command({ description: "search the index", argv: (argv) => argv[0] })],
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
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
