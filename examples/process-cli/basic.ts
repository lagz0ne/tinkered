import { operation } from "@tinker/core";
import { argv, io, main, type Process } from "@tinker/process";
import { z } from "zod";

const double = operation({
  label: "double",
  input: z.coerce.number(),
  run: (_deps, ctx) => ctx.input * 2,
});

/** A command is a plain operation whose answer is the exit code (ADR 0096). */
const doubleCommand = operation({
  label: "double",
  depends: { argv: argv.required, io: io.required, double },
  run: ({ argv: args, io: out, double: flow }) => {
    const [number] = args;
    out.write(`${JSON.stringify(flow.run({ rawInput: number }))}\n`);
    return 0;
  },
});

export const arithmetic: Process.Shell = {
  name: "arithmetic",
  version: "0.0.0",
  commands: [
    {
      name: "double",
      description: "double a number",
      entry: () => ({ kind: "command", op: doubleCommand }),
    },
    {
      name: "ping",
      entry: async () => ({ kind: "command", op: (await import("./ping.ts")).pingCommand }),
    },
  ],
};

if (import.meta.main) process.exitCode = await main({ shell: arithmetic });
