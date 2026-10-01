import { extension } from "@tinker/core";
import { main, stop, type Process } from "@tinker/process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { api } from "../client/api.ts";
import { issueCommands, issuesMcp } from "./issues.ts";

function readBaseUrl(): string {
  const raw = process.env.BASE_URL;
  if (raw !== undefined && raw.length > 0) return raw;
  return "http://127.0.0.1:4311";
}

/** Serve the issue MCP server over stdio. An extension's `start` is its one use
 * of the scope (ADR 0051): `event.next()` starts the MCP driver first, then this
 * resolves the server it built and connects the transport. The serving lifetime
 * is the extension's — the transport closes in its `defer`, on every path. */
const stdio = extension({
  label: "issues.stdio",
  hooks: {
    start: async (event) => {
      await event.next();
      const server = event.scope.resolve(issuesMcp);
      const done = event.resolve(stop.required);
      process.stdin.once("end", done);
      server.server.onclose = done;
      event.defer(async () => {
        process.stdin.removeListener("end", done);
        server.server.onclose = undefined;
        await server.close();
      });
      await server.connect(new StdioServerTransport());
      if (process.stdin.readableEnded) done();
    },
  },
});

export const shell: Process.Shell = {
  name: "issues",
  version: "0.1.0",
  commands: [
    ...issueCommands,
    {
      name: "mcp",
      description: "serve the issue tools over stdio",
      entry: () => ({
        kind: "service",
        options: { extensions: [stdio, issuesMcp] },
      }),
    },
  ],
};

if (import.meta.main) {
  process.exitCode = await main({
    shell,
    options: { tags: [api.config({ baseUrl: readBaseUrl() })] },
  });
}
