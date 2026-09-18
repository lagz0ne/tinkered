# mcp v1 — build progress

A tool is an operation with description meta; harnesses reach it over MCP through a driver (ADR
0046). Package `packages/mcp` (`@tinker/mcp`), peers `@modelcontextprotocol/sdk` and `zod` (never
bundled), size cap 10 kB gzip, no core change.

- **Decision:** `docs/decisions/0046-a-tool-is-an-operation-with-description-meta-harnesses-reach-it-over-mcp.md`.
- **Glossary:** `docs/glossary.md` → "MCP driver" (`tool`, `tools`, `mcpServer`).
- **Gate + tag:** `scripts/ticket.sh mcp <NN> "<title>"` → `mcp/t<NN>`; validate lanes at the milestone.
- **SDK facts (installed 1.30.0):** `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`:
  `registerTool(name, { title?, description?, inputSchema? (zod raw shape) }, cb)`, `connect(transport)`;
  `StdioServerTransport` from `server/stdio.js`; `InMemoryTransport.createLinkedPair()` from `inMemory.js`;
  `Client` from `client/index.js` with `listTools()` and `callTool({ name, arguments })`; `CallToolResult` from `types.js`.

## Order & status

| tag         | ticket                                                                                                 | blockers | status |
| ----------- | ------------------------------------------------------------------------------------------------------ | -------- | ------ |
| mcp/t01     | Package + `tool` meta tag + `tools` binding tag + `mcpServer(scope, …)` driver; in-memory client tests | —        | [ ]    |
| harness/t06 | Adapters read `tool.read(op)`; `claudeCode.tool` builder removed; Codex `mcp_servers` recipe; README   | mcp/t01  | [ ]    |
| cli/t04     | A command is an operation with `command` meta; `commands(op)`; loaders stay for lazy modules           | mcp/t01  | [ ]    |
| mcp/t02     | Validation milestone: lanes, mutation, README + cast-free example (stdio entry via cli); archive       | 01       | [ ]    |

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention, one promise per test, gate re-run, SCIP
refs for public symbols), cherry-picks, runs the mutation lane alone, tags. Reports end with **Core feedback**.
