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

const ext = mcp({
  name: "coder",
  version: "1.0.0",
  tools: [expose(search, { description: "search the index", schema: searchShape })],
});

/** A harness points its MCP config at this file. The root owns the transport
 * until stop; a failed start waits for cleanup before answering 1. */
export async function runServer(stop: AbortSignal): Promise<number> {
  const scope = createScope({ extensions: [ext] });
  try {
    await scope.ready;
  } catch {
    await scope.close();
    return 1;
  }
  try {
    const server = scope.resolve(ext);
    scope.onClose(() => server.close());
    await server.connect(new StdioServerTransport());
    await new Promise<void>((resolve) => {
      if (stop.aborted) resolve();
      else stop.addEventListener("abort", () => resolve(), { once: true });
    });
  } finally {
    await scope.close();
  }
  return 0;
}

if (import.meta.main) {
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  process.exitCode = await runServer(stop.signal);
}
