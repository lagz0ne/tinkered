#!/usr/bin/env node
// The authoring bar as plain code (ADR 0058). Jev points; this decides.
//
//   node scripts/check-graph.mjs            check every package
//   node scripts/check-graph.mjs <pkg>…     check these
//
// Two rules, both greppable, both a regression the moment someone drops a step back into a
// plain function:
//
//   1. No hand-rolled span outside core. `ctx.obs.child(...)` builds a span by hand, which is
//      what a package does when a step that deserved to be an operation was not one. Setting
//      attributes on the operation's OWN span (`ctx.obs.span`) is fine and stays allowed.
//   2. A package that declares operations ships a span-tree test, so the graph is asserted to
//      produce the trace rather than assumed to.
//
// Exit 1 on a violation. A `pnpm validate` lane since graph/t06 — every package clears the bar.
//   Cleared over graph-v1: http (t02) removed the last hand-rolled span; blueprint, harness,
//   http, process, and tinkerer each gained a span-tree test (t02-t04b).
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const asked = process.argv.slice(2);

/** Every workspace package with a `src`, minus core (which owns observation). */
function packages() {
  const dir = join(ROOT, "packages");
  return readdirSync(dir).filter((name) => name !== "core" && existsSync(join(dir, name, "src")));
}

/** Every tracked .ts under a directory. */
function sources(dir) {
  if (!existsSync(dir)) return [];
  return execSync(`git ls-files '${dir}'`, { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
}

const failures = [];

for (const name of asked.length > 0 ? asked : packages()) {
  const src = join("packages", name, "src");
  const tests = join("packages", name, "tests");

  for (const file of sources(src)) {
    const text = readFileSync(join(ROOT, file), "utf8");
    text.split("\n").forEach((line, at) => {
      if (line.includes("obs.child(")) {
        failures.push(
          `${file}:${at + 1}  hand-rolled span — make the step an operation (ADR 0058)\n` +
            `    ${line.trim()}`,
        );
      }
    });
  }

  const declares = sources(src).some((file) =>
    /\boperation\(\{|\boperationCore\(\{/.test(readFileSync(join(ROOT, file), "utf8")),
  );
  const asserts = sources(tests).some((file) => file.includes("span-tree"));
  if (declares && !asserts) {
    failures.push(
      `packages/${name}  declares operations but ships no span-tree test — the graph is not ` +
        `asserted to produce the trace (ADR 0058)`,
    );
  }
}

if (failures.length === 0) {
  console.log(`check-graph: OK (${(asked.length > 0 ? asked : packages()).length} package(s))`);
  process.exit(0);
}
console.error(`check-graph: ${failures.length} violation(s)\n`);
for (const failure of failures) console.error(`  ${failure}\n`);
process.exit(1);
