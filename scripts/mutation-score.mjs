// One package's mutation score from the reports of its shards (ADR 0170).
// A lane too long for one hosted job runs as shards, each on its own files,
// with no break of its own. This adds their mutants up and breaks at the
// package floor, so the floor stays per package, never per shard or file.
//   node scripts/mutation-score.mjs <floor> <report.json>...
// The score is Stryker's: (Killed + Timeout) / (Killed + Timeout +
// Survived + NoCoverage). CompileError, RuntimeError and Ignored count
// for neither side. Each mutant is counted once, by file and id.
import { readFileSync } from "node:fs";

const [floorArg, ...paths] = process.argv.slice(2);
const floor = Number(floorArg);

if (!Number.isFinite(floor) || paths.length === 0) {
  console.error("usage: node scripts/mutation-score.mjs <floor> <report.json>...");
  process.exit(2);
}

const detected = new Set(["Killed", "Timeout"]);
const undetected = new Set(["Survived", "NoCoverage"]);
const seen = new Map();

for (const path of paths) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  for (const [file, { mutants }] of Object.entries(report.files)) {
    for (const mutant of mutants) seen.set(`${file}#${mutant.id}`, mutant.status);
  }
}

let hit = 0;
let miss = 0;

for (const status of seen.values()) {
  if (detected.has(status)) hit += 1;
  else if (undetected.has(status)) miss += 1;
}

const score = hit + miss === 0 ? 100 : (100 * hit) / (hit + miss);

console.log(
  `${paths.length} report(s), ${seen.size} mutants: ${hit} detected, ${miss} undetected.` +
    ` Score ${score.toFixed(2)}, floor ${floor}.`,
);

if (score < floor) {
  console.error(`Score ${score.toFixed(2)} is under the floor ${floor}.`);
  process.exit(1);
}
