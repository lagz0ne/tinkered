import { main } from "@tinker/process";
import { readFileSync } from "node:fs";
import { engine, shell } from "./index.ts";

function keyFrom(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--key-file");
  if (at !== -1 && argv[at + 1] !== undefined) return readFileSync(argv[at + 1], "utf8").trim();
  return process.env.AI_GATEWAY_API_KEY;
}

if (import.meta.main) {
  const key = keyFrom(process.argv);
  await main(shell({ tags: key ? [engine({ model: "typesafe-ai/jev", apiKey: key })] : [] }));
}
