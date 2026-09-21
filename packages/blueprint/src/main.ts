import { runMain } from "@tinker/cli";
import { readFileSync } from "node:fs";
import { commands, engine } from "./index.ts";

/** `--key-file <path>` off `process.argv` (the process edge), else `AI_GATEWAY_API_KEY`. */
function keyFrom(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--key-file");
  if (at !== -1 && argv[at + 1] !== undefined) return readFileSync(argv[at + 1], "utf8").trim();
  return process.env.AI_GATEWAY_API_KEY;
}

const key = keyFrom(process.argv);

/** The real entrypoint: the blueprint row table, run through the process —
 * argv in, exit code out. `engine` binds only when a key exists. */
await runMain(
  { name: "blueprint", version: "0.0.0", commands },
  { tags: key ? [engine({ model: "typesafe-ai/jev", apiKey: key })] : [] },
);
