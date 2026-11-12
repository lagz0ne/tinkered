#!/usr/bin/env node
import { main } from "./main";

if (import.meta.main) {
  const { code, out, err } = main(process.argv.slice(2), process.cwd());
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
