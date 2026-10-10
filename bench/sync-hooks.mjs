// Resolve hook for the sync probe: loads one tree's Start source (TypeScript, extensionless
// imports) and points `#tinker/app.server` at that tree's copy of the bench seam.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let root = process.cwd();
let startPackage = join(root, "packages/start/package.json");

export function initialize(data) {
  root = data.root;
  startPackage = join(root, "packages/start/package.json");
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "#tinker/app.server") {
    const seam = join(root, "bench/sync-app.server.mjs");
    return { url: pathToFileURL(seam).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL).pathname;
    for (const file of [`${base}.ts`, join(base, "index.ts")]) {
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
  // Bare names resolve from the Start package first, so both trees share one copy of each library.
  try {
    return await nextResolve(specifier, {
      ...context,
      parentURL: pathToFileURL(startPackage).href,
    });
  } catch {
    return nextResolve(specifier, context);
  }
}
