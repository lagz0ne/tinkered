import { tour } from "./basic.ts";

if (import.meta.main) process.stdout.write(`${await tour()}\n`);
