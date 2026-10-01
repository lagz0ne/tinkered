import { main, type Process } from "@tinker/process";
import { searchMcp } from "./search.ts";
import { stdio, streams } from "./stdio.ts";

export const shell: Process.Shell = {
  name: "coder",
  version: "1.0.0",
  commands: [
    {
      name: "mcp",
      description: "serve the search tool over stdio",
      entry: () => ({
        kind: "service",
        options: { extensions: [stdio, searchMcp] },
      }),
    },
  ],
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [first, ...rest] = args;
  process.exitCode = await main({
    shell,
    args: first === "--" ? rest : args,
    options: { tags: streams({ input: process.stdin, output: process.stdout }) },
  });
}
