import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { parseSync } = createRequire(new URL("../tools/jev/package.json", import.meta.url))(
  "oxc-parser",
);
const skipped = /(^|\/)(node_modules|dist)(\/|$)|\.d\.ts$/;
const targets = process.argv.slice(2);
const folders = targets.length ? targets : ["examples"];
const files = folders.flatMap((folder) =>
  globSync(`${folder}/**/*.{ts,tsx}`, { exclude: (path) => skipped.test(path) }),
);

function walk(node, visit) {
  if (node === null || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else walk(value, visit);
  }
}

let failures = 0;
for (const file of new Set(files)) {
  const source = readFileSync(file, "utf8");
  const { program, errors } = parseSync(file, source, { sourceType: "module" });
  if (errors.length) {
    console.error(`${file}: could not parse TypeScript`);
    failures += 1;
    continue;
  }
  walk(program, (node) => {
    if (!["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression"].includes(node.type)) return;
    const line = source.slice(0, node.start).split("\n").length;
    console.error(`${file}:${line}: ${node.type}`);
    failures += 1;
  });
}

console.log(`Example casts: ${failures} in ${files.length} TypeScript files`);
process.exitCode = failures ? 1 : 0;
