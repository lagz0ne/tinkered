import { operation, resource } from "@tinker/core";
import { command, commands, run } from "@tinker/cli";

/** A cast-free tour of the driver: the routing table is scope config, `double`
 * declares itself through `command` meta and binds with `commands(double)`;
 * `ping` binds through a resource that delivers its operation, so the tour
 * still shows laziness. Returns the codes, the answer, and the count. */
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
    meta: [command({ description: "double a number", argv: (argv) => argv[0] })],
    run: (_deps, ctx) => ctx.input * 2,
  });

  const ping = operation({ label: "ping", run: () => "pong" });

  let loads = 0;
  const pingModule = resource({
    label: "tour.ping",
    factory: () => {
      loads += 1;
      return ping;
    },
  });
  const tags = [commands(double), command("ping", pingModule)];

  const base = { name: "tour", version: "0.0.0", scope: { tags } };
  const helped = await run({ ...base, argv: ["help"] });
  const answered = await run({ ...base, argv: ["double", "21"] });
  const pinged = await run({ ...base, argv: ["ping"] });
  return `${helped.code} ${answered.code} ${answered.stdout} ${loads} ${pinged.code}`;
}
