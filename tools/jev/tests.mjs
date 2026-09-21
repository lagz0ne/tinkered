// Test quality (advisory): the convention's "over-testing is a defect" rules, applied to a
// package's test files. Deterministic first — private imports, mocks, sleeps, `.only`/`.skip`,
// `isError` inside `expect`, internals asserted, helper count/size, an `expect` re-narrowed by
// an `if` — then four Jev judges per test (helper alone, many causes, type guarantee, negative
// twin) and one pairwise judge on title-similar tests in the same file (re-proves the same
// promise). A ⚠ is a delete-or-merge candidate to act on or explain; never a gate. Exit 0.
//
//   node tools/jev/tests.mjs <pkg | file…> [--json out.json] [--pairs N]   (N pairs per file, default 8)
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadKey, ask, pct, readCalibration } from "./lib.mjs";
import { TESTS, TEST_PAIR, sliceTests } from "./bank.mjs";

const args = process.argv.slice(2);
const targets = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (targets.length === 0) {
  console.error("usage: node tools/jev/tests.mjs <pkg | file…> [--json out.json] [--pairs N]");
  process.exit(1);
}
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const PAIRS = Number(opt("--pairs", 8));
const jsonOut = opt("--json");
const CALIBRATION = readCalibration();
const mark = (id) => (CALIBRATION[id]?.status === "noisy" ? "~" : "");

/** A package name expands to its test files; a path passes through. */
function readFiles(target) {
  const dir = join("packages", target, "tests");
  if (existsSync(dir))
    return readdirSync(dir)
      .filter((f) => /\.test\.tsx?$/.test(f))
      .map((f) => join(dir, f));
  return [target];
}

// ---------- deterministic: file-level ----------
const FILE_RULES = [
  [/^import .* from "\.\.\/src\/(?!index\.ts")/m, "privateImport"],
  [/\bvi\.(mock|fn|spyOn)\(/, "mock"],
  [/\bsetTimeout\(/, "sleep"],
  [/\.(only|skip)\(/, "onlyOrSkip"],
];

/** Top-level helpers: count and the longest, against "≤ 3 per file, each under 20 lines". */
function helperNotes(src) {
  const helpers = [...src.matchAll(/^(?:async )?function \w+[^\n]*\{/gm)];
  const notes = [];
  if (helpers.length > 3) notes.push(`helpers ${helpers.length} > 3`);
  for (const h of helpers) {
    const end = src.indexOf("\n}", h.index);
    const lines = src.slice(h.index, end).split("\n").length;
    if (lines > 20) notes.push(`helper ${h[0].match(/function (\w+)/)[1]} ${lines} lines > 20`);
  }
  return notes;
}

function fileNotes(src) {
  return [...FILE_RULES.filter(([re]) => re.test(src)).map(([, id]) => id), ...helperNotes(src)];
}

// ---------- deterministic: per test ----------
const TEST_RULES = [
  [/expect\(\s*isError\(/, "isErrorInExpect"],
  [
    /Object\.isFrozen|\.prototype\b|\.constructor\b|toBeInstanceOf\(Error\)|\b(?:e|err|error|thrown|caught|failure)\.message\)\.toBe\(|toHaveBeenCalled/,
    "assertsInternals",
  ],
  [/expect\(([\w.]+)\)\.toBe\(("[^"]+")\);\s*if \(\1 !== \2\)/, "expectThenNarrow"],
];

/** The same subject asserted with `toBe` and again with `toEqual`: one promise, two angles. */
function toBeThenToEqual(body) {
  const subjects = (re) => new Set([...body.matchAll(re)].map((m) => m[1]));
  const be = subjects(/expect\(([^)]+)\)\.toBe\(/g);
  return [...subjects(/expect\(([^)]+)\)\.toEqual\(/g)].some((s) => be.has(s));
}

function testNotes(body) {
  const notes = TEST_RULES.filter(([re]) => re.test(body)).map(([, id]) => id);
  if (toBeThenToEqual(body)) notes.push("toBeThenToEqual");
  return notes;
}

// ---------- jev ----------
const STOP = new Set(
  "a an the of to in on for and or is are with by as at from that this it its when one no not into still".split(
    " ",
  ),
);
const stems = (s) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[`"'()[\]{}:,.]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ies|es|s|ed|ing)$/, "")),
  );

/** The most title-similar pairs in one file, up to PAIRS, for the pairwise judge. */
function similarPairs(tests) {
  const scored = [];
  for (let i = 0; i < tests.length; i++)
    for (let j = i + 1; j < tests.length; j++) {
      const a = stems(tests[i].title);
      const shared = [...stems(tests[j].title)].filter((w) => a.has(w)).length;
      if (shared >= 2) scored.push({ a: tests[i], b: tests[j], shared });
    }
  return scored.sort((x, y) => y.shared - x.shared).slice(0, PAIRS);
}

async function judgeTest(t) {
  const answers = await ask(
    { title: t.title, body: t.body },
    Object.fromEntries(Object.entries(TESTS).map(([id, j]) => [id, j.q])),
  );
  return Object.entries(TESTS)
    .filter(([id, j]) => answers[id].probability >= j.threshold)
    .map(([id]) => `${mark(id)}${id} ${pct(answers[id].probability)}`);
}

async function judgePair(p) {
  const id = "reprovesSamePromise";
  const a = (
    await ask(
      { a: { title: p.a.title, body: p.a.body }, b: { title: p.b.title, body: p.b.body } },
      { [id]: TEST_PAIR[id].q },
    )
  )[id];
  return a.probability >= TEST_PAIR[id].threshold ? `${mark(id)}${id} ${pct(a.probability)}` : null;
}

if (!loadKey()) process.exit(0);
const report = [];
for (const file of targets.flatMap(readFiles)) {
  const src = readFileSync(file, "utf8");
  const tests = sliceTests(src);
  const fnotes = fileNotes(src);
  console.log(`${file}${fnotes.length ? `  ⚠ ${fnotes.join(", ")}` : ""}`);
  for (const t of tests) {
    const notes = [...testNotes(t.body), ...(await judgeTest(t))];
    report.push({ file, line: t.line, title: t.title, notes });
    console.log(
      `  ${notes.length ? "⚠" : "✓"} L${t.line} ${t.title}${notes.length ? `  — ${notes.join(", ")}` : ""}`,
    );
  }
  for (const p of similarPairs(tests)) {
    const hit = await judgePair(p);
    if (!hit) continue;
    report.push({ file, line: p.a.line, title: `${p.a.title} ↔ ${p.b.title}`, notes: [hit] });
    console.log(`  ⚠ L${p.a.line} ↔ L${p.b.line}  ${hit}: "${p.a.title}" / "${p.b.title}"`);
  }
}
const flagged = report.filter((r) => r.notes.some((n) => !n.startsWith("~"))).length;
console.log(
  `\njev tests: ${flagged}/${report.length} entries flagged. Each ⚠ is delete, merge, or explain — the convention says over-testing is a defect. Not a gate.`,
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
process.exit(0);
