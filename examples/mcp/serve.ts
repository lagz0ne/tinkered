import { createScope, operation } from "@tinker/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { expose, mcp } from "@tinker/mcp";

const searchShape = { q: z.string() };

const search = operation({
  label: "search",
  input: z.object(searchShape),
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

/** The stdio process recipe: own the scope, install the driver, resolve the
 * server once ready, connect stdio. A harness points its MCP config at this
 * file. Not run by tests. */
const ext = mcp({
  name: "coder",
  version: "1.0.0",
  tools: [expose(search, { description: "search the index", schema: searchShape })],
});
const scope = createScope({ extensions: [ext] });
await scope.ready;
const server = scope.resolve(ext);
await server.connect(new StdioServerTransport());
