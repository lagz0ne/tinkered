// Test quality (advisory): the convention's "over-testing is a defect" rules, applied to a
// package's test files. Deterministic first, on parsed facts (extract.mjs) — private imports,
// mocks, sleeps, `.only`/`.skip`, `isError` inside `expect`, internals asserted, helper count/size,
// an `expect` re-narrowed by the same `if`, `toBe` then `toEqual` on one subject — then four Jev
// judges per test, each seeing the test's title, causes, assertions, narrowings, and body (helper alone, many causes, type guarantee, negative
// twin) and one pairwise judge on title-similar tests in the same file (re-proves the same
// promise). A ⚠ is a delete-or-merge candidate to act on or explain; never a gate. Exit 0.
//
//   node tools/jev/tests.mjs <pkg | file…> [--json out.json] [--pairs N]   (N pairs per file, default 8)
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadKey, ask, pct, readCalibration } from "./lib.mjs";
import { TESTS } from "./bank.mjs";
import { tests as extractTests, helpers, imports } from "./extract.mjs";

const args = process.argv.slice(2);
const targets = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (targets.length === 0) {
  console.error("usage: node tools/jev/tests.mjs <pkg | file…> [--json out.json] [--pairs N]");
  process.exit(1);
}
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
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

// ---------- deterministic: on extracted facts, not regex ----------

/** File-level: a private `../src/*` import, mocks, sleeps, `.only`/`.skip`, helpers over 3 or 20 lines. */
function fileNotes(src, file) {
  const notes = [];
  if (
    imports(src, file).some((i) => i.source.startsWith("../src/") && i.source !== "../src/index.ts")
  )
    notes.push("privateImport");
  if (/\bvi\.(mock|fn|spyOn)\(/.test(src)) notes.push("mock");
  if (/\bsetTimeout\(/.test(src)) notes.push("sleep");
  if (/\b(test|it|describe)\.(only|skip)\(/.test(src)) notes.push("onlyOrSkip");
  const hs = helpers(src, file);
  if (hs.length > 3) notes.push(`helpers ${hs.length} > 3`);
  for (const h of hs) if (h.lines > 20) notes.push(`helper ${h.name} ${h.lines} lines > 20`);
  return notes;
}

const INTERNAL_SUBJECT =
  /Object\.isFrozen\(|\.prototype\b|\.constructor\b|^(?:e|err|error|thrown|caught|failure)\.message$/;
const INTERNAL_MATCHER = /^toHaveBeenCalled|^toBeInstanceOf$/;

/** Per test, from its extracted assertions and narrowings. */
function testNotes(t) {
  const notes = new Set();
  for (const a of t.asserts) {
    if (a.subject.startsWith("isError(")) notes.add("isErrorInExpect");
    if (INTERNAL_SUBJECT.test(a.subject) || INTERNAL_MATCHER.test(a.matcher))
      notes.add("assertsInternals");
    if (a.matcher === "toBe" && t.narrows.includes(`${a.subject} !== ${a.arg}`))
      notes.add("expectThenNarrow");
  }
  const be = new Set(t.asserts.filter((a) => a.matcher === "toBe").map((a) => a.subject));
  if (t.asserts.some((a) => a.matcher === "toEqual" && be.has(a.subject)))
    notes.add("toBeThenToEqual");
  return [...notes];
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

async function judgeTest(t) {
  if (!Object.keys(TESTS).length) return [];
  const facts = {
    title: t.title,
    causes: t.causes,
    asserts: t.asserts.map((a) => `${a.subject}${a.not ? ".not" : ""}.${a.matcher}(${a.arg})`),
    narrows: t.narrows,
    body: t.body,
  };
  const answers = await ask(
    facts,
    Object.fromEntries(Object.entries(TESTS).map(([id, j]) => [id, j.q])),
  );
  return Object.entries(TESTS)
    .filter(([id, j]) => answers[id].probability >= j.threshold)
    .map(([id]) => `${mark(id)}${id} ${pct(answers[id].probability)}`);
}

if (!loadKey()) process.exit(0);
const report = [];
for (const file of targets.flatMap(readFiles)) {
  const src = readFileSync(file, "utf8");
  const tests = extractTests(src, file);
  const fnotes = fileNotes(src, file);
  console.log(`${file}${fnotes.length ? `  ⚠ ${fnotes.join(", ")}` : ""}`);
  for (const t of tests) {
    const notes = [...testNotes(t), ...(await judgeTest(t))];
    report.push({ file, line: t.line, title: t.title, notes });
    console.log(
      `  ${notes.length ? "⚠" : "✓"} L${t.line} ${t.title}${notes.length ? `  — ${notes.join(", ")}` : ""}`,
    );
  }
}
const flagged = report.filter((r) => r.notes.some((n) => !n.startsWith("~"))).length;
console.log(
  `\njev tests: ${flagged}/${report.length} entries flagged. Each ⚠ is delete, merge, or explain — the convention says over-testing is a defect. Not a gate.`,
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
process.exit(0);
