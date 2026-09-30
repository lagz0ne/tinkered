import { tour } from "./index.ts";

if (import.meta.main) {
  process.stdout.write(`Core tour: ${await tour()}\n`);
}
