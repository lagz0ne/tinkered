// Surviving mutants that matter (advisory): reads Stryker's JSON report, picks out every
// survivor (Survived or NoCoverage), and asks one Jev question per survivor — would a user of
// this package see a wrong result if this change shipped? A ⚠ is a seam-test candidate to
// write; the rest can wait. Never a gate. Exit 0.
//
//   node tools/jev/survivors.mjs core                                  # reads packages/core/reports/mutation/mutation.json
//   node tools/jev/survivors.mjs core --report path/to/mutation.json   # read this report instead
//   node tools/jev/survivors.mjs core --json out.json                  # also write the rows
//   node tools/jev/survivors.mjs core --limit 40                       # first N survivors only
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadKey, ask, pct, readCalibration } from "./lib.mjs";
import { SURVIVORS, sliceSurvivors, forSurvivorJev } from "./bank.mjs";

const args = process.argv.slice(2);
const targets = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (targets.length === 0) {
  console.error(
    "usage: node tools/jev/survivors.mjs <pkg> [--report path] [--json out.json] [--limit N]",
  );
  process.exit(1);
}
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const reportPath = opt("--report", join("packages", targets[0], "reports/mutation/mutation.json"));
const jsonOut = opt("--json");
const limit = Number(opt("--limit", Number.POSITIVE_INFINITY));
const CALIBRATION = readCalibration();

/** `~` when calibration found this judge noisy; read the hit, no line owed. */
const mark = (id) => (CALIBRATION[id]?.status === "noisy" ? "~" : "");
const ID = "survivorMatters";
const { threshold, q } = SURVIVORS[ID];

if (!loadKey()) process.exit(0);
if (!existsSync(reportPath)) {
  console.error(
    `jev survivors: no report at ${reportPath}; run stryker with the json reporter first`,
  );
  process.exit(0);
}
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const survivors = sliceSurvivors(report, `packages/${targets[0]}`).slice(0, limit);

const rows = [];
for (const s of survivors) {
  const { probability } = (await ask(forSurvivorJev(s), { [ID]: q }))[ID];
  rows.push({ ...s, probability });
}

const byFile = new Map();
for (const r of rows) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}
for (const [file, rs] of byFile) {
  console.log(file);
  for (const r of rs) {
    const flag = r.probability >= threshold ? "⚠" : "·";
    console.log(
      `  ${mark(ID)}${flag} L${r.line} ${r.mutator} in ${r.unit.kind}#${r.unit.name}  \`${r.before}\` → \`${r.after}\`  ${ID} ${pct(r.probability)}`,
    );
  }
}
const matter = rows.filter((r) => r.probability >= threshold && !mark(ID)).length;
console.log(
  `\njev survivors: ${matter}/${rows.length} matter (${mark(ID)}⚠). Write a seam test for each ⚠; leave the rest. Not a gate.`,
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2) + "\n");
process.exit(0);
