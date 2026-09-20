import { operation } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { command, runMain } from "@tinker/cli";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { expose, mcp } from "@tinker/mcp";

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
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

/** The search MCP driver: installed on the scope `runMain` creates, resolved
 * in the `mcp` entry below. */
const searchMcp = mcp({
  name: "coder",
  version: "1.0.0",
  tools: [expose(search, { description: "search the index", schema: searchShape })],
});

/** Serve the resolved MCP server over stdio. Holds the owned lifetime: EOF or
 * a transport close settles the entry, and a CLI signal closes the scope to
 * settle it; the transport closes in every case. A harness runs `node cli.ts mcp`. */
async function serve(server: McpServer, scope: Scope.Handle): Promise<void> {
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = () => resolve();
  });
  scope.onClose(stop);
  process.stdin.once("end", stop);
  server.server.onclose = stop;
  try {
    await server.connect(new StdioServerTransport());
    if (process.stdin.readableEnded) stop();
    await stopped;
  } finally {
    process.stdin.removeListener("end", stop);
    await server.close();
  }
}

/** The `mcp` entry command: resolve the search driver off the scope `runMain`
 * created, then serve it over stdio. Keeps the CLI shape t04 changes later. */
async function serveEntry(scope: Scope.Handle): Promise<void> {
  await serve(scope.resolve(searchMcp), scope);
}

/** The stdio entry through the CLI driver: `runMain` installs the extension
 * before the entry resolves it. Not run by tests. */
await runMain({
  name: "coder",
  version: "1.0.0",
  scope: {
    tags: [command.entry("mcp", () => serveEntry)],
    extensions: [searchMcp],
  },
});
