// Print the live question bank in plain words: for every judge, the exact question Jev is
// asked, what a `true` means, what a `false` means, and its calibration status. The README
// explains the tools; this prints the questions so the two cannot drift apart. Exit 0.
//
//   node tools/jev/explain.mjs [--md]      (--md: a markdown table for the README)
import { existsSync, readFileSync } from "node:fs";
import { JUDGES, readCalibration } from "./lib.mjs";
import { LINT, GUIDE, TESTS, SURVIVORS } from "./bank.mjs";

const md = process.argv.includes("--md");
const status = readCalibration();

const GROUPS = [
  ["file judges — review.mjs / preflight.mjs, one call per changed source file", JUDGES],
  [
    "unit judges — lint.mjs / preflight.mjs, one call per declared unit or top-level function",
    LINT,
  ],
  ["test judges — tests.mjs, one call per test", TESTS],
  ["survivor judge — survivors.mjs, one call per surviving mutant", SURVIVORS],
];

const where = (id) => status[id]?.status ?? "uncalibrated";

for (const [title, bank] of GROUPS) {
  console.log(md ? `\n### ${title}\n` : `\n== ${title}\n`);
  if (!Object.keys(bank).length) {
    console.log("No live judge. Retired judges keep their cases in cases.jsonl.");
    continue;
  }
  if (md)
    console.log(
      "| judge | status | the question Jev is asked | `true` means | `false` means |\n| --- | --- | --- | --- | --- |",
    );
  for (const [id, j] of Object.entries(bank)) {
    const q = j.q;
    if (md) {
      console.log(
        `| \`${id}\` | ${where(id)} | ${q.instructions} | ${q.criteria.true} | ${q.criteria.false} |`,
      );
      continue;
    }
    console.log(`${id}  [${where(id)}, threshold ${j.threshold}]`);
    console.log(`  question: ${q.instructions}`);
    if (j.fix) console.log(`  fix: ${j.fix}`);
    console.log(`  true  → ${q.criteria.true}`);
    console.log(`  false → ${q.criteria.false}\n`);
  }
}

console.log(
  md
    ? `\n### guide — the unit classifier lint.mjs uses; for words, blueprint suggest\n`
    : `\n== guide — the unit classifier lint.mjs uses; for words, blueprint suggest\n`,
);
for (const [id, g] of Object.entries(GUIDE)) {
  const q = g.q;
  if (md) {
    console.log(`**\`${id}\`** — ${q.instructions}\n`);
    for (const [opt, meaning] of Object.entries(q.criteria))
      console.log(`- \`${opt}\`: ${meaning}`);
    console.log("");
    continue;
  }
  console.log(`${id}: ${q.instructions}`);
  for (const [opt, meaning] of Object.entries(q.criteria))
    console.log(`  ${opt.padEnd(10)} ${meaning}`);
  console.log("");
}
