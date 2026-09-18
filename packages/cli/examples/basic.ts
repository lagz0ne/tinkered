import { operation } from "@tinker/core";
import { command, run } from "../src/index.ts";

/** A cast-free tour of the driver: the routing table is scope config, loaders run
 * only for the selected command. Returns the codes, the answer, and the count. */
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
  const tags = [
    command(
      "double",
      () => {
        loads += 1;
        return double;
      },
      { input: (argv) => argv[0] },
    ),
    command("ping", () => ping),
  ];

  const base = { name: "tour", version: "0.0.0", scope: { tags } };
  const helped = await run({ ...base, argv: ["help"] });
  const answered = await run({ ...base, argv: ["double", "21"] });
  return `${helped.code} ${answered.code} ${answered.stdout} ${loads}`;
}
