import type { Scope } from "@tinker/core";
import { command, runMain } from "@tinker/cli";
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
 * the scope to settle it; the transport closes in every case while the CLI
 * driver closes the scope it owns. Takes the server plus the scope's close
 * hook — a function value, never the handle (the extension's `start` already
 * holds the scope's hand, ADR 0051). */
async function serve(
  server: McpServer,
  hooks: { readonly onClose: Scope.Handle["onClose"] },
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

/** The `mcp` entry command: resolve the issue MCP driver off the scope `runMain`
 * created, then serve it over stdio. Keeps the CLI shape t04 changes later. */
async function serveEntry(scope: Scope.Handle): Promise<void> {
  await serve(scope.resolve(issuesMcp), { onClose: scope.onClose.bind(scope) });
}

await runMain({
  name: "issues",
  version: "0.1.0",
  scope: {
    tags: [
      api.config({ baseUrl: readBaseUrl() }),
      ...issueCommands,
      command.entry("mcp", () => serveEntry),
    ],
    extensions: [issuesMcp],
  },
});
