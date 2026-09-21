import { createScope, operation } from "@tinker/core";
import { cli, command } from "@tinker/cli";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { expose, mcp } from "@tinker/mcp";

const searchShape = { q: z.string() };

const search = operation({
  label: "search",
  input: z.object(searchShape),
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

/** The search MCP driver: installed on the root below, resolved in the `mcp`
 * entry below. */
const searchMcp = mcp({
  name: "coder",
  version: "1.0.0",
  tools: [expose(search, { description: "search the index", schema: searchShape })],
});

/** Serve the resolved MCP server over stdio. Holds the owned lifetime: EOF or
 * a transport close settles the entry, and a CLI signal closes the scope to
 * settle it; the transport closes in every case. A harness runs `node cli.ts mcp`. */
async function serve(
  server: McpServer,
  hooks: { readonly onClose: (fn: () => void) => void },
): Promise<void> {
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = () => resolve();
  });
  hooks.onClose(stop);
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

/** The stdio entry through the CLI driver: `runMain` cannot serve here because
 * the entry must `resolve()` the installed extension off the root — and
 * `runMain` never hands the root back. So the root installs both extensions
 * and owns signals/exit itself; the entry's closure reads the root's own
 * `scope` binding. Not run by tests. */
const shell = cli({
  name: "coder",
  version: "1.0.0",
  commands: [
    command.entry("mcp", async () =>
      serve(scope.resolve(searchMcp), { onClose: scope.onClose.bind(scope) }),
    ),
  ],
});
const scope = createScope({ extensions: [searchMcp, shell] });
await scope.ready;
const run = scope.resolve(shell);
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
const result = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  signal: controller.signal,
});
await scope.close({ graceful: true });
process.exit(result.code);
