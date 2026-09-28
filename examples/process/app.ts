import { extension, operation } from "@tinker/core";
import { argv, io, jsonLine, run, type Process } from "@tinker/process";

const check = operation({
  label: "check",
  input: (raw: unknown) => {
    if (typeof raw !== "string" || raw.length === 0) throw new Error("need a file");
    return raw;
  },
  run: (_deps, ctx) => `checked ${ctx.input}`,
});

/** A command is a plain operation whose answer is the exit code (ADR 0056). */
const checkCommand = operation({
  label: "check",
  depends: { argv: argv.required, io: io.required, check },
  run: ({ argv: args, io: out, check: flow }) => {
    out.write(`${flow.run({ rawInput: args[0] })}\n`);
    return 0;
  },
});

const count = operation({
  label: "count",
  depends: { argv: argv.required, io: io.required },
  run: ({ argv: args, io: out }) => {
    const upTo = Number(args[0] ?? "3");
    for (let n = 1; n <= upTo; n += 1) out.write(`${n} `);
    out.write("\n");
    return 0;
  },
});

/** Declared once at module level, never inside the route's `entry`: a unit minted per load
 * defeats every cache and preset (ADR 0057). */
const lazyCheckCommand = operation({
  label: "lazy-check",
  depends: { argv: argv.required, io: io.required, check },
  run: ({ argv: args, io: out, check: op }) => {
    const value = op.run({ rawInput: args[0] });
    out.write(jsonLine(value) ?? "");
    return 0;
  },
});

/** A lazily loaded command: the dynamic import in practice. */
async function loadCheck(): Promise<typeof lazyCheckCommand> {
  return lazyCheckCommand;
}

/** A failed load clears the cache, so the next selection retries instead of replaying the error. */
function lazyCheckRoute(): Process.Route {
  let cached: Promise<typeof lazyCheckCommand> | undefined;
  const once = (): Promise<typeof lazyCheckCommand> => {
    cached ??= Promise.resolve(loadCheck()).catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  };
  return {
    name: "lazy-check",
    description: "check a file, loaded lazily",
    entry: async () => ({ op: await once() }),
  };
}

/** A server is the driver extension serving from its `start`; the command waits for the signal. */
const ticker = extension({
  label: "ticker",
  start: (scope, ctx, next) => {
    const out = scope.resolve(io);
    let ticks = 0;
    out.write("listening\n");
    const timer = setInterval(() => {
      ticks += 1;
      void scope.session(() => ticks);
    }, 10);
    ctx.defer(() => {
      clearInterval(timer);
      out.write(`stopped after ${ticks} ticks\n`);
    });
    return next();
  },
});
const waitForSignal = operation({
  label: "serve",
  run: (_deps, ctx) =>
    new Promise<number>((resolve) => {
      ctx.signal.addEventListener("abort", () => resolve(0), { once: true });
    }),
});

/** Routes are plain data, read before any scope exists (ADR 0056), so `help` loads no command. */
export const shell: Process.Shell = {
  name: "tk",
  version: "0.1.0",
  commands: [
    { name: "check", description: "check a file", entry: () => ({ op: checkCommand }) },
    lazyCheckRoute(),
    { name: "count", description: "count up, streamed", entry: () => ({ op: count }) },
    {
      name: "serve",
      description: "tick until SIGINT",
      entry: () => ({ op: waitForSignal, options: { extensions: [ticker] } }),
    },
  ],
};

/** Every kind of command through `run`, with no real process. No test runs this tour;
 * only `vp check` covers it. */
export async function tour(): Promise<readonly Process.Result[]> {
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 30);
  return [
    await run(shell, ["help"]),
    await run(shell, ["check", "a.yaml"]),
    await run(shell, ["count", "3"]),
    await run(shell, ["serve"], undefined, stop.signal),
  ];
}
