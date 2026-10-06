#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { staleTree } from "../lib/checks/generated.mjs";
import { doctor } from "../lib/doctor.mjs";
import { prepare, writeRouteTree } from "../lib/prepare.mjs";
import { serve } from "../lib/serve.mjs";
import { upgrade } from "../lib/upgrade.mjs";

const [command, ...rest] = process.argv.slice(2);
const root = process.cwd();
const flag = (name) => rest[rest.indexOf(name) + 1];
const commands = {
  prepare: async () => {
    const files = [...prepare(root), await writeRouteTree(root)];
    const stale = staleTree(root);
    console.log(
      stale.length > 0
        ? stale.join("\n")
        : `tinker prepare: wrote .tinker/${files.join(", .tinker/")}`,
    );
    return stale.length > 0 ? 1 : 0;
  },
  doctor: () => doctor(root, rest.includes("--fix")),
  upgrade: () =>
    upgrade(root, rest[0], {
      from: rest.includes("--from") ? flag("--from") : undefined,
      force: rest.includes("--force"),
    }),
  serve: () => serve(root),
};
if (!existsSync(join(root, "package.json")) || !(command in commands)) {
  console.log("usage: tinker prepare | doctor [--fix] | upgrade <version> [--from <dir>] | serve");
  process.exit(2);
}
process.exitCode = await commands[command]();
