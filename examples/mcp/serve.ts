import { createScope, extension, operation } from "@tinker/core";
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
  const ended = new AbortController();
  const stdio = extension({
    label: "stdio",
    start: async (scope, _ctx, next) => {
      await next();
      const server = scope.resolve(ext);
      const done = (): void => ended.abort();
      process.stdin.once("end", done);
      server.server.onclose = done;
      scope.onClose(async () => {
        process.stdin.removeListener("end", done);
        server.server.onclose = undefined;
        await server.close();
      });
      await server.connect(new StdioServerTransport());
      if (process.stdin.readableEnded) done();
    },
  });
  const scope = createScope({
    extensions: [stdio, ext],
    signal: AbortSignal.any([stop, ended.signal]),
  });
  const end = await scope.closed;
  return end.status === "failed" || (end.teardownErrors?.length ?? 0) > 0 ? 1 : 0;
}

if (import.meta.main) {
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  process.exitCode = await runServer(stop.signal);
}
