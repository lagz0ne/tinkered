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
  // The graph produces the trace (ADR 0058): no hand-rolled span outside core, and a package
  // that declares operations ships a span-tree test.
  ["graph (span-tree per package, no hand-rolled span)", `${strip} scripts/check-graph.mjs`],
  // Ambient time/random (ADR 0034, 0062): read "now" and randomness off ctx, never a hidden
  // global; only the systemClock/systemRandom source lines are marked `ambient-source`.
  ["ambient reads off ctx (no bare time/random)", `node scripts/check-ambient.mjs`],
  [
    "cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" examples/core | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
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
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" examples/http | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "http pure universal bundle",
    `bash -c 'grep -qE "from \\"node:" packages/http/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/http/dist/index.mjs\\").then(m=>process.exit(m.httpClient?0:1))"'`,
  ],
  // @tinker/hono (ADR 0039/0040/0051, drivers t03): same promises; `hono` is a peer import, `node:` is not.
  ["hono tests", `${VP} run --no-cache hono#test`],
  ["hono size (<= 10 kB gzip)", `${VP} run --no-cache hono#size`],
  [
    "hono cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" examples/hono | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "hono pure universal bundle",
    `bash -c 'grep -qE "from \\"node:" packages/hono/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/hono/dist/index.mjs\\").then(m=>process.exit(m.hono&&m.route&&m.stream?0:1))"'`,
  ],
  // @tinker/drizzle (ADR 0041, drizzle-v1 t02): same promises; drizzle-orm is types-only at runtime.
  ["drizzle tests", `${VP} run --no-cache drizzle#test`],
  ["drizzle size (<= 10 kB gzip)", `${VP} run --no-cache drizzle#size`],
  [
    "drizzle cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" examples/drizzle | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "drizzle pure universal bundle (no node:, no drizzle-orm at runtime)",
    `bash -c 'grep -qE "from \\"node:|drizzle-orm" packages/drizzle/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/drizzle/dist/index.mjs\\").then(m=>process.exit(m.drizzleStore?0:1))"'`,
  ],
  // @tinker/process (ADR 0056): same promises; only `main` touches the process, so dist stays pure.
  ["process tests", `${VP} run --no-cache process#test`],
  ["process size (<= 10 kB gzip)", `${VP} run --no-cache process#size`],
  [
    "process cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" examples/process-cli | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "process pure universal bundle",
    `bash -c 'grep -qE "from \\"node:" packages/process/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/process/dist/index.mjs\\").then(m=>process.exit(m.command&&m.run&&m.main?0:1))"'`,
  ],
  // @tinker/blueprint (ADR 0052, blueprint-v1 t01/t05): the size promise; zod, yaml,
  // and @tinker/* stay out of dist at runtime; the binary ships its corpus and evals.
  ["blueprint tests", `${VP} run --no-cache blueprint#test`],
  ["blueprint size (<= 20 kB gzip)", `${VP} run --no-cache blueprint#size`],
  [
    "blueprint pack lists corpus and evals",
    `bash -c 'cd packages/blueprint && npm pack --dry-run 2>&1 | grep -q "corpus/unitFits.yaml" && npm pack --dry-run 2>&1 | grep -q "evals/golden.yaml"'`,
  ],
  // @tinker/harness (ADR 0043, harness-v1 t05): same promises; the SDKs, zod, and the MCP SDK never reach dist at runtime.
  ["harness tests", `${VP} run --no-cache harness#test`],
  ["harness size (<= 10 kB gzip)", `${VP} run --no-cache harness#size`],
  [
    "harness cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\bas [A-Za-z{(]|\\bas unknown|[a-zA-Z0-9_)\\]]!" examples/harness | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "harness pure universal bundle (SDKs only behind import(); no zod/MCP at runtime)",
    `bash -c 'grep -qE "from \\"(node:|@anthropic-ai/claude-agent-sdk|@openai/codex-sdk|zod|@modelcontextprotocol)" packages/harness/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/harness/dist/index.mjs\\").then(m=>process.exit(m.harness&&m.claudeCode&&m.codex?0:1))"'`,
  ],
  // @tinker/mcp (ADR 0046, mcp-v1 t02): same promises; zod is types-only at runtime,
  // the SDK reaches dist only through server/mcp.js.
  ["mcp tests", `${VP} run --no-cache mcp#test`],
  ["mcp size (<= 10 kB gzip)", `${VP} run --no-cache mcp#size`],
  [
    "mcp cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\bas [A-Za-z{(]|\\bas unknown|[a-zA-Z0-9_)\\]]!" examples/mcp | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "mcp pure bundle (runtime imports: @tinker/core + the SDK's server/mcp.js only)",
    `bash -c 'grep -qE "from \\"(node:|zod)" packages/mcp/dist/index.mjs && exit 1; grep -E "from \\"@modelcontextprotocol/sdk/" packages/mcp/dist/index.mjs | grep -v "server/mcp.js" | grep -q . && exit 1 || node --input-type=module -e "import(\\"./packages/mcp/dist/index.mjs\\").then(m=>process.exit(m.mcp&&m.expose&&m.tool&&m.readTool&&m.answerTool?0:1))"'`,
  ],
  // @tinker/sync (ADR 0048, sync-v1 t05): same promises; the transport is
  // userland's, so dist imports only @tinker/core at runtime.
  ["sync tests", `${VP} run --no-cache sync#test`],
  ["sync size (<= 10 kB gzip)", `${VP} run --no-cache sync#size`],
  [
    "sync cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\bas [A-Za-z{(]|\\bas unknown|[a-zA-Z0-9_)\\]]!" examples/sync | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "two hands (ADR 0051: Scope.Handle only at a root, in a driver src, or a test)",
    "scripts/two-hands.sh",
  ],
  [
    "sync pure bundle (runtime import: @tinker/core only)",
    `bash -c 'grep -oE "from \\"[^\\"]+\\"" packages/sync/dist/index.mjs | sort -u | grep -v "from \\"@tinker/core\\"" | grep -q . && exit 1 || node --input-type=module -e "import(\\"./packages/sync/dist/index.mjs\\").then(m=>process.exit(m.source&&m.subscribe&&m.family&&m.memoryPair?0:1))"'`,
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
  `\nMutation lanes: run \`${VP} run --no-cache core#mutate\` and \`${VP} run --no-cache http#mutate\` and \`${VP} run --no-cache hono#mutate\` and \`${VP} run --no-cache drizzle#mutate\` and \`${VP} run --no-cache process#mutate\` and \`${VP} run --no-cache harness#mutate\` and \`${VP} run --no-cache mcp#mutate\` and \`${VP} run --no-cache sync#mutate\` ALONE (break >= 75, core and react >= 85; measured alone 2026-09-21: core 86.07, react 93.16; 2026-09-20: http 90.77, hono 77.66, drizzle ~96, process 83.43, harness 76.05, mcp 82.86, sync 79.67).`,
);
console.log(
  `Timing lanes:  run via \`bench -- ${strip} bench/<lane>.mjs\` in a clean worktree (not in-container).`,
);
console.log(
  failed ? `\n${failed} lane(s) FAILED` : `\nAll deterministic budget lanes PASS (${lanes.length})`,
);
process.exit(failed ? 1 : 0);
