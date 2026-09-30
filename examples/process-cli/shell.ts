import { operation } from "@tinker/core";
import { argv, io, type Process } from "@tinker/process";
import { z } from "zod";

const greet = operation({
  label: "greet",
  input: z.string(),
  run: (_deps, ctx) => `hello ${ctx.input}`,
});

const greetCommand = operation({
  label: "greet",
  depends: { argv: argv.required, io: io.required, greet },
  run: ({ argv: args, io: out, greet: flow }) => {
    const [name] = args;
    out.write(`${flow.run({ rawInput: name })}\n`);
    return 0;
  },
});

/** Routing happens before a command opens its root, so help runs no command. */
export const shell: Process.Shell = {
  name: "tinker",
  version: "0.0.0",
  commands: [
    {
      name: "ping",
      entry: async () => ({ op: (await import("./ping.ts")).pingCommand }),
    },
    { name: "greet", entry: () => ({ op: greetCommand }) },
  ],
};
