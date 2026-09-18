// Verification aid for the lead review (ADR: docs/roadmap/jev-loop/PLAN.md).
// Runs the proven judge set per changed source file, the gated route classifier on the whole
// diff, and the overclaim check on the commit message. ADVISORY ONLY — always exits 0 unless
// --strict is passed (for experiments; never wire --strict into a gate). It routes the lead's
// attention; scripts/ticket.sh + the human are the only pass/fail.
//
//   node scripts/jev/review.mjs [<range>] [--strict]
//   range defaults to HEAD~1..HEAD; use "--staged" or "main..HEAD" etc.
import {
  loadKey,
  ask,
  diff,
  message,
  changedSources,
  fileAt,
  JUDGES,
  ROUTE,
  OVERCLAIM,
  pct,
} from "./lib.mjs";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const range = args.find((a) => !a.startsWith("--")) ?? "HEAD~1..HEAD";

if (!loadKey()) process.exit(0);

let flags = 0;
const flag = (line) => {
  flags++;
  console.log(`  ⚠ ${line}`);
};

console.log(`jev review (advisory) — range ${range}\n`);

// --- per-file judges (the lead's shape checklist: stub / memo / leaked internal) ---
const files = changedSources(range);
if (files.length === 0) console.log("(no source files changed)");
for (const f of files) {
  const code = fileAt(range, f);
  if (!code.trim()) continue;
  const answers = await ask(
    { file: f, code },
    Object.fromEntries(Object.entries(JUDGES).map(([id, j]) => [id, j.q])),
  );
  const hits = [];
  for (const [id, j] of Object.entries(JUDGES)) {
    const p = answers[id].probability;
    if (p >= j.threshold) hits.push(`${id} ${pct(p)}`);
  }
  if (hits.length) flag(`${f}: ${hits.join(", ")}`);
  else console.log(`  ✓ ${f}`);
}

// --- route classifier (gated at 0.6; unclear -> human) ---
const d = diff(range).slice(0, 12_000);
if (d.trim()) {
  const a = await ask({ diff: d }, { route: ROUTE.q });
  const c = a.route.choice,
    conf = a.route.probabilities[c];
  if (conf >= ROUTE.minConfidence) console.log(`\n  route: look first at ${c} (${pct(conf)})`);
  else console.log(`\n  route: unclear (${c} only ${pct(conf)}) — read it yourself`);
}

// --- overclaim (commit message vs diff) ---
const msg = message(range);
if (msg && d.trim()) {
  const a = await ask({ message: msg, diff: d }, { overclaim: OVERCLAIM.q });
  const p = a.overclaim.probability;
  if (p >= OVERCLAIM.threshold)
    flag(`commit message overclaims (${pct(p)}) — check message vs diff`);
}

console.log(`\njev review: ${flags} flag(s). Advisory only — the gate and the lead decide.`);
process.exit(strict && flags ? 2 : 0);
