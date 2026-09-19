import { operation } from "@tinker/core";
import { command, runMain } from "@tinker/cli";

const ping = operation({ label: "ping", run: () => "pong" });

const greet = operation({
  label: "greet",
  input: (raw: unknown) => {
    if (typeof raw !== "string") throw new Error("bad name");
    return raw;
  },
  run: (_deps, ctx) => `hello ${ctx.input}`,
});

/** The real entrypoint: the tour's routing table shape, run through the
 * process — argv in, exit code out. The smoke test spawns this file. */
await runMain({
  name: "tinker",
  version: "0.0.0",
  scope: {
    tags: [
      command("ping", () => ping),
      command("greet", () => greet, {
        input: (argv) => argv[0],
        respond: (value) => `${value}\n`,
      }),
    ],
  },
});
