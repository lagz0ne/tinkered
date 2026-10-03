import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

/** Check every scaffold byte against the image's saved hashes. */
export function checkScaffoldFiles(expected, root = "/work") {
  const directory = join(root, "src/scaffold");
  if (realpathSync(directory) !== directory) throw new Error("scaffold link");
  const found = {};
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`scaffold link ${path}`);
      if (entry.isDirectory()) walk(path);
      else
        found[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  }
  walk(directory);
  if (
    JSON.stringify(Object.entries(found).sort(([a], [b]) => a.localeCompare(b))) !==
    JSON.stringify(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)))
  )
    throw new Error("src/scaffold changed");
}
if (import.meta.main) {
  checkScaffoldFiles(JSON.parse(process.argv[2]));
  console.log("PASS src/scaffold exact bytes");
}
