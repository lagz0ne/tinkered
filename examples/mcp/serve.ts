import { createScope, operation } from "@tinker/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mcpServer, tool, tools } from "@tinker/mcp";

const searchShape = { q: z.string() };
const searchSchema = z.object(searchShape);

/** Parse through the object built from the raw shape: the op edge and the
 * declaration share one source. A named function, not a method pull. */
function parseSearch(raw: unknown): { q: string } {
  return searchSchema.parse(raw);
}

const search = operation({
  label: "search",
  input: parseSearch,
  meta: [tool({ description: "search the index", schema: searchShape })],
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

/** The stdio process recipe: own the scope, publish every bound tool, connect
 * stdio. A harness points its MCP config at this file. Not run by tests. */
const scope = createScope({ tags: [tools(search)] });
const server = mcpServer(scope, { name: "coder", version: "1.0.0" });
await server.connect(new StdioServerTransport());
