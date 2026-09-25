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
operation label) and optional `respond` (defaults to one JSON text content).
`tools` takes a `Many` list: nested lists and `false` rows are legal, and
only the reachable rows register.

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

`listTools` answers one entry per registered row: its name, its
description, and its schema keys.

The stdio entry through `@tinker/process` (`examples/mcp/cli.ts`): one
`mcp` command whose entry options install the MCP extension beside a
`stdio` extension that resolves the server and connects the transport,
then wait for that serving lifetime. A harness runs `node cli.ts mcp`:

```ts
import { extension, operation } from "@tinker/core";
import { main, type Process } from "@tinker/process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ext = the mcp({ … }) extension built above.
const stdio = extension({
  label: "coder.stdio",
  start: async (scope, ctx, next) => {
    await next();
    const server = scope.resolve(ext);
    ctx.defer(() => server.close());
    await server.connect(new StdioServerTransport());
  },
});

/** A server command returns when it is told to stop. */
const serveMcp = operation({
  label: "mcp",
  run: (_deps, ctx) =>
    new Promise<number>((resolve) =>
      ctx.signal.addEventListener("abort", () => resolve(0), { once: true }),
    ),
});

const shell: Process.Shell = {
  name: "coder",
  version: "1.0.0",
  commands: [
    {
      name: "mcp",
      entry: () => ({
        op: serveMcp,
        options: { extensions: [stdio, ext] },
      }),
    },
  ],
};
await main(shell);
```

The command must wait for its serving lifetime. `connect()` only opens the
transport; returning it alone would let the process exit before tool calls
arrive. This command returns on a signal; `cli.ts` also binds a `stopping`
cell that stdin EOF and a server close set, and watches it beside the
signal. The root's defer closes the transport.

Two `mcp()` extensions on one scope are two servers (ADR 0060):

- Both share a `target: "scope"` resource: a write through one
  is the other's next read.
- Every call opens its own session, so per-call state never
  crosses between the two.
- One `scope.close()` closes both, each server's own close running
  once; a second close runs neither again.
- A tool name declared on both answers from the server that got
  the request.

A root extension that serves a server goes before it in the list
(`[stdio, ext]` above): its `next()` then settles that server's
`start` before `scope.resolve(ext)` reads it. One such extension per
server, all on the one scope, gives the two-server shape.

The tool row rides the process too: the `mcp` command installs the driver
extension and serves it. The MCP edge parses the zod shape; a command is an
ordinary operation that reads the `argv` tag and owns its parse (ADR 0042,
0056).

Harness adapters share the readers: `readTool(op)` reads the `tool` meta off
an op that still carries it (kept for harnesses until their own ticket), and
`answerTool(meta, value)` maps a value to a tool result exactly the way the
driver answers a call.

Each call runs as a session with an inline operation `mcp search` (span, one
`mcp tool` line with tool and ok, the operation as its subflow).
Core writes a separate step line with the operation's label, `ms`, and outcome.
The value goes back
through `respond` (default: one JSON text content); a failure answers
`{ isError: true, content: [text] }` — a parse failure answers `invalid input`.
The call recovers through `settle` (ADR 0067): a panic or a raised error
answers the same way, and the call's session closes `success`.

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
`readTool` until the harness ticket migrates it. An op with no `tool` meta
cannot be advertised, so `readTool` throws `ToolUndeclared` with its label.
