import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const requireCore = createRequire(new URL("../packages/core/package.json", import.meta.url));
const requireJev = createRequire(new URL("../tools/jev/package.json", import.meta.url));
const { parseSync } = requireJev("oxc-parser");
const mainPath = requireCore.resolve("@tinker/core");
const testingPath = requireCore.resolve("@tinker/core/testing");
const mainUrl = pathToFileURL(mainPath);
const testingUrl = pathToFileURL(testingPath);
const main = await import(mainUrl.href);
const testing = await import(testingUrl.href);

assert.equal(typeof main.createScope, "function");
for (const name of ["makeTestClock", "makeTestRandom", "preset"]) {
  assert.equal(name in main, false, `${name} must stay out of the main entry`);
  assert.equal(typeof testing[name], "function", `${name} must be in the testing entry`);
}

const visited = new Set();
function checkRuntime(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  assert.notEqual(url.href, testingUrl.href, "the main entry must not load testing");
  const file = fileURLToPath(url);
  const code = readFileSync(file, "utf8");
  const { program } = parseSync(file, code);
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" &&
      statement.type !== "ExportNamedDeclaration" &&
      statement.type !== "ExportAllDeclaration"
    ) {
      continue;
    }
    if (!statement.source) continue;
    const source = statement.source.value;
    assert.ok(source.startsWith("./"), `core runtime import must stay in its package: ${source}`);
    checkRuntime(new URL(source, url));
  }
}
checkRuntime(mainUrl);
const runtimeSize = [...visited].reduce(
  (size, url) => size + gzipSync(readFileSync(new URL(url))).length,
  0,
);
const runtimeCap = 16384;
assert.ok(runtimeSize <= runtimeCap, `core runtime exceeds ${runtimeCap} B gzip: ${runtimeSize} B`);
console.log(`core runtime size: ${runtimeSize} B gzip (cap ${runtimeCap} B; all runtime files)`);

const clock = testing.makeTestClock({ now: 42 });
const cell = main.data({ label: "entry-cell", initial: 0 });
const read = main.operation({
  label: "entry-read",
  depends: { cell },
  run: ({ cell: value }, ctx) => ({ value, time: ctx.clock.currentTimeMillis() }),
});
const scope = main.createScope({ clock, presets: [testing.preset(cell, 7)] });
assert.deepEqual(scope.run(read), { value: 7, time: 42 });
await scope.close();

const step = main.operation({ label: "entry-span", run: () => 1 });
const ids = [];
for (let i = 0; i < 2; i++) {
  const spans = [];
  const root = main.createScope({
    random: testing.makeTestRandom({ seed: 42 }),
    observe: { export: (span) => spans.push([span.traceId, span.spanId]) },
  });
  root.run(step);
  await root.close();
  ids.push(spans);
}
assert.equal(ids[0].length, 1, "the operation must export its span");
assert.deepEqual(ids[0], ids[1], "both entries must share seeded trace state");
console.log("core entries: main loads no testing; all three testing helpers work across entries");
