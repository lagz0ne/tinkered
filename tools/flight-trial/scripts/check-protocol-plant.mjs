import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(import.meta.dirname, "../services");
const temporary = await mkdtemp(resolve(import.meta.dirname, "logs/protocol-plant-"));
const checker = resolve(import.meta.dirname, "check-protocol.mjs");
const cases = [
  {
    file: "supplier/index.ts",
    from: 'raise("UnknownOrder"',
    to: 'raise("UnmappedSupplier"',
    message: "UnmappedSupplier is missing from supplier's error map",
  },
  {
    file: "payment/index.ts",
    from: 'raise("ResourceMissing"',
    to: 'raise("UnmappedPayment"',
    message: "UnmappedPayment is missing from payment's error map",
  },
  {
    file: "http.ts",
    from: 'raise("ServiceStopped"',
    to: 'raise("UnmappedShared"',
    message: "UnmappedShared is missing from supplier's error map",
    also: "UnmappedShared is missing from payment's error map",
  },
  {
    file: "http.ts",
    from: 'raise("ServiceStopped"',
    to: "raise(input.kind",
    message: "raises a kind that cannot be checked statically",
  },
  {
    file: "supplier/index.ts",
    append: "\nconst plantedArrow = () => 1;\n",
    message: "plain function budget",
  },
  {
    file: "payment/index.ts",
    append: "\nexport const plantedFunction = function () { return 1; };\n",
    message: "plain function budget",
  },
];
try {
  await cp(directory, temporary, { recursive: true });
  for (const planted of cases) {
    const path = resolve(temporary, planted.file);
    const original = await readFile(resolve(directory, planted.file), "utf8");
    if (planted.from) assert.ok(original.includes(planted.from));
    const changed = planted.append
      ? original + planted.append
      : original.replace(planted.from, planted.to);
    await writeFile(path, changed);
    const result = spawnSync(process.execPath, [checker, "--services", temporary], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.error?.message ?? result.stdout + result.stderr);
    assert.ok(result.stderr.includes(planted.message), result.stderr);
    if (planted.also) assert.ok(result.stderr.includes(planted.also), result.stderr);
    console.log(`Planted ${planted.message}: exit ${result.status} (expected).`);
    await writeFile(path, original);
  }
  const clean = spawnSync(process.execPath, [checker, "--services", temporary], {
    encoding: "utf8",
  });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  console.log(clean.stdout.trim());
  console.log(`Protocol planted proof: ${cases.length} rejected; unchanged copy passes.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
