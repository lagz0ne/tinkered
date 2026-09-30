import { data, operation, resource, tag } from "@tinker/core";
import { argv, io, run, type Process } from "@tinker/process";
import { z } from "zod";
import { check } from "./check.ts";

/** A command is a plain operation whose answer is the exit code (ADR 0056). */
const checkCommand = operation({
  label: "check",
  depends: { argv: argv.required, io: io.required, check },
  run: ({ argv: args, io: out, check: flow }) => {
    const [file] = args;
    out.write(`${flow.run({ rawInput: file })}\n`);
    return 0;
  },
});

const count = operation({
  label: "count",
  input: z.coerce.number().default(3),
  depends: { io: io.required },
  run: ({ io: out }, ctx) => {
    for (let n = 1; n <= ctx.input; n += 1) out.write(`${n} `);
    out.write("\n");
    return 0;
  },
});

const countCommand = operation({
  label: "count",
  depends: { argv: argv.required, count },
  run: ({ argv: args, count: flow }) => {
    const [upTo] = args;
    return flow.run({ rawInput: upTo });
  },
});

const tickEvery = tag({ label: "tickEvery", default: 10 });
const ticks = data({ label: "ticks", initial: 0 });

/** The report belongs to the root, so a stop prints the final count once. */
const ticker = resource({
  label: "ticker",
  target: "scope",
  depends: { io: io.required, ticks: ticks.controller },
  factory: ({ io: out, ticks: count }, ctx) => {
    ctx.defer(() => out.write(`stopped after ${count.get()} ticks\n`));
    out.write("listening\n");
  },
});

const waitForSignal = operation({
  label: "serve",
  depends: { ticker, ticks: ticks.controller, tickEvery: tickEvery.required },
  run: async ({ ticks: count, tickEvery: delay }, ctx) => {
    try {
      while (!ctx.signal.aborted) {
        await ctx.clock.sleep(delay, ctx.signal);
        if (ctx.signal.aborted) return 0;
        count.update((value) => value + 1);
      }
    } catch (error: unknown) {
      if (error !== ctx.signal.reason) throw error;
    }
    return 0;
  },
});

/** Routes are plain data, read before any scope exists, so help loads no command. */
export const shell: Process.Shell = {
  name: "tk",
  version: "0.1.0",
  commands: [
    { name: "check", description: "check a file", entry: () => ({ op: checkCommand }) },
    {
      name: "lazy-check",
      description: "check a file, loaded lazily",
      entry: async () => ({ op: (await import("./lazy-check.ts")).lazyCheckCommand }),
    },
    { name: "count", description: "count up, streamed", entry: () => ({ op: countCommand }) },
    { name: "serve", description: "tick until SIGINT", entry: () => ({ op: waitForSignal }) },
  ],
};

/** Stop after the listener starts, so the tour does not wait for real time or a process signal. */
export async function tour(): Promise<readonly Process.Result[]> {
  const stop = new AbortController();
  return [
    await run(shell, ["help"]),
    await run(shell, ["check", "a.yaml"]),
    await run(shell, ["count", "3"]),
    await run(
      shell,
      ["serve"],
      {
        write: (line) => {
          if (line === "listening\n") queueMicrotask(() => stop.abort());
        },
      },
      stop.signal,
    ),
  ];
}
