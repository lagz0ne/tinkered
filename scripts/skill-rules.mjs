/**
 * Each rule id `tinker check` prints has a skill section with that id in its heading and a
 * `Right:` part, which the check prints as the fix (ADR 0156 decision 8). Exit 1 names each
 * id with no such section.
 */
import { globSync, readFileSync } from "node:fs";

import { rules } from "../packages/cli/src/rules.ts";

const taught = new Set();

for (const file of globSync("packages/*/skills/**/SKILL.md")) {
  const parts = readFileSync(file, "utf8").split(/^(?=### )/m);
  for (const part of parts) {
    const id = /^### [A-Z]+: .*\[(tinker\/[\w-]+)\]\s*$/m.exec(part.split("\n")[0])?.[1];
    if (id && /^Right:/m.test(part)) taught.add(id);
  }
}

const missing = rules.filter((rule) => !taught.has(rule));
for (const rule of missing) console.error(`${rule}: no skill section with a Right: part`);
process.exitCode = missing.length ? 1 : 0;
if (!missing.length) console.log(`skill rules: ${rules.length} ids, each with a Right: part`);
