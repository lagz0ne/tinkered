import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { parseSync } = createRequire(new URL("../../jev/package.json", import.meta.url))(
  "oxc-parser",
);
const root = resolve(import.meta.dirname, "../../..");
const suppliedDirectory = process.argv.indexOf("--services");
const directory =
  suppliedDirectory === -1
    ? resolve(import.meta.dirname, "../services")
    : resolve(process.argv[suppliedDirectory + 1]);
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
  let count = 0;
  for (const statement of source.body) {
    const node = statement.declaration ?? statement;
    if (node.type === "FunctionDeclaration" && node.id.name !== "main") count++;
    if (node.type !== "VariableDeclaration") continue;
    count += node.declarations.filter((part) =>
      ["ArrowFunctionExpression", "FunctionExpression"].includes(part.init?.type),
    ).length;
  }
  return count;
}
function readTable(source, name, common) {
  const declarations = source.body.flatMap((node) => (node.declaration ?? node).declarations ?? []);
  const table = declarations.find((node) => node.id.name === name)?.init;
  assert.equal(table?.type, "ObjectExpression", `${name}: expected a literal error table`);
  const kinds = new Set();
  for (const part of table.properties) {
    if (part.type === "SpreadElement") {
      assert.equal(part.argument.name, "commonErrors", `${name}: unknown error table spread`);
      assert.ok(common, `${name}: missing shared error table`);
      for (const kind of common) kinds.add(kind);
      continue;
    }
    assert.equal(part.computed, false, `${name}: computed error kind`);
    kinds.add(part.key.name ?? part.key.value);
  }
  return kinds;
}
function checkRaised(kind, file, maps) {
  if (kind?.type !== "Literal" || typeof kind.value !== "string") {
    forbidden.push(`${file}: operation raises a kind that cannot be checked statically`);
    return;
  }
  for (const [service, kinds] of maps)
    if (!kinds.has(kind.value))
      forbidden.push(`${file}: raised kind ${kind.value} is missing from ${service}'s error map`);
}
const sources = new Map();
for (const file of files)
  sources.set(file, readSource(file, await readFile(resolve(directory, file), "utf8")));
const common = readTable(sources.get("http.ts"), "commonErrors");
const maps = new Map();
for (const service of ["supplier", "payment"]) {
  const source = sources.get(`${service}/index.ts`);
  maps.set(service, readTable(source, "errors", common));
  let bindings = 0;
  walk(source, (node) => {
    if (node.type !== "CallExpression" || node.callee.name !== "wireErrors") return;
    assert.equal(node.arguments[0]?.name, "errors", `${service}: error table is not bound`);
    bindings++;
  });
  assert.equal(bindings, 1, `${service}: expected one bound error table`);
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
  const source = sources.get(file);
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
    const applicable =
      file === "http.ts" ? maps : [[file.split("/")[0], maps.get(file.split("/")[0])]];
    walk(node, (part) => {
      if (part.type === "CallExpression" && part.callee.property?.name === "raise")
        checkRaised(part.arguments[0], file, applicable);
    });
  });
}
assert.deepEqual(forbidden, []);
assert.equal(before, 6);
assert.equal(after, 3, "plain function budget");
console.log(
  `Protocol check: ${operations} operations; every raised kind is mapped; no wire replies, envelopes, headers, safeParse, or chosen HTTP status.`,
);
console.log(`Plain functions: ${before} -> ${after}; process entries: 2 -> 2.`);
