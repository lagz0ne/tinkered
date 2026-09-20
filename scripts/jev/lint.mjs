// Jev lint (advisory): one call per declared unit or outermost function — the anti-goal judges
// that apply to its kind plus the unit classifier. Prints flags; never gates; exits 0.
//
//   node scripts/jev/lint.mjs [paths…] [--all] [--limit N] [--json out.json]
//   default paths: examples/ and apps/issue-tracker/src (git-tracked .ts/.tsx, no tests)
//   --all also judges data/tag declarations, functions under 150 chars, and composition roots
//   (functions that call createScope) — all skipped by default
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadKey, ask, pct } from "./lib.mjs";
import { slice, forJev, LINT, GUIDE } from "./bank.mjs";

const DEFAULT = ["examples/*.ts", "apps/issue-tracker/src/*.ts", "apps/issue-tracker/src/*.tsx"];
const VALUED = new Set(["--limit", "--json"]);
const args = process.argv.slice(2);
const valueOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const paths = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
const all = args.includes("--all");
const limit = Number(valueOf("--limit") ?? Infinity);
const jsonOut = valueOf("--json");

function listFiles(specs) {
  const quoted = specs.map((s) => `'${s}'`).join(" ");
  const out = execSync(`git ls-files -- ${quoted}`, { encoding: "utf8" });
  return out.split("\n").filter((f) => f && !/\.test\.tsx?$|\.d\.ts$/.test(f));
}

function questionsFor(kind) {
  const qs = { unit: GUIDE.unit.q };
  for (const [id, j] of Object.entries(LINT)) if (j.applies.includes(kind)) qs[id] = j.q;
  return qs;
}

function flagsOf(answers) {
  return Object.entries(LINT)
    .filter(([id, j]) => answers[id] && answers[id].probability >= j.threshold)
    .map(([id]) => `${id} ${pct(answers[id].probability)}`);
}

function readsAs(kind, answer) {
  const c = answer.choice;
  const conf = answer.probabilities?.[c] ?? 0;
  if (conf < GUIDE.unit.minConfidence) return null;
  if (kind === "function") return c === "glue" ? null : `reads like a ${c} (${pct(conf)})`;
  return c === kind ? null : `declared ${kind}, reads like ${c} (${pct(conf)})`;
}

function printUnit(u, flags, reads) {
  const head = `${u.kind} ${u.name} (L${u.line})`;
  const notes = reads ? [...flags, reads] : flags;
  console.log(notes.length ? `  ⚠ ${head}: ${notes.join(", ")}` : `  ✓ ${head}`);
}

// Skipped by default: data/tag one-liners and tiny functions (type guards, predicates).
const MIN_FUNCTION = 150;
// A function that calls createScope is a composition root (rule 1), not a primitive candidate.
const isRoot = (u) => u.kind === "function" && u.source.includes("createScope(");
const smallFunction = (u) => u.kind === "function" && u.source.length < MIN_FUNCTION;
const oneLiner = (u) => u.kind === "data" || u.kind === "tag";
const wanted = (u) => all || !(isRoot(u) || smallFunction(u) || oneLiner(u));

if (!loadKey()) process.exit(0);
const files = listFiles(paths.length ? paths : DEFAULT);
const report = [];
console.log(`jev lint (advisory) — ${files.length} file(s)\n`);
for (const file of files) {
  if (report.length >= limit) break;
  const units = slice(readFileSync(file, "utf8")).filter(wanted);
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

const noted = report.filter((r) => r.flags.length || r.reads).length;
const counts = {};
for (const r of report)
  for (const f of r.flags) counts[f.split(" ")[0]] = (counts[f.split(" ")[0]] ?? 0) + 1;
console.log(
  `\njev lint: ${report.length} unit(s), ${noted} with notes. By question: ${JSON.stringify(counts)}`,
);
console.log("Advisory only — vp check / tests / the lead decide.");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exit(0);
