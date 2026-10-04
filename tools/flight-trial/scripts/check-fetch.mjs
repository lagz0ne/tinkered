import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { parseSync } = createRequire(new URL("../../jev/package.json", import.meta.url))(
  "oxc-parser",
);
const argument = process.argv.indexOf("--services");
const directory =
  argument === -1
    ? resolve(import.meta.dirname, "../services")
    : resolve(process.argv[argument + 1]);
const forbidden = [];
let checked = 0;

function isPropertyName(node, parent) {
  if (!parent || parent.computed) return false;
  return (
    (parent.type === "MemberExpression" && parent.property === node) ||
    (parent.type === "Property" && parent.key === node)
  );
}

function isFetch(node, parent) {
  if (
    node.type === "MemberExpression" &&
    ["globalThis", "window", "self"].includes(node.object.name) &&
    (node.computed ? node.property.value : node.property.name) === "fetch"
  )
    return true;
  return node.type === "Identifier" && node.name === "fetch" && !isPropertyName(node, parent);
}

function usesFetch(node, parent) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => usesFetch(child, parent));
  if (isFetch(node, parent)) return true;
  return Object.values(node).some((child) => usesFetch(child, node));
}

async function check(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = relative + entry.name;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await check(path, `${name}/`);
      continue;
    }
    if (!name.endsWith(".ts") || name === "http-client.ts") continue;
    const source = await readFile(path, "utf8");
    const parsed = parseSync(path, source);
    if (parsed.errors.length) throw new Error(`Cannot parse ${name}`);
    if (usesFetch(parsed.program))
      forbidden.push(`${name}: built-in fetch must use httpRequest.controller`);
    checked++;
  }
}

await check(directory);
if (forbidden.length) {
  console.error(forbidden.join("\n"));
  process.exit(1);
}
console.log(`Fetch check: ${checked} service files; built-in fetch only in http-client.ts.`);
