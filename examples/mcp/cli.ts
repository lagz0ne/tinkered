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

/** Publish every tool bound on the entrypoint scope, then serve stdio. Holds
 * the owned lifetime: EOF or a transport close settles the entry, and a CLI
 * signal closes the scope to settle it; the transport closes in every case.
 * A harness runs `node cli.ts mcp`. */
async function serve(scope: Scope.Handle): Promise<void> {
  const server = mcpServer(scope, { name: "coder", version: "1.0.0" });
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

/** The stdio entry through the CLI driver: the entry command receives the
 * scope `runMain` created, so `mcpServer` sees the `tools` bindings on it.
 * Not run by tests. */
await runMain({
  name: "coder",
  version: "1.0.0",
  scope: { tags: [tools(search), command.entry("mcp", () => serve)] },
});
