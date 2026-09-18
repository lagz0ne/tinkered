// Eval: can the toolcall trim keep what a READING INTENTION needs and drop the rest?
//
// Each case is a reading intention plus the fragments a tool call returned, every
// fragment hand-labeled keep (signal for that intention) or drop (noise). We ask Jev
// the SAME noise question the trim uses (scripts/jev/toolcall.mjs `after`), one call
// per case, and measure:
//   - accuracy at the trim's drop bar (>= 0.75 -> drop)
//   - SEPARATION = lowest noise-prob among true-noise MINUS highest among true-signal.
//     Positive and large means the trim can tell them apart; near zero / negative means
//     it cannot, so the trim must stay conservative (drop nothing) — no promise, nothing
//     lost, the full dump is always saved. This is the number to move when tuning wording.
//
// Advisory only, like the rest of scripts/jev/. Run:  node scripts/jev/evals/reading-intention.mjs
import { loadKey, ask, pct } from "../lib.mjs";

// The trim's question, kept in sync with toolcall.mjs `after`. Tune HERE and re-run.
const NOISE_Q = {
  type: "boolean",
  instructions:
    "Is this fragment NOISE for the goal — boilerplate, unrelated, or redundant — so dropping it loses nothing needed to verify the goal?",
  criteria: {
    true: "irrelevant to the goal; safe to drop",
    false: "relevant — carries a fact, number, path, or error the goal needs",
  },
};
const DROP_BAR = 0.75;

// keep = signal the intention needs; drop = noise safe to trim.
const CASES = [
  {
    name: "read auth file for the null-session source",
    intention: "Find where a null session comes from in the auth module",
    fragments: [
      { keep: false, text: "// Copyright 2026 tinkered. Licensed under MIT.\n// See LICENSE." },
      { keep: false, text: 'import { z } from "zod";\nimport { clock } from "../clock.ts";' },
      {
        keep: true,
        text: "export function createSession(user) {\n  if (!user) return null; // <- returns null session\n  return { id: user.id, at: clock.now() };\n}",
      },
      { keep: false, text: "export function formatName(u) {\n  return `${u.first} ${u.last}`;\n}" },
    ],
  },
  {
    name: "read test output for the failure",
    intention: "Did the login test pass, and if not, where did it fail?",
    fragments: [
      { keep: false, text: "npm warn deprecated some-pkg@1.2.3: use other-pkg instead" },
      { keep: false, text: "> auth@1.0.0 test\n> vitest run auth\n\nRUN v2.0.0" },
      {
        keep: true,
        text: "FAIL src/auth/session.test.ts > login > returns a session\nAssertionError: expected null to be an object\n  at src/auth/session.ts:42:11",
      },
      { keep: true, text: "Test Files  1 failed\nTests  1 failed (1)" },
      {
        keep: false,
        text: "Fetching dependency tree...\nResolving 428 packages, deduping, linking...",
      },
    ],
  },
  {
    name: "read config for the listen port",
    intention: "What port does the server listen on?",
    fragments: [
      { keep: false, text: 'logLevel: "info"\nprettyLogs: true' },
      { keep: true, text: "server:\n  host: 0.0.0.0\n  port: 8443" },
      { keep: false, text: "cache:\n  ttlSeconds: 300\n  maxEntries: 10000" },
      { keep: false, text: "features:\n  betaSearch: false\n  newHeader: true" },
    ],
  },
  {
    name: "read grep results for the token validator",
    intention: "Find the function that validates the auth token",
    fragments: [
      { keep: false, text: "src/ui/button.tsx:12:  const label = token(theme);" },
      {
        keep: true,
        text: "src/auth/token.ts:44:  export function validateToken(raw) {\nsrc/auth/token.ts:45:    return verify(raw, secret);",
      },
      { keep: false, text: "src/auth/token.test.ts:8:  it('validateToken rejects expired', ...)" },
      { keep: false, text: "docs/glossary.md:20:  token — an opaque bearer string." },
    ],
  },
];

if (!loadKey()) process.exit(0);

const pf = (b) => (b ? "drop" : "keep");
let allNoise = [];
let allSignal = [];
let totalCorrect = 0;
let totalFrags = 0;

console.log(`=== reading-intention trim eval (drop bar ${pct(DROP_BAR)}) ===`);
for (const c of CASES) {
  const questions = Object.fromEntries(c.fragments.map((_, i) => [`c${i}`, NOISE_Q]));
  const a = await ask({ goal: c.intention, fragments: c.fragments.map((f) => f.text) }, questions);
  console.log(`\n# ${c.name}\n  intention: ${c.intention}`);
  let noiseProbs = [];
  let signalProbs = [];
  for (let i = 0; i < c.fragments.length; i++) {
    const f = c.fragments[i];
    const p = a[`c${i}`].probability;
    const predicted = p >= DROP_BAR; // true => drop
    const correct = predicted === !f.keep;
    if (correct) totalCorrect++;
    totalFrags++;
    (f.keep ? signalProbs : noiseProbs).push(p);
    console.log(
      `  [want ${pf(!f.keep)}] ${correct ? "✓" : "✗"} noise=${pct(p)}  :: ${f.text.split("\n")[0].slice(0, 48)}`,
    );
  }
  allNoise.push(...noiseProbs);
  allSignal.push(...signalProbs);
  const sep = Math.min(...noiseProbs) - Math.max(...signalProbs);
  console.log(`  case separation (min-noise − max-signal) = ${pct(sep)}`);
}

const overallSep = Math.min(...allNoise) - Math.max(...allSignal);
const meanSep =
  allNoise.reduce((s, p) => s + p, 0) / allNoise.length -
  allSignal.reduce((s, p) => s + p, 0) / allSignal.length;
console.log(`\n=== overall ===`);
console.log(`  accuracy at ${pct(DROP_BAR)} bar: ${totalCorrect}/${totalFrags}`);
console.log(`  worst-case separation (min-noise − max-signal): ${pct(overallSep)}`);
console.log(`  mean separation (mean-noise − mean-signal):      ${pct(meanSep)}`);
console.log(
  `\n  Read: high mean+worst separation → the trim can discriminate, raise trust.\n` +
    `  Flat/negative → Jev can't tell signal from noise here; keep the bar high, drop nothing, lose nothing.`,
);
