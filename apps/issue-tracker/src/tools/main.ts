import { createScope } from "@tinker/core";
import { cli, command } from "@tinker/cli";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { api } from "../client/api.ts";
import { issueCommands, issuesMcp } from "./issues.ts";

function readBaseUrl(): string {
  const raw = process.env.BASE_URL;
  if (raw !== undefined && raw.length > 0) return raw;
  return "http://127.0.0.1:4311";
}

/** Serve the resolved issue MCP server over stdio. Owns the serving lifetime:
 * the entry holds it until EOF or a transport close, and a CLI signal closes
 * the scope to settle it; the transport closes in every case while the root
 * below closes the scope. Takes the server plus the scope's close hook — a
 * function value, never the handle. */
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

/** Root glue (24 lines): `runMain` cannot serve here because the `mcp` entry
 * must `resolve()` the installed MCP extension off the root — and `runMain`
 * never hands the root back. So the root installs both extensions, resolves
 * the CLI run, and owns signals/exit itself; the entry's closure reads the
 * root's own `scope` binding. */
const shell = cli({
  name: "issues",
  version: "0.1.0",
  commands: [
    ...issueCommands,
    command.entry("mcp", async () =>
      serve(scope.resolve(issuesMcp), { onClose: scope.onClose.bind(scope) }),
    ),
  ],
});
const scope = createScope({
  tags: [api.config({ baseUrl: readBaseUrl() })],
  extensions: [issuesMcp, shell],
});
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
