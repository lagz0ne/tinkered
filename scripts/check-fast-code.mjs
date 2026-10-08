import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import {
  hotFunctions,
  highestSlot,
  closures,
  builtNames,
  bytecodeLength,
  inlinedInto,
  clientLibraries,
  ratchet,
  rebaselineEngine,
} from "./fast-code-parsers.mjs";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "rebaseline-engine": { type: "boolean", default: false },
    baseline: { type: "string", default: "scripts/fast-code-baseline.json" },
    "core-bundle": { type: "string", default: "packages/core/dist/index.mjs" },
    "core-source": { type: "string", default: "packages/core/src/index.ts" },
    "client-dir": { type: "string" },
  },
});
const baseline = JSON.parse(readFileSync(values.baseline, "utf8"));
const bundle = resolve(values["core-bundle"]);
const driver = resolve("scripts/fast-code-driver.mjs");
const deadline = performance.now() + 55_000;
const read = (file) => readFileSync(file, "utf8");

function command(file, args, cwd = process.cwd()) {
  const result = spawnSync(file, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: Math.max(1, Math.floor(deadline - performance.now())),
  });
  if (result.error || result.status !== 0)
    throw new Error(`${file} failed: ${result.error?.message ?? result.stderr.slice(-2000)}`);
  return result.stdout;
}

function engine() {
  if (process.version !== baseline.node || process.versions.v8 !== baseline.v8)
    throw new Error(
      `Engine changed: ${process.version} / ${process.versions.v8}; run: node scripts/check-fast-code.mjs --rebaseline-engine`,
    );
}

function names() {
  return builtNames(read(bundle), JSON.parse(read(`${bundle}.map`)));
}

function slotCheck() {
  const actual = {
    core: highestSlot(read(bundle)),
    react: highestSlot(read("packages/react/dist/index.mjs")),
  };
  for (const [name, value] of Object.entries(actual))
    ratchet(`F9 ${name}`, value, baseline.slots[name]);
  return actual;
}

function measureBytecode() {
  const emitted = names();
  const actual = {};
  for (const name of hotFunctions) {
    const trace = command(process.execPath, [
      "--print-bytecode",
      `--print-bytecode-filter=${emitted[name]}`,
      driver,
      bundle,
    ]);
    actual[name] = bytecodeLength(trace, emitted[name]);
  }
  return actual;
}

function measureInlining() {
  const options = command(process.execPath, ["--v8-options"]);
  if (!/default: --maglev\s/.test(options)) throw new Error("Default Maglev is off");
  const emitted = names();
  const trace = command(process.execPath, ["--trace-turbo-inlining", driver, bundle, "200000"]);
  const actual = inlinedInto(trace, emitted.OperationCtx, emitted.runOnce);
  return actual;
}

function bytecodeCheck() {
  engine();
  const actual = measureBytecode();
  for (const name of hotFunctions) ratchet(`F1 ${name}`, actual[name], baseline.bytecode[name]);
  return actual;
}

function inlineCheck() {
  engine();
  const actual = measureInlining();
  if (!actual || actual !== baseline.inlining.OperationCtxIntoRunOnce)
    throw new Error("F1/F2 OperationCtx was not inlined into runOnce with default Maglev");
  return { OperationCtxIntoRunOnce: actual, maglev: "default on" };
}

function rewriteEngineBaseline() {
  const bytecode = measureBytecode();
  const inlining = measureInlining();
  const next = rebaselineEngine(
    baseline,
    { node: process.version, v8: process.versions.v8 },
    bytecode,
    inlining,
  );
  writeFileSync(values.baseline, JSON.stringify(next, null, 2) + "\n");
  console.log(`Node: ${baseline.node} → ${next.node}`);
  console.log(`V8: ${baseline.v8} → ${next.v8}`);
  for (const name of hotFunctions)
    console.log(`${name}: ${baseline.bytecode[name]} → ${next.bytecode[name]}`);
  console.log("OperationCtxIntoRunOnce: true → true");
}

function closureCheck() {
  const actual = closures(read(values["core-source"]));
  for (const name of hotFunctions) ratchet(`F6 ${name}`, actual[name], baseline.closures[name]);
  return actual;
}

function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

function librariesInChunk(chunk) {
  const map = JSON.parse(read(`${chunk}.map`));
  if (!map.mappings || !map.sources.length)
    throw new Error(`F13 missing source evidence for ${chunk}`);
  return clientLibraries(map);
}

function clientCheck() {
  if (!values["client-dir"])
    command("vp", ["build", "--sourcemap", "hidden"], resolve("apps/start-min"));
  const dir = values["client-dir"] ?? "apps/start-min/dist/client";
  const chunks = filesIn(dir).filter((file) => file.endsWith(".js"));
  if (!chunks.length) throw new Error("F13 no built client chunks found");
  const actual = { zod: 0, drizzle: 0, pglite: 0 };
  for (const chunk of chunks) for (const library of librariesInChunk(chunk)) actual[library]++;
  for (const [library, count] of Object.entries(actual))
    ratchet(`F13 ${library} chunks`, count, baseline.client[library]);
  return { ...actual, chunks: chunks.length };
}

const checks = {
  slots: slotCheck,
  bytecode: bytecodeCheck,
  inlining: inlineCheck,
  closures: closureCheck,
  client: clientCheck,
};
if (values.only && !checks[values.only]) throw new Error(`Unknown check ${values.only}`);
let failed = 0;
for (const [name, check] of Object.entries(checks)) {
  if (values["rebaseline-engine"]) continue;
  if (values.only && name !== values.only) continue;
  const start = performance.now();
  try {
    const actual = check();
    console.log(
      JSON.stringify({
        check: name,
        status: "PASS",
        actual,
        milliseconds: Math.round(performance.now() - start),
      }),
    );
  } catch (error) {
    failed++;
    console.log(
      JSON.stringify({
        check: name,
        status: "FAIL",
        error: error.message,
        milliseconds: Math.round(performance.now() - start),
      }),
    );
  }
}
if (values["rebaseline-engine"]) {
  try {
    rewriteEngineBaseline();
  } catch (error) {
    failed++;
    console.error(`Engine baseline unchanged: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
