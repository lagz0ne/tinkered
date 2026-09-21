import { data, extension, operation } from "@tinker/core";
import { main, type Process } from "@tinker/process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { expose, mcp } from "@tinker/mcp";

const searchShape = { q: z.string() };

const search = operation({
  label: "search",
  input: z.object(searchShape),
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

/** The search MCP driver, installed on the `mcp` command's own root below. */
const searchMcp = mcp({
  name: "coder",
  version: "1.0.0",
  tools: [expose(search, { description: "search the index", schema: searchShape })],
});

/** Set once the transport is done: stdin reached EOF or the server closed. */
const stopping = data<boolean>({ label: "coder.stopping", initial: false });

/** Serve the MCP server over stdio. An extension's `start` is its one use of the
 * scope (ADR 0051): `next()` starts the MCP driver first, then this resolves the
 * server it built and connects the transport, which closes in its `defer`. */
const stdio = extension({
  label: "coder.stdio",
  start: async (scope, ctx, next) => {
    await next();
    const server = scope.resolve(searchMcp);
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

/** A server is a command that returns when it is told to stop (ADR 0056): the
 * transport finishing and a signal both answer 0. A harness runs `node cli.ts mcp`. */
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
      ctx.signal.addEventListener("abort", answer, { once: true });
      deps.stopping.watch((next) => {
        if (next) answer();
      });
    }),
});

const shell: Process.Shell = {
  name: "coder",
  version: "1.0.0",
  commands: [
    {
      name: "mcp",
      description: "serve the search tool over stdio",
      entry: () => ({ op: serveMcp, options: { extensions: [stdio, searchMcp] } }),
    },
  ],
};

await main(shell);
