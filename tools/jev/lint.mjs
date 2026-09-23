// Jev lint (advisory): one call per declared unit or outermost function — the anti-goal judges
// that apply to its kind plus the unit classifier. Prints flags (`⚠`) and kind notes (`ℹ`);
// never gates; exits 0.
//
//   node tools/jev/lint.mjs [paths…] [--all] [--limit N] [--json out.json]
//   default paths: examples/ and apps/issue-tracker/src (git-tracked .ts/.tsx, no tests)
//   --all also judges data/tag declarations, functions under 150 chars, and composition roots
//   (functions that call createScope) — all skipped by default
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { loadKey, ask, pct, readCalibration } from "./lib.mjs";
import { slice, forJev, LINT, GUIDE } from "./bank.mjs";

/** Per-judge status from `tools/jev/calibrate.mjs`: a `noisy` judge prints as a note (`~`), never as a flag. */
const CALIBRATION = readCalibration();
const isNoisy = (id) => CALIBRATION[id]?.status === "noisy";

const DEFAULT = [
  "examples/*.ts",
  "examples/*.tsx",
  "apps/issue-tracker/src/*.ts",
  "apps/issue-tracker/src/*.tsx",
];
const VALUED = new Set(["--limit", "--json"]);
const args = process.argv.slice(2);
const valueOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const paths = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
const all = args.includes("--all");
const limit = Number(valueOf("--limit") ?? Infinity);
const jsonOut = valueOf("--json");

function listFiles(specs) {
  // A directory argument means its git-tracked sources, like a glob; a file passes through.
  const isFile = (s) => existsSync(s) && !statSync(s).isDirectory();
  const direct = specs.filter(isFile);
  const globs = specs.filter((s) => !isFile(s));
  const quoted = globs.map((s) => `'${s}'`).join(" ");
  const listed = globs.length ? execSync(`git ls-files -- ${quoted}`, { encoding: "utf8" }) : "";
  return [...direct, ...listed.split("\n")].filter((f) => f && !/\.test\.tsx?$|\.d\.ts$/.test(f));
}

function questionsFor(kind) {
  const qs = { unit: GUIDE.unit.q };
  for (const [id, j] of Object.entries(LINT)) if (j.applies.includes(kind)) qs[id] = j.q;
  return qs;
}

/** Hits above threshold: a calibrated-noisy judge prints as `~note`, a proven or provisional one as a flag. */
function flagsOf(answers) {
  return Object.entries(LINT)
    .filter(([id, j]) => answers[id] && answers[id].probability >= j.threshold)
    .map(([id]) => `${isNoisy(id) ? "~" : ""}${id} ${pct(answers[id].probability)}`);
}

// What each sliced kind should read like: helpers and hooks as glue, components as a view.
const EXPECTED = { function: "glue", hook: "glue", component: "view" };

/** `a`/`an` by the word after it, so a kind note reads as English ("reads like an operation"). */
const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");

function readsAs(kind, answer) {
  const c = answer.choice;
  const conf = answer.probabilities?.[c] ?? 0;
  if (conf < GUIDE.unit.minConfidence || c === (EXPECTED[kind] ?? kind)) return null;
  if (kind in EXPECTED) return `reads like ${article(c)} ${c} (${pct(conf)})`;
  return `declared ${kind}, reads like ${c} (${pct(conf)})`;
}

// A judge hit keeps the ⚠ mark; the kind classifier's note rides after it as ℹ (a hint, no
// fix or label owed — label.mjs has no `unit` judge to record it against).
function printUnit(u, flags, reads) {
  const head = `${u.kind} ${u.name} (L${u.line})`;
  if (flags.length) console.log(`  ⚠ ${head}: ${flags.join(", ")}${reads ? `  ℹ ${reads}` : ""}`);
  else console.log(reads ? `  ℹ ${head}: ${reads}` : `  ✓ ${head}`);
}

// Skipped by default: data/tag one-liners and tiny functions (type guards, predicates).
const MIN_FUNCTION = 150;
// A function that calls createScope is a composition root (rule 1), not a primitive candidate.
const isRoot = (u) => u.kind in EXPECTED && u.source.includes("createScope(");
const smallFunction = (u) => u.kind === "function" && u.source.length < MIN_FUNCTION;
const oneLiner = (u) => u.kind === "data" || u.kind === "tag";
const wanted = (u) => all || !(isRoot(u) || smallFunction(u) || oneLiner(u));

if (!loadKey()) process.exit(0);
const files = listFiles(paths.length ? paths : DEFAULT);
const report = [];
console.log(`jev lint (advisory) — ${files.length} file(s)\n`);
for (const file of files) {
  if (report.length >= limit) break;
  const units = slice(readFileSync(file, "utf8"), file).filter(wanted);
  if (units.length === 0) continue;
  console.log(file);
  for (const u of units) {
    if (report.length >= limit) break;
    const answers = await ask(forJev(u), questionsFor(u.kind));
    const flags = flagsOf(answers);
    const reads = readsAs(u.kind, answers.unit);
    report.push({ file, kind: u.kind, name: u.name, line: u.line, flags, reads });
    printUnit(u, flags, reads);
  }
}

const flagged = report.filter((r) => r.flags.length).length;
const noted = report.filter((r) => r.reads).length;
const counts = {};
for (const r of report)
  for (const f of r.flags) counts[f.split(" ")[0]] = (counts[f.split(" ")[0]] ?? 0) + 1;
console.log(
  `\njev lint: ${report.length} unit(s), ${flagged} ⚠ flag(s), ${noted} ℹ note(s). By question: ${JSON.stringify(counts)}`,
);
console.log(
  "Advisory only — every ⚠ is fixed or explained, then labeled (a ~ hit: read it, no line owed); an ℹ note is a hint, no fix or label owed. vp check / tests / the lead decide.",
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exit(0);
