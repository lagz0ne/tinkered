import { extension, operation } from "@tinker/core";
import { argv, command, io, run, type Process } from "@tinker/process";

/** An operation with its own parse: the command hands it argv[0]. */
const check = operation({
  label: "check",
  input: (raw: unknown) => {
    if (typeof raw !== "string" || raw.length === 0) throw new Error("need a file");
    return raw;
  },
  run: (_deps, ctx) => `checked ${ctx.input}`,
});

/** A command that streams as it works: `io` is a tag it declares. */
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

/** The binary: routes are plain data; a flag becomes a root tag in an entry, before any scope. */
export const shell: Process.Shell = {
  name: "tk",
  version: "0.1.0",
  commands: [
    command("check", check, {
      input: (a) => a[0],
      respond: (v) => `${v}\n`,
      description: "check a file",
    }),
    { name: "count", description: "count up, streamed", entry: () => ({ op: count }) },
    {
      name: "serve",
      description: "tick until SIGINT",
      entry: () => ({ op: waitForSignal, options: { extensions: [ticker] } }),
    },
  ],
};

/** The tour a test or the validate lane runs: every kind of command through the seam. */
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
