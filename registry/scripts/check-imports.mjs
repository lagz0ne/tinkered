import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const { parseSync } = createRequire(new URL("../../tools/jev/package.json", import.meta.url))(
  "oxc-parser",
);
const contracts = {
  http: { imports: ["@tinker/core"], exports: ["send", "attempt"] },
  hono: {
    imports: ["@tinker/core", "hono", "hono/factory", "hono/http-exception"],
    exports: ["hono", "route", "stream"],
  },
  drizzle: { imports: ["@tinker/core"], exports: ["openTransaction", "createQueryLogger"] },
  process: { imports: ["@tinker/core"], exports: ["run", "main"] },
  harness: { imports: ["@tinker/core"], exports: ["harness", "claudeCode", "codex"] },
  mcp: {
    imports: ["@tinker/core", "@modelcontextprotocol/sdk/server/mcp.js"],
    exports: ["mcp", "expose", "answerTool"],
  },
  sync: { imports: ["@tinker/core"], exports: ["source", "subscribe", "family", "memoryPair"] },
};
for (const [name, contract] of Object.entries(contracts)) {
  const entry = join(process.cwd(), "registry/dist", name, "index.mjs");
  const pending = [entry];
  const seen = new Set();
  for (const path of pending) {
    if (seen.has(path)) continue;
    seen.add(path);
    const { program, errors } = parseSync(path, readFileSync(path, "utf8"));
    assert.equal(errors.length, 0, path);
    for (const node of program.body) {
      if (
        !["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(
          node.type,
        ) ||
        !node.source
      )
        continue;
      const dependency = node.source.value;
      if (dependency.startsWith(".")) pending.push(join(dirname(path), dependency));
      else
        assert.ok(
          contracts[
            relative(join(process.cwd(), "registry/dist"), path).split("/")[0]
          ].imports.includes(dependency),
          `${name}: unexpected static import ${dependency}`,
        );
    }
  }
  const actual = await import(pathToFileURL(entry).href);
  for (const name of contract.exports) assert.ok(actual[name], `${entry}: ${name}`);
  console.log(`PASS ${name}: parsed static imports, shared chunks, and public entry symbols`);
}
