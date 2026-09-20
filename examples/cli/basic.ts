import { createScope } from "@tinker/core";
import { operation } from "@tinker/core";
import { cli, command } from "@tinker/cli";

/** A cast-free tour of the driver: the flat row table hands operations to
 * `cli({ commands })` — `double` eager, `ping` behind a loader — and the root
 * resolves `run` off the extension and answers in-process. Returns the codes,
 * the answer, and the count. */
export async function tour(): Promise<string> {
  const parseCount = (raw: unknown): number => {
    if (typeof raw !== "string") throw new Error("bad count");
    const count = Number(raw);
    if (Number.isNaN(count)) throw new Error("bad count");
    return count;
  };

  const double = operation({
    label: "double",
    input: parseCount,
    run: (_deps, ctx) => ctx.input * 2,
  });

  const ping = operation({ label: "ping", run: () => "pong" });

  let loads = 0;
  const ext = cli({
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
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  const run = scope.resolve(ext);
  const helped = await run(["help"]);
  const answered = await run(["double", "21"]);
  const pinged = await run(["ping"]);
  await scope.close({ graceful: true });
  return `${helped.code} ${answered.code} ${answered.stdout} ${loads} ${pinged.code}`;
}
