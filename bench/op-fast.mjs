import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, scenario = "settle", count] = process.argv.slice(2);
const { createScope, data, operation, resource } = await import(
  pathToFileURL(resolve(dist, "index.mjs")).href
);
const iterations = Number(count ?? (scenario === "close" ? 100_000 : 2_000_000));
let sum = 0;
if (scenario === "settle") {
  const cell = data({ label: "cfg", initial: 21 });
  const op = operation({ label: "op", depends: { cell }, run: ({ cell }) => cell + 1 });
  const root = createScope();
  for (let i = 0; i < iterations; i++) {
    const result = root.settle(op);
    assert.equal(result.status, "success");
    sum += result.value;
  }
  assert.equal(sum, iterations * 22);
  assert.equal((await root.close({ graceful: true })).status, "success");
} else {
  assert.equal(scenario, "close");
  const owned = resource({
    label: "db",
    factory: (_deps, { defer }) => {
      defer(() => {});
      return 1;
    },
  });
  const op = operation({ label: "use-db", depends: { owned }, run: ({ owned }) => owned });
  for (let i = 0; i < iterations; i++) {
    const root = createScope();
    sum += root.run(op);
    assert.equal((await root.close()).status, "cancelled");
  }
  assert.equal(sum, iterations);
}
