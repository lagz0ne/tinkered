import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { builtNames, parseProgram } from "./fast-code-parsers.mjs";

const read = (file) => readFileSync(file, "utf8");
const root = mkdtempSync(join(tmpdir(), "fast-code-breaks-"));
const original = read("packages/core/dist/index.mjs");
const originalMap = JSON.parse(read("packages/core/dist/index.mjs.map"));
const names = builtNames(original, originalMap);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Shift generated columns after an insertion into the one-line Core bundle. */
function shiftedMap(at, length) {
  assert.equal(originalMap.mappings.includes(";"), false);
  let column = 0;
  let shifted = false;
  const mappings = originalMap.mappings
    .split(",")
    .map((segment) => {
      let end = 0;
      let value = 0;
      let shift = 0;
      let digit;
      do {
        digit = alphabet.indexOf(segment[end++]);
        value += (digit & 31) * 2 ** shift;
        shift += 5;
      } while (digit & 32);
      const delta = value / 2;
      column += delta;
      if (shifted || column < at) return segment;
      shifted = true;
      let encoded = "";
      value = (delta + length) * 2;
      do {
        digit = value & 31;
        value = Math.floor(value / 32);
        encoded += alphabet[digit | (value ? 32 : 0)];
      } while (value);
      return encoded + segment.slice(end);
    })
    .join(",");
  return { ...originalMap, mappings };
}

function bundleWith(name, at, plant) {
  const dir = join(root, name);
  cpSync("packages/core/dist", dir, { recursive: true });
  const file = join(dir, "index.mjs");
  writeFileSync(file, original.slice(0, at) + plant + original.slice(at));
  writeFileSync(`${file}.map`, JSON.stringify(shiftedMap(at, plant.length)));
  return file;
}

function run(check, args) {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-fast-code.mjs", "--only", check, ...args],
    {
      encoding: "utf8",
      timeout: 55_000,
    },
  );
  return { exit: result.status, output: result.stdout.trim(), error: result.stderr.trim() };
}

const proofs = [];
function prove(check, args, expected, plant) {
  const red = run(check, args);
  assert.equal(red.exit, 1, JSON.stringify(red));
  assert.match(red.output, expected);
  const green = run(
    check,
    check === "client" ? ["--client-dir", resolve("apps/start-min/dist/client")] : [],
  );
  assert.equal(green.exit, 0, JSON.stringify(green));
  proofs.push({ check, plant, red, restoredExit: green.exit });
}

try {
  const slotFile = bundleWith(
    "slots",
    original.length,
    "\nconst plantedSlot=1;function plantedRead(){return plantedSlot}",
  );
  prove(
    "slots",
    ["--core-bundle", slotFile],
    /F9 core: \d+ > baseline/,
    "One captured module name appended to a temp bundle",
  );
  const program = parseProgram("bundle.mjs", original);
  const runOnce = program.body.find((node) => node.id?.name === names.runOnce);
  const bytecodeFile = bundleWith(
    "bytecode",
    runOnce.body.start + 1,
    "globalThis.fastCodePlant=1;",
  );
  prove(
    "bytecode",
    ["--core-bundle", bytecodeFile],
    /F1 runOnce: \d+ > baseline/,
    "One global write added to runOnce in a temp bundle",
  );
  const klass = program.body
    .flatMap((node) => node.declarations ?? [])
    .find((node) => node.id.name === names.OperationCtx);
  const ctor = klass.init.body.body.find((node) => node.kind === "constructor");
  const inlineFile = bundleWith(
    "inlining",
    ctor.value.body.start + 1,
    "globalThis.fastCodePlant=1;".repeat(300),
  );
  prove(
    "inlining",
    ["--core-bundle", inlineFile],
    /was not inlined/,
    "300 writes grow the temp constructor beyond the inline limit",
  );
  const source = read("packages/core/src/index.ts");
  const fn = parseProgram("source.ts", source).body.find((node) => node.id?.name === "runOnce");
  const sourceFile = join(root, "source.ts");
  writeFileSync(
    sourceFile,
    source.slice(0, fn.body.start + 1) +
      "const planted = () => 1;" +
      source.slice(fn.body.start + 1),
  );
  prove(
    "closures",
    ["--core-source", sourceFile],
    /F6 runOnce: 1 > baseline 0/,
    "An arrow added inside runOnce in a temp source file",
  );
  const clientDir = join(root, "client");
  cpSync("apps/start-min/dist/client", clientDir, { recursive: true });
  const chunk = join(clientDir, "planted.js");
  writeFileSync(chunk, "export const planted = 1;");
  writeFileSync(
    `${chunk}.map`,
    JSON.stringify({ version: 3, sources: ["node_modules/zod/v4/core.js"], mappings: "AAAA" }),
  );
  prove(
    "client",
    ["--client-dir", clientDir],
    /F13 zod chunks: 1 > baseline 0/,
    "A mapped zod module added to temp client chunks",
  );
  console.log(JSON.stringify({ proofs, tempFilesRemoved: true }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
