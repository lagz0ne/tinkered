import { operation } from "@tinker/core";
import { main, type Process } from "@tinker/process";
import { searchMcp } from "./search.ts";
import { stdio, stopping, streams, type Stdio } from "./stdio.ts";

const serveMcp = operation({
  label: "mcp",
  depends: { stopping: stopping.controller },
  run: (deps, ctx) =>
    new Promise<number>((resolve) => {
      const answer = (): void => resolve(0);
      ctx.defer(
        deps.stopping.watch((next) => {
          if (next) answer();
        }),
      );
      ctx.signal.addEventListener("abort", answer, { once: true });
      ctx.defer(() => ctx.signal.removeEventListener("abort", answer));
      if (deps.stopping.get() || ctx.signal.aborted) answer();
    }),
});

/** Bind borrowed streams at the entry, so importing this file never reads the process. */
export function createShell(io: Stdio.Streams): Process.Shell {
  return {
    name: "coder",
    version: "1.0.0",
    commands: [
      {
        name: "mcp",
        description: "serve the search tool over stdio",
        entry: () => ({
          op: serveMcp,
          options: { extensions: [stdio, searchMcp], tags: streams(io) },
        }),
      },
    ],
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [first, ...rest] = args;
  await main(
    createShell({ input: process.stdin, output: process.stdout }),
    first === "--" ? rest : args,
  );
}
