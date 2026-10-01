#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { generate } from "../dist/index.mjs";

if (import.meta.main) {
  const path = await generate({
    root: fileURLToPath(new URL("../../../", import.meta.url)),
    name: process.argv.at(2),
  });
  process.stdout.write(`Created ${path}\n`);
}
