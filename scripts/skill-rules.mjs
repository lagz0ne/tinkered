/**
 * Each rule id `tinker check` prints has a skill section with that id in its heading and a
 * `Right:` part, which the check prints as the fix (ADR 0156 decision 8). It reads the
 * sections as the check does. Exit 1 names each id with no such section.
 */
import { globSync, readFileSync } from "node:fs";

import { rules } from "../packages/cli/src/rules.ts";
import { sectionsIn } from "../packages/cli/src/skills.ts";

const taught = new Set(
  globSync("packages/*/skills/**/SKILL.md")
    .flatMap((file) => sectionsIn(readFileSync(file, "utf8"), file))
    .filter(({ right }) => right.length)
    .map(({ rule }) => rule),
);

const missing = rules.filter((rule) => !taught.has(rule));
for (const rule of missing) console.error(`${rule}: no skill section with a Right: part`);
process.exitCode = missing.length ? 1 : 0;
if (!missing.length) console.log(`skill rules: ${rules.length} ids, each with a Right: part`);
