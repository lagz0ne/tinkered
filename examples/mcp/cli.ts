import { operation } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { command, runMain } from "@tinker/cli";
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

/** Publish every tool bound on the entrypoint scope, then connect stdio.
 * Returns the connect promise; a harness runs `node cli.ts mcp`. */
function serve(scope: Scope.Handle): Promise<void> {
  return mcpServer(scope, { name: "coder", version: "1.0.0" }).connect(new StdioServerTransport());
}

/** The stdio entry through the CLI driver: the entry command receives the
 * scope `runMain` created, so `mcpServer` sees the `tools` bindings on it.
 * Not run by tests. */
await runMain({
  name: "coder",
  version: "1.0.0",
  scope: { tags: [tools(search), command.entry("mcp", () => serve)] },
});
