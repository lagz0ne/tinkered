import { main } from "@tinker/process";
import { shell } from "./shell.ts";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [first, ...rest] = args;
  await main(shell, first === "--" ? rest : args);
}
