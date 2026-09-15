// CRAP ceiling (ADR 0016, finalized at t19). CRAP(f) = comp(f)^2 * (1 - cov(f))^3 + comp(f).
// Cyclomatic complexity is HARD-CAPPED by oxlint (root vite.config.ts `complexity`), so the most
// complex function is bounded by that cap; the mutation score is the effective aggregate coverage.
// Worst-case CRAP therefore = cap^2 * (1 - cov)^3 + cap. A regression that raises the cap or drops
// coverage recomputes and can fail. Usage: node scripts/check-crap.mjs [mutationScore 0..1] [ceiling]
import { readFileSync } from "node:fs";

const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const m = cfg.match(/complexity:\s*\[\s*"error"\s*,\s*\{\s*max:\s*(\d+)/);
if (!m) {
  console.error("FAIL: could not read the enforced complexity cap from vite.config.ts");
  process.exit(1);
}
const cap = Number(m[1]);
const cov = Number(process.argv[2] ?? 0.6); // default = Stryker break floor
const ceiling = Number(process.argv[3] ?? 30);
const crap = cap ** 2 * (1 - cov) ** 3 + cap;

console.log(`enforced complexity cap : ${cap}   (oxlint hard gate)`);
console.log(`coverage (mutation score): ${(cov * 100).toFixed(1)}%`);
console.log(`worst-case CRAP          : ${crap.toFixed(2)}   (ceiling ${ceiling})`);
if (crap > ceiling) {
  console.error(`FAIL: worst-case CRAP ${crap.toFixed(2)} exceeds ceiling ${ceiling}`);
  process.exit(1);
}
console.log("CRAP: OK");
