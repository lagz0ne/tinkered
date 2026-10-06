import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** Keys this process took from `.env`; a shell value is never in it, so the shell still wins. */
const fromEnvFile = new Set();

/**
 * Load the app's `.env` into process.env, again on each dev restart.
 * `process.loadEnvFile` never overwrites a key, so an edited `.env` kept its old value;
 * this overwrites only keys it set itself, and drops them when `.env` no longer has them.
 * @param {string} root - From tinker() or tinker serve; why: the app whose .env to read.
 */
export function loadEnv(root) {
  const path = join(root, ".env");
  const values = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  for (const key of fromEnvFile) {
    if (key in values) continue;
    delete process.env[key];
    fromEnvFile.delete(key);
  }
  for (const [key, value] of Object.entries(values)) {
    if (key in process.env && !fromEnvFile.has(key)) continue;
    process.env[key] = value;
    fromEnvFile.add(key);
  }
}
