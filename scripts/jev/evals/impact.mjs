// Eval for the impact chain (ADR 0047): the real cli/t04 block answers neither with
// zero model calls; the under-scoped fixture answers PLAN wrong on the two dropped files.
// Exit 0 always — it is an eval, not a gate. Jev's answers print as-is; a verdict of
// unclear or source wrong is reported with its probability, never retried.
//   run:  node scripts/jev/evals/impact.mjs
import { execSync } from "node:child_process";

function run(args) {
  try {
    return execSync(`node scripts/jev/impact.mjs ${args}`, { encoding: "utf8" });
  } catch (e) {
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

let pass = 0;

const out1 = run("cli/t04");
console.log("--- case 1: node scripts/jev/impact.mjs cli/t04 ---");
console.log(out1);
const ok1 = out1.includes("neither") && out1.includes("0 discrepancies");
console.log(`case 1 ${ok1 ? "as expected" : "NOT as expected"} (want: neither, 0 discrepancies)`);
if (ok1) pass++;

const out2 = run("cli/t04 --block scripts/jev/evals/fixtures/impact-under-scoped.md");
console.log(
  "--- case 2: node scripts/jev/impact.mjs cli/t04 --block fixtures/impact-under-scoped.md ---",
);
console.log(out2);
const ok2 = ["tests/cli.test.ts", "examples/basic.ts"].every((f) =>
  out2
    .split("\n")
    .some((l) => l.includes("unexpected") && l.includes(f) && l.includes("PLAN wrong")),
);
console.log(
  `case 2 ${ok2 ? "as expected" : "NOT as expected"} (want: two unexpected, each PLAN wrong)`,
);
if (ok2) pass++;

console.log(`\nimpact eval: ${pass}/2 cases as expected`);
process.exit(0);
