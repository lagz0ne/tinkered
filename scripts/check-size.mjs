// Fail if the built entry's gzip size exceeds the budget. Run from a package dir.
//   node ../../scripts/check-size.mjs <capBytes> [file]
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const cap = Number(process.argv[2] ?? 30720);
const file = process.argv[3] ?? "dist/index.mjs";
const gz = gzipSync(readFileSync(file)).length;
console.log(`size: ${gz} B gzip (cap ${cap} B) — ${file}`);
if (gz > cap) {
  console.error(`SIZE BUDGET EXCEEDED by ${gz - cap} B`);
  process.exit(1);
}
