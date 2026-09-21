// Label one case for the calibration bank (docs/roadmap/jev-loop/PLAN.md, "calibration").
// A case is a judge, a label, and the exact Jev state the judge saw — stored inline so the
// bank survives history rewrites. The workflow feeds it: a pre-flight flag the writer FIXED is
// a `true` case, one the writer EXPLAINED is a `false` case; a lead's fix-round nit that maps to
// a judge is a `true` case. `tools/jev/calibrate.mjs` reads the bank.
//
//   node tools/jev/label.mjs <judge> <true|false> <file>[#<unit>] [--ref <sha>] [--why "<text>"] [--by <ticket>]
//   <judge> is a file judge (lib.mjs JUDGES: state = { file, code }) or a unit judge (bank.mjs
//   LINT: state = the sliced unit named after `#`). `--ref` reads the file at that commit.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { BANK, JUDGES } from "./lib.mjs";

//   node tools/jev/label.mjs --merge
// Merges a conflicted bank: drops git conflict markers, keeps one line per `id` in
// first-seen order, rewrites the file. Two branches appending labels at once is the
// usual cause; appends never overlap, so first-seen wins and nothing is lost.
const args = process.argv.slice(2);

/** A conflict marker line git leaves in the file. */
const isMarker = (line) =>
  line.startsWith("<<<<<<< ") || line === "=======" || line.startsWith(">>>>>>> ");

/** The bank's rows: marker lines dropped, bad lines skipped, first id wins. */
function unionRows(text) {
  const seen = new Set();
  const rows = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim() || isMarker(line)) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (typeof row.id !== "string" || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(line);
  }
  return { rows, skipped };
}

/** Merge the bank at `path` and print the count. */
function mergeBank(path) {
  const { rows, skipped } = unionRows(readFileSync(path, "utf8"));
  writeFileSync(path, rows.join("\n") + "\n");
  const note = skipped ? ` (${skipped} bad lines dropped)` : "";
  console.log(`label: merged ${rows.length} cases${note} → ${path}`);
}

if (args.includes("--merge")) {
  const bank = process.env.JEV_BANK ?? BANK;
  mergeBank(bank);
  process.exit(0);
}

import {
  LINT,
  TESTS,
  SURVIVORS,
  slice,
  sliceTests,
  sliceSurvivors,
  forJev,
  forSurvivorJev,
} from "./bank.mjs";
import { join } from "node:path";

const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const [judge, labelWord, target] = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (!judge || !["true", "false"].includes(labelWord ?? "") || !target) {
  console.error(
    'usage: node tools/jev/label.mjs <judge> <true|false> <file>[#<unit>] [--ref <sha>] [--why "<text>"] [--by <ticket>]',
  );
  process.exit(1);
}
const isUnitJudge = judge in LINT;
const isTestJudge = judge in TESTS;
const isSurvivorJudge = judge in SURVIVORS;
if (!isUnitJudge && !isTestJudge && !isSurvivorJudge && !(judge in JUDGES)) {
  console.error(
    `label: unknown judge ${judge}; file judges: ${Object.keys(JUDGES).join(", ")}; unit judges: ${Object.keys(LINT).join(", ")}; survivor judges: ${Object.keys(SURVIVORS).join(", ")}`,
  );
  process.exit(1);
}
const [file, unitName] = target.split("#");
const ref = flag("--ref");
const code = ref
  ? execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" })
  : readFileSync(file, "utf8");

/** A test judge's state: the test whose title starts with the `#` part, in the same shape
 * `tests.mjs` sends (title, causes, asserts, narrows, body). */
function readTestState() {
  const t = sliceTests(code).find((test) => test.title.startsWith(unitName ?? ""));
  if (!t) {
    console.error(`label: no test titled "${unitName}…" in ${file}`);
    process.exit(1);
  }
  return {
    title: t.title,
    causes: t.causes,
    asserts: t.asserts.map((a) => `${a.subject}${a.not ? ".not" : ""}.${a.matcher}(${a.arg})`),
    narrows: t.narrows,
    body: t.body,
  };
}

/** The state the judge sees: a unit judge gets the sliced unit; a test judge the test; a survivor judge the sliced survivor; a file judge the file. */
function readState() {
  if (isSurvivorJudge) return readSurvivorState();
  if (isTestJudge) return readTestState();
  if (!isUnitJudge) return { file, code };
  if (!unitName) {
    console.error(`label: ${judge} is a unit judge; name the unit as ${file}#<name>`);
    process.exit(1);
  }
  const unit = slice(code, file).find((u) => u.name === unitName);
  if (!unit) {
    console.error(`label: no unit named ${unitName} in ${file}${ref ? ` at ${ref}` : ""}`);
    process.exit(1);
  }
  return forJev(unit);
}

/** A survivor judge's state: the survivor with this mutant id from the package report. Target is `<file>#<mutantId>` where `<file>` is the printed path (`packages/<pkg>/…`). */
function readSurvivorState() {
  const [pkg] = file.split("/").slice(1, 2);
  const report = JSON.parse(
    readFileSync(join("packages", pkg, "reports/mutation/mutation.json"), "utf8"),
  );
  const hit = sliceSurvivors(report, `packages/${pkg}`).find((s) => s.id === target);
  if (!hit) {
    console.error(`label: no survivor ${target} in packages/${pkg}/reports/mutation/mutation.json`);
    process.exit(1);
  }
  return forSurvivorJev(hit);
}

const state = readState();
const id = createHash("sha1")
  .update(judge + labelWord + JSON.stringify(state))
  .digest("hex")
  .slice(0, 12);
const existing = existsSync(BANK) ? readFileSync(BANK, "utf8") : "";
if (existing.includes(`"id":"${id}"`)) {
  console.log(`label: already in the bank (${id})`);
  process.exit(0);
}
const row = {
  id,
  judge,
  label: labelWord === "true",
  state,
  where: `${file}${unitName ? "#" + unitName : ""}${ref ? "@" + ref : ""}`,
  why: flag("--why") ?? "",
  by: flag("--by") ?? "",
  at: new Date().toISOString().slice(0, 10),
};
appendFileSync(BANK, JSON.stringify(row) + "\n");
console.log(`label: ${judge} ${labelWord} ← ${row.where} (${id})`);
