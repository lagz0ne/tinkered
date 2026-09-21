// Calibrate every judge against the labeled bank (scripts/jev/cases.jsonl) plus the seed
// fixtures, and write scripts/jev/calibration.json: per judge, the numbers and a status that
// lint/preflight read to decide whether a hit is a FLAG (writer must fix or explain) or a NOTE
// (printed, not required). Exit 0 always — this is an eval, not a gate.
//
//   node scripts/jev/calibrate.mjs [--judge <id>] [--dry]   (--dry: numbers only, no file write)
//
// Status per judge:
//   proven      ≥ 2 true and ≥ 2 false cases, median(true) − median(false) ≥ 0.30, and ≥ 90% of
//               (true, false) pairs ordered right — a hit is a flag
//   provisional fewer cases than that (fixtures only, or one side thin) — a hit is a flag, marked ~
//   noisy       enough cases but the separation or the ordering fails — a hit is a note
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadKey, ask, pct, JUDGES, BANK } from "./lib.mjs";
import { LINT, TESTS, TEST_PAIR } from "./bank.mjs";
import { JUDGE_CASES, REACT_CASES } from "./evals/fixtures/lint.mjs";

const OUT = "scripts/jev/calibration.json";
const args = process.argv.slice(2);
const only = args.includes("--judge") ? args[args.indexOf("--judge") + 1] : undefined;
const dry = args.includes("--dry");
const MIN_EACH = 2;
const MIN_SEP = 0.3;
const MIN_ORDERED = 0.9;

/** Every labeled case per judge: the bank rows plus the seed fixture pairs. */
function readCases() {
  const cases = {};
  const add = (judge, label, state, where) => (cases[judge] ??= []).push({ label, state, where });
  for (const [judge, pair] of Object.entries({ ...JUDGE_CASES, ...REACT_CASES })) {
    add(judge, true, pair.bad, "fixture:bad");
    for (const k of Object.keys(pair).filter((k) => k.startsWith("clean")))
      add(judge, false, pair[k], `fixture:${k}`);
  }
  if (existsSync(BANK)) {
    for (const line of readFileSync(BANK, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      add(row.judge, row.label, row.state, row.where);
    }
  }
  return cases;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN;
};

/** The share of (true, false) pairs the judge ordered right; 0 with no pairs. */
function orderedShare(trues, falses) {
  let ordered = 0;
  for (const t of trues) for (const f of falses) if (t > f) ordered++;
  const pairs = trues.length * falses.length;
  return pairs ? ordered / pairs : 0;
}

/** The separation numbers for one judge's answers, and the status they earn. */
function readStatus(trues, falses) {
  const orderedRate = orderedShare(trues, falses);
  const sep = median(trues) - median(falses);
  const enough = trues.length >= MIN_EACH && falses.length >= MIN_EACH;
  const proven = sep >= MIN_SEP && orderedRate >= MIN_ORDERED;
  return {
    status: !enough ? "provisional" : proven ? "proven" : "noisy",
    trues: trues.length,
    falses: falses.length,
    medianTrue: +median(trues).toFixed(2),
    medianFalse: +median(falses).toFixed(2),
    separation: +sep.toFixed(2),
    ordered: +orderedRate.toFixed(2),
  };
}

/** Ask the judge about every case; return the numbers and the status. */
async function calibrate(judge, cases) {
  const q = (LINT[judge] ?? TESTS[judge] ?? TEST_PAIR[judge] ?? JUDGES[judge]).q;
  const trues = [];
  const falses = [];
  for (const c of cases) {
    const p = (await ask(c.state, { [judge]: q }))[judge].probability;
    (c.label ? trues : falses).push(p);
  }
  return readStatus(trues, falses);
}

if (!loadKey()) process.exit(0);
const all = readCases();
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const result = { ...previous };
console.log("jev calibrate — median(true) − median(false), pairs ordered; floor 30 points / 90%\n");
for (const [judge, cases] of Object.entries(all)) {
  if (only && judge !== only) continue;
  const r = await calibrate(judge, cases);
  result[judge] = { ...r, at: new Date().toISOString().slice(0, 10) };
  const mark = r.status === "proven" ? "✓" : r.status === "noisy" ? "✗" : "~";
  console.log(
    `  ${mark} ${judge.padEnd(24)} ${r.status.padEnd(11)} true ${String(r.trues).padStart(2)} (med ${pct(r.medianTrue)})  false ${String(r.falses).padStart(2)} (med ${pct(r.medianFalse)})  sep ${pct(r.separation)}  ordered ${pct(r.ordered)}`,
  );
}
if (!dry) {
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);
}
console.log("Advisory only — a noisy judge prints as a note, never as a flag.");
process.exit(0);
