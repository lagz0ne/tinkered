// Promise gap (advisory): every seam test names a promise; which of them does the package README
// never state? Deterministic part: the test titles and the README's candidate lines, narrowed to
// the few lines that share words with the title. Jev part: one pick per title — "which line
// promises this behaviour?" with `none` as an option. A `none` is a gap to write, not a defect.
// Exit 0 always.
//
//   node tools/jev/promises.mjs <pkg> [--json out.json] [--top N] [--floor P]
//   N candidates per title (default 6); a `none` below confidence P (default 0.7) prints as unsure, not a gap
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadKey, ask, pct } from "./lib.mjs";

const args = process.argv.slice(2);
const pkg = args.find((a) => !a.startsWith("--"));
if (!pkg) {
  console.error("usage: node tools/jev/promises.mjs <pkg> [--json out.json] [--top N]");
  process.exit(1);
}
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const TOP = Number(opt("--top", 6));
const jsonOut = opt("--json");
const FLOOR = Number(opt("--floor", 0.7));
const dir = join("packages", pkg);

/** Every `test("…")` title under the package's tests. */
function readTitles() {
  const out = [];
  for (const f of readdirSync(join(dir, "tests")).filter((f) => /\.test\.tsx?$/.test(f))) {
    const src = readFileSync(join(dir, "tests", f), "utf8");
    for (const m of src.matchAll(/^\s*(?:test|it)\(\s*"([^"]+)"/gm))
      out.push({ file: f, title: m[1] });
  }
  return out;
}

/** Is this README line a candidate carrier? Not a heading, not a table rule. */
const isProseLine = (raw) =>
  !raw.startsWith("#") && !raw.trim().startsWith("|--") && !raw.trim().startsWith("| -");

/** The sentence-ish chunks of one line: table cells split, bullets stripped, 40+ chars kept. */
function chunksOf(raw) {
  const cells = raw.startsWith("|") ? raw.split("|").map((c) => c.trim()) : [raw.trim()];
  return cells
    .flatMap((cell) => cell.split(/(?<=[.;])\s+(?=[A-Z`])/))
    .map((sentence) => sentence.replace(/^[-*]\s+/, "").trim())
    .filter((s) => s.length >= 40);
}

/** README lines that could carry a promise: prose, bullets, and table cells outside code
 * fences and headings, one candidate per sentence-ish chunk of 40+ chars. */
function readPromises() {
  const out = [];
  let fence = false;
  for (const raw of readFileSync(join(dir, "README.md"), "utf8").split("\n")) {
    if (raw.trim().startsWith("```")) fence = !fence;
    else if (!fence && isProseLine(raw)) out.push(...chunksOf(raw));
  }
  return [...new Set(out)];
}

const STOP = new Set(
  "a an the of to in on for and or is are with by as at from that this it its when one no not into".split(
    " ",
  ),
);
const words = (s) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[`"'()[\]{}:,.]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ies|es|s|ed|ing)$/, "")),
  );

/** The TOP README lines sharing the most stems with the title. */
function candidates(title, promises) {
  const t = words(title);
  return promises
    .map((p) => ({ p, score: [...words(p)].filter((w) => t.has(w)).length }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP)
    .map((c) => c.p);
}

if (!loadKey()) process.exit(0);
const titles = readTitles();
const promises = readPromises();
console.log(
  `jev promises (advisory) — ${pkg}: ${titles.length} test titles, ${promises.length} README candidates\n`,
);
const report = [];
for (const { file, title } of titles) {
  const options = candidates(title, promises);
  const criteria = Object.fromEntries(options.map((o, i) => [`L${i + 1}`, o]));
  criteria.none = "no candidate states this behaviour as a promise to the user";
  const q = {
    pick: {
      type: "choice",
      instructions: `A test in this package is titled: "${title}". Which candidate README line promises the behaviour the title names? Choose none when no line states it.`,
      criteria,
    },
  };
  const a = options.length
    ? (await ask({ test: title, candidates: options }, q)).pick
    : { choice: "none", probabilities: { none: 1 } };
  const conf = a.probabilities?.[a.choice] ?? 0;
  const none = a.choice === "none";
  const gap = none && conf >= FLOOR;
  const unsure = none && !gap;
  report.push({
    file,
    title,
    gap,
    unsure,
    choice: a.choice,
    confidence: conf,
    line: none ? null : criteria[a.choice],
  });
  const mark = gap ? "⚠" : unsure ? "?" : "✓";
  const tail = none
    ? `  — no README line (${pct(conf)}${unsure ? ", unsure" : ""})`
    : `  ← ${criteria[a.choice].slice(0, 70)}… (${pct(conf)})`;
  console.log(`  ${mark} ${title}${tail}`);
}
const gaps = report.filter((r) => r.gap);
const unsure = report.filter((r) => r.unsure);
console.log(
  `\njev promises: ${gaps.length}/${titles.length} titles have no README line (${unsure.length} more unsure, under ${pct(FLOOR)}). Write the gaps, or say why they are not promises.`,
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
process.exit(0);
