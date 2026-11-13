import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const requireCore = createRequire(new URL("../packages/core/package.json", import.meta.url));
const requireJev = createRequire(new URL("../tools/jev/package.json", import.meta.url));
const { parseSync } = requireJev("oxc-parser");
const mainPath = requireCore.resolve("@tinkered/core");
const testingPath = requireCore.resolve("@tinkered/core/testing");
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

const gzipOf = (url) => gzipSync(readFileSync(new URL(url))).length;
const runtimeSize = [...visited].reduce((size, url) => size + gzipOf(url), 0);

// ADR 0130: rpc, remoteData and the protocol joined Core in their own chunk. The package says it
// has no side effects, so an app that uses neither drops that chunk: the core cap stays as it was.
const corePkg = JSON.parse(readFileSync(new URL("../packages/core/package.json", import.meta.url)));

assert.equal(
  corePkg.sideEffects,
  false,
  "core must say it has no side effects, so rpc tree-shakes",
);

const rpcChunks = [...visited].filter((url) => /\/rpc-[\w-]+\.mjs$/.test(url));
assert.equal(rpcChunks.length, 1, "rpc and remoteData must sit in one chunk of their own");

const coreSize = runtimeSize - gzipOf(rpcChunks[0]);
// Keyed data (ADR 0135 to 0138) raised the core cap by 1 KiB: a second mode of `data`.
// derived (ADR 0150) raised it by 1 KiB more (Duke 2026-11-13).
// A slot that arrives as its value (ADR 0151) raised it by 288 B (Duke 2026-11-13: "Can increase a little bit"; +32 B keeps the op run path free of the slot check).
const coreCap = 22816;
// Keyed remote data raised the full cap by 2 KiB: k03 (parts, asks, rooting) and k05 (load).
// The run event's `is` and `input` (ADR 0142) found it 1 byte under, and raised it by 1 KiB.
// derived (ADR 0150) raised this cap by 1 KiB too.
const runtimeCap = 34816;
assert.ok(coreSize <= coreCap, `core runtime without rpc exceeds ${coreCap} B gzip: ${coreSize} B`);
assert.ok(runtimeSize <= runtimeCap, `core runtime exceeds ${runtimeCap} B gzip: ${runtimeSize} B`);
console.log(`core runtime size: ${coreSize} B gzip without rpc (cap ${coreCap} B)`);
console.log(`core runtime size: ${runtimeSize} B gzip with rpc (cap ${runtimeCap} B)`);

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
