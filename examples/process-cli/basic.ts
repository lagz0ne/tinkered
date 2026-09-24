import { operation } from "@tinker/core";
import { argv, io, run, type Process } from "@tinker/process";
import { z } from "zod";

const double = operation({
  label: "double",
  input: z.coerce.number(),
  run: (_deps, ctx) => ctx.input * 2,
});

const ping = operation({ label: "ping", run: () => "pong" });

/** The `double` command, declared by its author: argv[0] in, the answer out in JSON, code owned. */
const doubleCommand = operation({
  label: "double",
  depends: { argv: argv.required, io: io.required, double },
  run: ({ argv: args, io: out, double: flow }) => {
    out.write(`${JSON.stringify(flow.run({ rawInput: args[0] }))}\n`);
    return 0;
  },
});

/** A lazily loaded operation: the dynamic import in practice. */
async function loadPing(): Promise<typeof ping> {
  return ping;
}

/** A route whose `entry` awaits the loader on first selection, memoized like the old sugar. */
function lazyPingRoute(loads: { count: number }): Process.Route {
  let cached: Promise<typeof ping> | undefined;
  const once = (): Promise<typeof ping> => {
    cached ??= Promise.resolve(loadPing())
      .then((flow) => {
        loads.count += 1;
        return flow;
      })
      .catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    return cached;
  };
  return {
    name: "ping",
    entry: async () => ({
      op: operation({
        label: "ping",
        depends: { io: io.required, ping: await once() },
        run: ({ io: out, ping: flow }) => {
          out.write(`${JSON.stringify(flow.run())}\n`);
          return 0;
        },
      }),
    }),
  };
}

/** A cast-free tour of the entrypoint: routes are plain data, `run` builds one root per run and
 * answers `{ code, stdout, stderr }` without a process, and `help` loads nothing (ADR 0056).
 * Returns the codes, the answer, and the load count. */
export async function tour(): Promise<string> {
  const loads = { count: 0 };
  const shell: Process.Shell = {
    name: "tour",
    version: "0.0.0",
    commands: [
      { name: "double", description: "double a number", entry: () => ({ op: doubleCommand }) },
      lazyPingRoute(loads),
    ],
  };
  const helped = await run(shell, ["help"]);
  const answered = await run(shell, ["double", "21"]);
  const pinged = await run(shell, ["ping"]);
  return `${helped.code} ${answered.code} ${answered.stdout} ${loads.count} ${pinged.code}`;
}
