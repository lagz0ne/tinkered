// Fail if the built entry's gzip size exceeds the budget. Run from a package dir.
//   node ../../scripts/check-size.mjs <capBytes> [file|dir]
// A directory sums every `.mjs` in it: a package with two entries (`index` + `main`)
// keeps its code in a shared chunk, so the entry alone would measure a stub.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const cap = Number(process.argv[2] ?? 30720);
const target = process.argv[3] ?? "dist/index.mjs";
const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((name) => name.endsWith(".mjs"))
      .map((name) => join(target, name))
  : [target];
const gz = files.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0);
console.log(`size: ${gz} B gzip (cap ${cap} B) — ${files.join(" + ")}`);
if (gz > cap) {
  console.error(`SIZE BUDGET EXCEEDED by ${gz - cap} B`);
  process.exit(1);
}
