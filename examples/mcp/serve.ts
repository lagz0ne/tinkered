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
 * until stdin ends, the server closes, or stop fires. A failed start waits
 * for cleanup before answering 1. */
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
    let resolveStop: () => void;
    const stopped = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const done = (): void => resolveStop();
    process.stdin.once("end", done);
    stop.addEventListener("abort", done, { once: true });
    server.server.onclose = done;
    try {
      await server.connect(new StdioServerTransport());
      if (stop.aborted || process.stdin.readableEnded) done();
      await stopped;
    } finally {
      process.stdin.removeListener("end", done);
      stop.removeEventListener("abort", done);
      server.server.onclose = undefined;
    }
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
