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
  return [
    ...readdirSync(dir)
      .filter((name) => name !== "core" && existsSync(join(dir, name, "src")))
      .map((name) => ({
        name,
        src: join("packages", name, "src"),
        tests: join("packages", name, "tests"),
      })),
    { name: "blueprint", src: "tools/blueprint/src", tests: "tools/blueprint/tests" },
  ];
}

/** Every tracked .ts under a directory. */
function sources(dir) {
  if (!existsSync(dir)) return [];
  return execSync(`git ls-files --cached --others --exclude-standard '${dir}'`, {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
}

const failures = [];

const owners = packages().filter((owner) => asked.length === 0 || asked.includes(owner.name));

for (const { name, src, tests } of owners) {
  for (const file of sources(src)) {
    const text = readFileSync(join(ROOT, file), "utf8");
    text.split("\n").forEach((line, at) => {
      // ADR 0102 names this HTTP wire span beside its owning operation span.
      if (
        file === "packages/start/src/backend/http.ts" &&
        line.includes("obs.child(`http ${method} ${path}`")
      )
        return;
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
      `${name}  declares operations but ships no span-tree test — the graph is not ` +
        `asserted to produce the trace (ADR 0058)`,
    );
  }
}

if (failures.length === 0) {
  console.log(`check-graph: OK (${owners.length} package(s))`);
  process.exit(0);
}

console.error(`check-graph: ${failures.length} violation(s)\n`);
for (const failure of failures) console.error(`  ${failure}\n`);
process.exit(1);
