import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

const services = resolve(import.meta.dirname, "../services");
const checker = resolve(import.meta.dirname, "../scripts/check-fetch.mjs");
const plants = [
  "fetch('https://example.test')",
  "globalThis.fetch('https://example.test')",
  "globalThis['fetch']('https://example.test')",
  "const send = fetch; send('https://example.test')",
];

test.each(plants)("the service fetch ban rejects %s in a new nested file", async (source) => {
  const logs = resolve(import.meta.dirname, "../scripts/logs");
  await mkdir(logs, { recursive: true });
  const temporary = await mkdtemp(resolve(logs, "fetch-plant-"));
  try {
    await cp(services, temporary, { recursive: true });
    await mkdir(resolve(temporary, "nested"));
    await writeFile(resolve(temporary, "nested/planted.ts"), source);
    const result = spawnSync(process.execPath, [checker, "--services", temporary], {
      encoding: "utf8",
    });
    expect({ exit: result.status, message: result.stderr.trim() }).toEqual({
      exit: 1,
      message: "nested/planted.ts: built-in fetch must use httpRequest.controller",
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the service fetch ban accepts the built-in backend and Hono's fetch method", () => {
  expect(execFileSync(process.execPath, [checker], { encoding: "utf8" })).toContain("Fetch check:");
});
