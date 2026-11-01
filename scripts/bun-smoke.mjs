import assert from "node:assert/strict";

import { createScope, data } from "../packages/core/dist/index.mjs";
import * as react from "../packages/react/dist/index.mjs";

/** The built Core and React run on Bun: a scope starts, reads a cell, and closes. */
const bun = process.versions.bun;
assert.ok(bun, "run this with bun: bun scripts/bun-smoke.mjs");

const count = data({ label: "count", initial: 41 });
const scope = createScope();
await scope.ready;
assert.equal(scope.resolve(count), 41);

await scope.close();
assert.equal(typeof react.useData, "function");
assert.equal(typeof react.ScopeProvider, "function");

console.log(`PASS: Bun ${bun} runs the built Core and React; a scope read 41 and closed.`);
