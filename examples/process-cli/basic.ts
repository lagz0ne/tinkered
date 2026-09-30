import { operation } from "@tinker/core";
import { argv, io, run, type Process } from "@tinker/process";
import { z } from "zod";

const double = operation({
  label: "double",
  input: z.coerce.number(),
  run: (_deps, ctx) => ctx.input * 2,
});

/** A command is a plain operation whose answer is the exit code (ADR 0056). */
const doubleCommand = operation({
  label: "double",
  depends: { argv: argv.required, io: io.required, double },
  run: ({ argv: args, io: out, double: flow }) => {
    const [number] = args;
    out.write(`${JSON.stringify(flow.run({ rawInput: number }))}\n`);
    return 0;
  },
});

const shell: Process.Shell = {
  name: "tour",
  version: "0.0.0",
  commands: [
    { name: "double", description: "double a number", entry: () => ({ op: doubleCommand }) },
    {
      name: "ping",
      entry: async () => ({ op: (await import("./ping.ts")).pingCommand }),
    },
  ],
};

/** A cast-free tour of the entrypoint: routes are plain data, `run` builds one root per run and
 * answers `{ code, stdout, stderr }` without a process, and `help` loads nothing (ADR 0056). */
export async function tour(): Promise<string> {
  const helped = await run(shell, ["help"]);
  const answered = await run(shell, ["double", "21"]);
  const pinged = await run(shell, ["ping"]);
  return [
    `help ${helped.code}\n`,
    `double ${answered.code}: ${answered.stdout}`,
    `ping ${pinged.code}: ${pinged.stdout}`,
  ].join("");
}
