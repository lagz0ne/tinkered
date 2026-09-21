import { operation } from "@tinker/core";
import { command, main } from "@tinker/process";
import { z } from "zod";

const ping = operation({ label: "ping", run: () => "pong" });

const greet = operation({
  label: "greet",
  input: z.string(),
  run: (_deps, ctx) => `hello ${ctx.input}`,
});

/** The real entrypoint: argv in, exit code out. The smoke test spawns this file. */
await main({
  name: "tinker",
  version: "0.0.0",
  commands: [
    command("ping", () => ping),
    command("greet", () => greet, {
      input: (argv) => argv[0],
      respond: (value) => `${value}\n`,
    }),
  ],
});
