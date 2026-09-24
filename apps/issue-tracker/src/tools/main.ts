import { data, extension, operation } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { main, type Process } from "@tinker/process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { api } from "../client/api.ts";
import { issueCommands, issuesMcp } from "./issues.ts";

function readBaseUrl(): string {
  const raw = process.env.BASE_URL;
  if (raw !== undefined && raw.length > 0) return raw;
  return "http://127.0.0.1:4311";
}

/** Set once the stdio transport is done: stdin reached EOF or the server closed.
 * The serving extension writes it; the `mcp` command watches it and returns. */
const stopping = data<boolean>({ label: "issues.stopping", initial: false });

/** Serve the issue MCP server over stdio. An extension's `start` is its one use
 * of the scope (ADR 0051): `next()` starts the MCP driver first, then this
 * resolves the server it built and connects the transport. The serving lifetime
 * is the extension's — the transport closes in its `defer`, on every path. */
const stdio = extension({
  label: "issues.stdio",
  start: async (scope, ctx, next) => {
    await next();
    const server = scope.resolve(issuesMcp);
    const stop = scope.controller(stopping);
    const done = (): void => stop.set(true);
    process.stdin.once("end", done);
    server.server.onclose = done;
    ctx.defer(async () => {
      process.stdin.removeListener("end", done);
      await server.close();
    });
    await server.connect(new StdioServerTransport());
    if (process.stdin.readableEnded) done();
  },
});

/** The `mcp` command: a server is a command that returns when it is told to
 * stop (ADR 0056). It waits for the transport to finish or for the signal —
 * either way the answer is 0, because for a server a signal is the normal stop.
 * The wait is one watch on the stop cell plus one abort listener; `defer` takes
 * both off when the run settles. */
const serveMcp = operation({
  label: "mcp",
  depends: { stopping: stopping.controller },
  run: (deps, ctx) =>
    new Promise<number>((resolve) => {
      const answer = (): void => resolve(0);
      if (deps.stopping.get()) {
        answer();
        return;
      }
      const unwatch = deps.stopping.watch((next) => {
        if (next) answer();
      });
      ctx.signal.addEventListener("abort", answer, { once: true });
      ctx.defer(() => {
        unwatch();
        ctx.signal.removeEventListener("abort", answer);
      });
    }),
});

/** The entrypoint: the issue routes plus `mcp`, which installs the MCP driver
 * and the stdio server on its own root. No scope is built here — `main` builds
 * one for whichever command routing picked, and `help` builds none. */
const options: Scope.Options = { tags: [api.config({ baseUrl: readBaseUrl() })] };
const shell: Process.Shell = {
  name: "issues",
  version: "0.1.0",
  commands: [
    ...issueCommands(options),
    {
      name: "mcp",
      description: "serve the issue tools over stdio",
      entry: () => ({
        op: serveMcp,
        options: { ...options, extensions: [stdio, issuesMcp] },
      }),
    },
  ],
};

await main(shell);
