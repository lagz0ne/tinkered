import { operation } from "@tinker/core";
import { argv, io, main } from "@tinker/process";
import { z } from "zod";

const ping = operation({ label: "ping", run: () => "pong" });

/** The `ping` command: no input to read, the answer out as JSON. */
const pingCommand = operation({
  label: "ping",
  depends: { io: io.required, ping },
  run: ({ io: out, ping: flow }) => {
    out.write(`${JSON.stringify(flow.run())}\n`);
    return 0;
  },
});

const greet = operation({
  label: "greet",
  input: z.string(),
  run: (_deps, ctx) => `hello ${ctx.input}`,
});

/** The `greet` command: argv[0] in through the operation's own parse, the greeting out. */
const greetCommand = operation({
  label: "greet",
  depends: { argv: argv.required, io: io.required, greet },
  run: ({ argv: args, io: out, greet: flow }) => {
    out.write(`${flow.run({ rawInput: args[0] })}\n`);
    return 0;
  },
});

/** The real entrypoint: argv in, exit code out. The smoke test spawns this file. */
await main({
  name: "tinker",
  version: "0.0.0",
  commands: [
    { name: "ping", entry: () => ({ op: pingCommand }) },
    { name: "greet", entry: () => ({ op: greetCommand }) },
  ],
});
