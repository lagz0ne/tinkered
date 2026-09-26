# 0046 A tool is an operation with description meta; harnesses reach it over MCP through a driver

Date: 2026-09-18. Status: accepted. Refines: 0043 (harness; t04's in-process tools become the
Claude fast path), 0042 (routing is scope config; the same rule will move CLI commands onto
operation meta), 0040 (a server request is an inline operation — the MCP call is one too).
Retires: the adapter-owned tool builder (`claudeCode.tool`, harness/t04). Superseded in part by
0051: the facts ride on an `expose(op, { description, schema })` row, not on meta; since
drivers/t08a the harness takes the same rows (`harness({ tools: [row] })`).

## Context

harness/t04 made a tool something the ADAPTER builds (`claudeCode.tool({ name, description, schema,
run })`), attached to one frame, callable by one SDK's in-process server. The user turned it around:
the unit is the **operation**. A tool is an ordinary operation the harness can call, and the way a
harness reaches it should follow what the field already does rather than a per-SDK callback.

The field: the Claude SDK has an in-process server (Claude only); the Vercel AI SDK takes `tools` on
a model call (not a harness); Paseo registers **MCP servers** per agent through plugins; Claude,
Codex, Cursor, and every MCP host take `mcpServers` config. The external MCP server is the one
strategy every harness speaks.

**The analogy** is MCP itself: a tool is `name + description + input schema + handler`, and a
server publishes a list of them. Ours: the handler is an operation's `run`, the input its `parse`,
the static facts ride on the handle's `meta` (how Hono routes and CLI commands already declare
themselves), and the list is scope config read by a driver (`scope.resolve(tools.all)`, core/t29).

## Decision

1. **A tool is an operation with description meta.** `tool({ description, schema, respond? })` is
   a meta tag from `@tinker/mcp`; an operation declares itself a tool with `meta: [tool({ … })]`
   and stays an ordinary operation (its own `input` parse, deps, spans). `schema` is a zod raw
   shape — the language the Claude SDK takes directly and zod v4 turns into JSON Schema for MCP —
   and `input: z.object(schema).parse` keeps one source for the parse and the declaration.
   `tool.read(op)` gives any driver or adapter the facts.
2. **The list is scope config.** `tools(op)` binds an operation on a scope or session; a driver
   reads `scope.resolve(tools.all)`. Nothing new in core: the driver holds the scope, exactly like
   Hono and the CLI.
3. **Harnesses reach tools over MCP through a driver, `@tinker/mcp`.** `mcpServer(scope, { name,
version })` returns the MCP SDK's own `McpServer` with every bound operation registered
   (`registerTool(name = the op's label, { description, inputSchema }, cb)`). Each call runs as
   a session with an inline operation `mcp <name>` (span, one `mcp tool` log line, the operation as
   its subflow); the value goes back through `respond` (default: one JSON text content), a failure
   as `{ isError: true, content: [text] }`; the session settles success/failed (ADR 0028). Transport
   is the SDK's (`server.connect(new StdioServerTransport())`); the CLI recipe is an entry command.
   The harness side is the SDK's own config: `claudeCode.options({ mcpServers: { coder: { command,
args } } })`, Codex `config.mcp_servers`, a Paseo plugin entry.
4. **The in-process path stays Claude's fast path, re-based on the same meta** (harness/t06): the
   adapter reads `tool.read(op)` and registers `createSdkMcpServer` from it; the builder goes.
5. **The CLI follows the same rule** (cli/t04): a command is an operation with `command` meta
   (name, description, argv parse), bound with `commands(op)`; the loader shapes stay for lazy
   modules (a lazy module is a resource, ADR 0042/0044).

```text
operation({ label: "search", input: z.object(schema).parse, meta: [tool({ description, schema })], depends, run })
scope: tags: [tools(search), tools(migrate)]                       ← config on the scope
mcpServer(scope, { name: "coder", version })  →  McpServer        ← the driver; tools.all off the scope
   call → session → inline op `mcp search` → the op (subflow) → respond(value) | isError
harness: mcpServers: { coder: { command: "node", args: ["tools.ts"] } }   ← every harness, Paseo too
```

## Consequences

- One declaration serves every harness, the CLI, and any MCP host; the frame and the adapters
  stop knowing what a tool is beyond its meta.
- Seam tests need no fake: the MCP SDK's `InMemoryTransport.createLinkedPair()` and its `Client`
  drive our server for real (`listTools`, `callTool`).
- The MCP SDK and zod are peers of `@tinker/mcp`, never bundled; size cap 10 kB gzip.
- Core feedback: the t03 ask (run a tag-delivered operation as a subflow from inside a frame) is
  withdrawn for this use — the driver pattern covers it.

## Alternatives rejected

- **A new core edge (`tag.subflows`)** so a frame can call tag-bound ops in-process — invents a
  primitive the driver pattern already covers; kept only as a core-feedback note.
- **Adapter builders per SDK** (t04's shape) — the tool is tied to one frame and one SDK.
- **Model-level tools (AI SDK)** — an LLM call, not a harness; deferred with `@tinker/ai`.
