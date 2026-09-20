// Contributor self-check BEFORE reporting (ADR: docs/roadmap/jev-loop/PLAN.md).
// Same proven judge set as review, run on your working-tree diff so you clear or explain the
// lead's usual nits first, then the per-unit lint (scripts/jev/lint.mjs) on the same files. ADVISORY — never blocks your commit; exits 0. Report the flags and
// your resolutions in the "jev pre-flight" line of your contributor report.
//
//   node scripts/jev/preflight.mjs [<range>]   (default: HEAD = all changes since last commit)
import { execFileSync } from "node:child_process";
import { loadKey, ask, changedSources, fileAt, JUDGES, pct } from "./lib.mjs";

const range = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "HEAD";
if (!loadKey()) process.exit(0);

console.log(`jev pre-flight (advisory) — clear or explain these before reporting\n`);
let flags = 0;
const files = changedSources(range);
if (files.length === 0) console.log("(no source files changed)");
for (const f of files) {
  const code = fileAt(range, f);
  if (!code.trim()) continue;
  const answers = await ask(
    { file: f, code },
    Object.fromEntries(Object.entries(JUDGES).map(([id, j]) => [id, j.q])),
  );
  const hits = Object.entries(JUDGES)
    .filter(([id, j]) => answers[id].probability >= j.threshold)
    .map(([id]) => `${id} ${pct(answers[id].probability)}`);
  if (hits.length) {
    flags++;
    console.log(`  ⚠ ${f}: ${hits.join(", ")}`);
  } else console.log(`  ✓ ${f}`);
}
if (files.length && !range.includes("..")) {
  console.log("");
  execFileSync("node", ["scripts/jev/lint.mjs", ...files], { stdio: "inherit" });
}
console.log(
  `\njev pre-flight: ${flags} file flag(s) plus the lint notes above. Not a gate — vp check / tests / validate still decide.`,
);
process.exit(0);
