import { createHash } from "node:crypto";
import { lstatSync, readFileSync, rmSync } from "node:fs";

/** Remove submitted output so only the fresh build can supply the router. */
export function resetRouter(path) {
  rmSync(path, { force: true, recursive: true });
}

/** Missing files, directories, and links fail the own check. */
export function routerHash(path) {
  if (!lstatSync(path).isFile()) throw new Error("Fresh generated router must be a file");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (import.meta.main) {
  const path = "/work/src/routeTree.gen.ts";
  if (process.argv[2] === "reset") {
    resetRouter(path);
    console.log("PASS submitted router removed before build");
  } else console.log(routerHash(path));
}
