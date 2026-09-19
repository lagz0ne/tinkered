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
  // @tinker/hono (ADR 0039/0040, hono-v1 t04): same promises; `hono` is a peer import, `node:` is not.
  ["hono tests", `${VP} run --no-cache hono#test`],
  ["hono size (<= 10 kB gzip)", `${VP} run --no-cache hono#size`],
  [
    "hono cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" examples/hono | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "hono pure universal bundle",
    `bash -c 'grep -qE "from \\"node:" packages/hono/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/hono/dist/index.mjs\\").then(m=>process.exit(m.tinker&&m.handle&&m.stream?0:1))"'`,
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
  // @tinker/cli (ADR 0042, cli-v1 t02): same promises; `run` never touches the process, so dist stays pure.
  ["cli tests", `${VP} run --no-cache cli#test`],
  ["cli size (<= 10 kB gzip)", `${VP} run --no-cache cli#size`],
  [
    "cli cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\\\bas [A-Za-z{(]|\\\\bas unknown|[a-zA-Z0-9_)\\\\]]!" examples/cli | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "cli pure universal bundle",
    `bash -c 'grep -qE "from \\"node:" packages/cli/dist/index.mjs && exit 1 || node --input-type=module -e "import(\\"./packages/cli/dist/index.mjs\\").then(m=>process.exit(m.run&&m.runMain&&m.command?0:1))"'`,
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
    `bash -c 'grep -qE "from \\"(node:|zod)" packages/mcp/dist/index.mjs && exit 1; grep -E "from \\"@modelcontextprotocol/sdk/" packages/mcp/dist/index.mjs | grep -v "server/mcp.js" | grep -q . && exit 1 || node --input-type=module -e "import(\\"./packages/mcp/dist/index.mjs\\").then(m=>process.exit(m.mcpServer&&m.tool&&m.tools&&m.readTool&&m.answerTool?0:1))"'`,
  ],
  // @tinker/sync (ADR 0048, sync-v1 t04): same promises; the transport is
  // userland's, so dist imports only @tinker/core at runtime.
  ["sync tests", `${VP} run --no-cache sync#test`],
  ["sync size (<= 10 kB gzip)", `${VP} run --no-cache sync#size`],
  [
    "sync cast-free examples (0 casts)",
    `bash -c 'test $(grep -rcE "\\bas [A-Za-z{(]|\\bas unknown|[a-zA-Z0-9_)\\]]!" examples/sync | awk -F: "{s+=\\$2} END{print s+0}") -eq 0'`,
  ],
  [
    "sync pure bundle (runtime import: @tinker/core only)",
    `bash -c 'grep -oE "from \\"[^\\"]+\\"" packages/sync/dist/index.mjs | sort -u | grep -v "from \\"@tinker/core\\"" | grep -q . && exit 1 || node --input-type=module -e "import(\\"./packages/sync/dist/index.mjs\\").then(m=>process.exit(m.syncServer&&m.syncClient&&m.family&&m.memoryPair?0:1))"'`,
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
  `\nMutation lanes: run \`${VP} run --no-cache core#mutate\` and \`${VP} run --no-cache http#mutate\` and \`${VP} run --no-cache hono#mutate\` and \`${VP} run --no-cache drizzle#mutate\` and \`${VP} run --no-cache cli#mutate\` and \`${VP} run --no-cache harness#mutate\` and \`${VP} run --no-cache mcp#mutate\` and \`${VP} run --no-cache sync#mutate\` ALONE (break >= 60; core ~78%, http ~70%, hono ~80%, drizzle ~96%, cli ~72%, harness ~70%, mcp ~81%, sync ~78%).`,
);
console.log(
  `Timing lanes:  run via \`bench -- ${strip} bench/<lane>.mjs\` in a clean worktree (not in-container).`,
);
console.log(
  failed ? `\n${failed} lane(s) FAILED` : `\nAll deterministic budget lanes PASS (${lanes.length})`,
);
process.exit(failed ? 1 : 0);
