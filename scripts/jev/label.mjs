// Label one case for the calibration bank (docs/roadmap/jev-loop/PLAN.md, "calibration").
// A case is a judge, a label, and the exact Jev state the judge saw — stored inline so the
// bank survives history rewrites. The workflow feeds it: a pre-flight flag the writer FIXED is
// a `true` case, one the writer EXPLAINED is a `false` case; a lead's fix-round nit that maps to
// a judge is a `true` case. `scripts/jev/calibrate.mjs` reads the bank.
//
//   node scripts/jev/label.mjs <judge> <true|false> <file>[#<unit>] [--ref <sha>] [--why "<text>"] [--by <ticket>]
//   <judge> is a file judge (lib.mjs JUDGES: state = { file, code }) or a unit judge (bank.mjs
//   LINT: state = the sliced unit named after `#`). `--ref` reads the file at that commit.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { BANK, JUDGES } from "./lib.mjs";
import { LINT, TESTS, TEST_PAIR, slice, sliceTests, forJev } from "./bank.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const [judge, labelWord, target] = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (!judge || !["true", "false"].includes(labelWord ?? "") || !target) {
  console.error(
    'usage: node scripts/jev/label.mjs <judge> <true|false> <file>[#<unit>] [--ref <sha>] [--why "<text>"] [--by <ticket>]',
  );
  process.exit(1);
}
const isUnitJudge = judge in LINT;
const isTestJudge = judge in TESTS || judge in TEST_PAIR;
if (!isUnitJudge && !isTestJudge && !(judge in JUDGES)) {
  console.error(
    `label: unknown judge ${judge}; file judges: ${Object.keys(JUDGES).join(", ")}; unit judges: ${Object.keys(LINT).join(", ")}`,
  );
  process.exit(1);
}
const [file, unitName] = target.split("#");
const ref = flag("--ref");
const code = ref
  ? execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" })
  : readFileSync(file, "utf8");

/** A test judge's state: the test whose title starts with the `#` part (a pair judge takes `a|b` titles). */
function readTestState() {
  const tests = sliceTests(code);
  const pick = (prefix) => tests.find((t) => t.title.startsWith(prefix));
  if (judge in TEST_PAIR) {
    const [a, b] = (unitName ?? "").split("|").map((p) => pick(p.trim()));
    if (!a || !b) {
      console.error(`label: ${judge} needs ${file}#<title a>|<title b>`);
      process.exit(1);
    }
    return { a: { title: a.title, body: a.body }, b: { title: b.title, body: b.body } };
  }
  const t = pick(unitName ?? "");
  if (!t) {
    console.error(`label: no test titled "${unitName}…" in ${file}`);
    process.exit(1);
  }
  return { title: t.title, body: t.body };
}

/** The state the judge sees: a unit judge gets the sliced unit; a test judge the test; a file judge the file. */
function readState() {
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
