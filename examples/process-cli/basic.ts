import { operation } from "@tinker/core";
import { command, run, type Process } from "@tinker/process";
import { z } from "zod";

/** A cast-free tour of the entrypoint: routes are plain data, `run` builds one root per run and
 * answers `{ code, stdout, stderr }` without a process, and `help` loads nothing (ADR 0056).
 * Returns the codes, the answer, and the load count. */
export async function tour(): Promise<string> {
  const double = operation({
    label: "double",
    input: z.coerce.number(),
    run: (_deps, ctx) => ctx.input * 2,
  });

  const ping = operation({ label: "ping", run: () => "pong" });

  let loads = 0;
  const shell: Process.Shell = {
    name: "tour",
    version: "0.0.0",
    commands: [
      command("double", double, {
        description: "double a number",
        input: (argv) => argv[0],
      }),
      command("ping", () => {
        loads += 1;
        return ping;
      }),
    ],
  };
  const helped = await run(shell, ["help"]);
  const answered = await run(shell, ["double", "21"]);
  const pinged = await run(shell, ["ping"]);
  return `${helped.code} ${answered.code} ${answered.stdout} ${loads} ${pinged.code}`;
}
