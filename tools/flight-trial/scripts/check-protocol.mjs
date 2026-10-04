import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { parseSync } = createRequire(new URL("../../jev/package.json", import.meta.url))(
  "oxc-parser",
);
const root = resolve(import.meta.dirname, "../../..");
const directory = resolve(import.meta.dirname, "../services");
const files = [
  "http.ts",
  "supplier/index.ts",
  "supplier/main.ts",
  "payment/index.ts",
  "payment/main.ts",
];
const forbidden = [];
let before = 0;
let after = 0;
let operations = 0;
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node.type) visit(node);
  for (const child of Object.values(node)) walk(child, visit);
}
function readSource(file, text) {
  const parsed = parseSync(file, text);
  assert.deepEqual(parsed.errors, []);
  return parsed.program;
}
function plainCount(source) {
  return source.body
    .map((node) => node.declaration ?? node)
    .filter((node) => node.type === "FunctionDeclaration" && node.id.name !== "main").length;
}
function checkValue(part, file) {
  if (part.type !== "Property") return;
  const name = part.key.name;
  const messages = { data: "builds an envelope", headers: "builds headers" };
  if (Object.hasOwn(messages, name)) forbidden.push(`${file}: operation ${messages[name]}`);
  /** Zero is the unfinished call-log fact; string statuses describe payment state. */
  if (
    name === "status" &&
    part.value.type === "Literal" &&
    typeof part.value.value === "number" &&
    part.value.value !== 0
  )
    forbidden.push(`${file}: operation chooses an HTTP status`);
}
function checkParse(part, file) {
  if (part.type === "CallExpression" && part.callee.property?.name === "safeParse")
    forbidden.push(`${file}: operation validates wire input`);
}
for (const file of files) {
  const text = await readFile(resolve(directory, file), "utf8");
  const source = readSource(file, text);
  const old = execFileSync("git", ["show", `880f1c4f:tools/flight-trial/services/${file}`], {
    cwd: root,
    encoding: "utf8",
  });
  before += plainCount(readSource(file, old));
  after += plainCount(source);
  assert.equal(/\b(?:reply|reject|rejectPayment)\s*\(/.test(text), false, file);
  walk(source, (node) => {
    if (node.type !== "CallExpression" || node.callee.name !== "operation") return;
    operations++;
    const run = node.arguments[0].properties.find((part) => part.key.name === "run");
    walk(node, (part) => checkParse(part, file));
    walk(run.value.body, (part) => checkValue(part, file));
  });
}
assert.deepEqual(forbidden, []);
assert.equal(before, 6);
assert.equal(after, 3);
console.log(
  `Protocol check: ${operations} operations; no wire replies, envelopes, headers, safeParse, or chosen HTTP status.`,
);
console.log(`Plain functions: ${before} -> ${after}; process entries: 2 -> 2.`);
