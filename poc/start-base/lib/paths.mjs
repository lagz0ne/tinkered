import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's folder: the base that runs this code. */
export const baseDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path - From a caller; why: read a JSON file once. */
export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** This base's own package.json. */
export const basePackage = readJson(join(baseDir, "package.json"));

/** @param {string} path - From a file walk; why: pin or compare its bytes. */
export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The seam file the base reads, or the base's empty default (ADR 0106).
 * @param {string} root - From the app folder; why: look for the seam file there.
 * @param {"tinker.ts" | "tinker.server.ts"} name - From the alias; why: pick client or server.
 */
export function seam(root, name) {
  const own = join(root, "src/lib", name);
  return existsSync(own) ? own : join(baseDir, "src/defaults", name.replace("tinker", "app"));
}

/** @param {string} root - From the app folder; why: find the base the app resolves. */
export function installedBase(root) {
  try {
    const require = createRequire(join(root, "package.json"));
    return realpathSync(dirname(require.resolve("@tinker/start/package.json")));
  } catch {
    return null;
  }
}

/**
 * @param {string} root - From the app folder; why: start the walk up there.
 * @param {string} name - From a peer list; why: read its installed version.
 */
export function installedVersion(root, name) {
  for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
    const path = join(dir, "node_modules", name, "package.json");
    if (existsSync(path)) return readJson(path).version;
  }
  return null;
}

/**
 * Every file under a folder, as paths relative to `top`.
 * @param {string} dir - From a caller; why: the folder to walk.
 * @param {string} top - From a caller; why: make paths relative to it.
 */
export function listFiles(dir, top = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.name === "node_modules") return [];
    return entry.isDirectory() ? listFiles(path, top) : [relative(top, path)];
  });
}
