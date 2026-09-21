// Eval for the lint + guide bank. Each judge must separate its bad fixture from its clean one
// by >= 30 points with bad >= threshold and clean < threshold; each guide case must pick the
// expected option at >= its confidence floor. Exit 0 always — an eval, not a gate.
//   run:  node tools/jev/evals/lint.mjs
import { loadKey, ask, pct } from "../lib.mjs";
import { LINT, GUIDE, SURVIVORS } from "../bank.mjs";
import {
  JUDGE_CASES,
  REACT_CASES,
  UNIT_CASES,
  TARGET_CASES,
  DEFER_CASES,
} from "./fixtures/lint.mjs";
import { SURVIVOR_CASES } from "./fixtures/survivors.mjs";

const FLOOR = 0.3;
if (!loadKey()) process.exit(0);
let pass = 0;
let total = 0;
const row = (ok, line) => {
  total++;
  if (ok) pass++;
  console.log(`  ${ok ? "✓" : "✗"} ${line}`);
};

// A pair is one bad fixture and every clean* fixture; the worst clean sets the separation.
async function judgePair(id, cases, bank = LINT) {
  const j = bank[id];
  const bad = (await ask(cases.bad, { [id]: j.q }))[id].probability;
  const cleans = [];
  for (const key of Object.keys(cases).filter((k) => k.startsWith("clean"))) {
    cleans.push((await ask(cases[key], { [id]: j.q }))[id].probability);
  }
  const clean = Math.max(...cleans);
  const sep = bad - clean;
  const ok = sep >= FLOOR && bad >= j.threshold && clean < j.threshold;
  row(ok, `${id}: bad ${pct(bad)}, clean ${cleans.map(pct).join("/")}, separation ${pct(sep)}`);
}

async function choiceCase(id, c) {
  const g = GUIDE[id];
  const a = (await ask(c.state, { [id]: g.q }))[id];
  const conf = a.probabilities?.[a.choice] ?? 0;
  const what = c.state.description ?? `${c.state.kind} ${c.state.name}`;
  row(
    a.choice === c.expect && conf >= g.minConfidence,
    `${what} → ${a.choice} ${pct(conf)} (want ${c.expect})`,
  );
}

console.log("judges (bad vs clean, floor 30 points)");
for (const [id, cases] of Object.entries(JUDGE_CASES)) await judgePair(id, cases);

console.log("\nreact judges (bad vs clean, floor 30 points)");
for (const [id, cases] of Object.entries(REACT_CASES)) await judgePair(id, cases);

console.log("\nguide: unit (floor 0.6)");
for (const c of UNIT_CASES) await choiceCase("unit", c);

console.log("\nguide: target (floor 0.6)");
for (const c of TARGET_CASES) await choiceCase("target", c);

console.log("\nguide: needsDefer");
{
  const q = { needsDefer: GUIDE.needsDefer.q };
  const bad = (await ask(DEFER_CASES.bad, q)).needsDefer.probability;
  const clean = (await ask(DEFER_CASES.clean, q)).needsDefer.probability;
  const t = GUIDE.needsDefer.threshold;
  row(
    bad - clean >= FLOOR && bad >= t && clean < t,
    `bad ${pct(bad)}, clean ${pct(clean)}, separation ${pct(bad - clean)}`,
  );
}

console.log("\nsurvivor judge (bad vs clean, floor 30 points)");
for (const [id, cases] of Object.entries(SURVIVOR_CASES)) await judgePair(id, cases, SURVIVORS);

console.log(`\nlint eval: ${pass}/${total} cases as expected`);
process.exit(0);
