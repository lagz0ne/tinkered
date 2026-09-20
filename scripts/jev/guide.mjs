// Jev guide (advisory): which @tinker/core unit should this logic be? Takes plain words or one
// unit/function from a file. Never gates; exits 0.
//
//   node scripts/jev/guide.mjs "poll the API every 10s and keep the latest list"
//   node scripts/jev/guide.mjs apps/issue-tracker/src/client/connection.ts#reconnectingTransport
import { readFileSync } from "node:fs";
import { loadKey, ask, pct } from "./lib.mjs";
import { slice, forJev, GUIDE, SHAPE } from "./bank.mjs";

const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!arg) {
  console.error('usage: node scripts/jev/guide.mjs "<logic in words>" | <file.ts#symbol>');
  process.exit(0);
}

function stateFor(spec) {
  const m = /^(.+\.tsx?)#(\w+)$/.exec(spec);
  if (!m) return { description: spec };
  const u = slice(readFileSync(m[1], "utf8")).find((x) => x.name === m[2]);
  if (!u) throw new Error(`guide: no unit or function named ${m[2]} in ${m[1]}`);
  return forJev(u);
}

const distribution = (probs) =>
  Object.entries(probs ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, p]) => `${k} ${pct(p)}`)
    .join(", ");

if (!loadKey()) process.exit(0);
const state = stateFor(arg);
const questions = { unit: GUIDE.unit.q, target: GUIDE.target.q, needsDefer: GUIDE.needsDefer.q };
const a = await ask(state, questions);
const pick = a.unit.choice;
const conf = a.unit.probabilities?.[pick] ?? 0;
const label = state.description ?? `${state.kind} ${state.name}`;
console.log(`jev guide (advisory) — ${label}\n`);
if (conf >= GUIDE.unit.minConfidence) {
  console.log(`  unit:  ${pick} (${pct(conf)})`);
  console.log(`  shape: ${SHAPE[pick]}`);
} else {
  console.log(`  unit:  unclear (${pick} only ${pct(conf)}) — decide with the one-law table`);
}
console.log(`  all:   ${distribution(a.unit.probabilities)}`);
if (pick === "resource") {
  const t = a.target.choice;
  const tc = a.target.probabilities?.[t] ?? 0;
  const line =
    tc >= GUIDE.target.minConfidence ? `${t} (${pct(tc)})` : `unclear (${t} only ${pct(tc)})`;
  console.log(`  target: ${line}`);
}
const d = a.needsDefer.probability;
console.log(`  needs defer: ${d >= GUIDE.needsDefer.threshold ? "yes" : "no"} (${pct(d)})`);
console.log("\n  rule: docs/best-practices.md, the one law. Advisory only — you decide.");
process.exit(0);
