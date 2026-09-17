// t19 release gate (ADR 0016): run every DETERMINISTIC budget lane and report. Wall-clock lanes
// (timing) run separately via `bench` in a sandbox; heap is a memory delta and runs here.
import { execSync } from "node:child_process";

const VP = "/home/paseo/.local/vp/bin/vp";
const strip = "node --experimental-strip-types";
const lanes = [
  ["lint/types/format/complexity", `${VP} check`],
  ["tests", `${VP} run --no-cache core#test`],
  ["size (<= 30 kB gzip)", `${VP} run --no-cache core#size`],
  ["promises (0 sync / <=10 async)", `${strip} bench/promises.mjs`],
  ["deep-chain (no overflow)", `${strip} bench/deep.mjs`],
  ["live-heap-per-request", `node --expose-gc --experimental-strip-types bench/heap.mjs`],
  ["CRAP ceiling", `node scripts/check-crap.mjs ${process.argv[2] ?? 0.6}`],
  [
    "cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" packages/core/examples | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "both entries (pure universal bundle)",
    `bash -c 'grep -qE "^import|from \\"node:" packages/core/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/core/dist/index.mjs\\").then(m=>process.exit(m.createScope?0:1))"'`,
  ],
  // @tinker/http (ADR 0035, http-v1 t05): the same three deterministic promises for the frame.
  ["http tests", `${VP} run --no-cache http#test`],
  ["http size (<= 10 kB gzip)", `${VP} run --no-cache http#size`],
  [
    "http cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" packages/http/examples | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "http pure universal bundle",
    `bash -c 'grep -qE "from \\"node:" packages/http/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/http/dist/index.mjs\\").then(m=>process.exit(m.httpClient?0:1))"'`,
  ],
];

let failed = 0;
for (const [name, cmd] of lanes) {
  try {
    execSync(cmd, { stdio: "pipe", cwd: process.cwd() });
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}`);
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`
      .toString()
      .trim()
      .split("\n")
      .slice(-3)
      .join("\n");
    if (out) console.log(out.replace(/^/gm, "        "));
  }
}
console.log(
  `\nMutation lanes: run \`${VP} run --no-cache core#mutate\` and \`${VP} run --no-cache http#mutate\` ALONE (break >= 60; core ~78%, http ~70%).`,
);
console.log(
  `Timing lanes:  run via \`bench -- ${strip} bench/<lane>.mjs\` in a clean worktree (not in-container).`,
);
console.log(failed ? `\n${failed} lane(s) FAILED` : `\nAll deterministic budget lanes PASS`);
process.exit(failed ? 1 : 0);
