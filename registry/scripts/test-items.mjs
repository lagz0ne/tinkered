import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"));
const args = process.argv.slice(2).filter((arg) => arg !== "--" && arg !== "--project");
const chosen = args.length ? args : catalog.map((item) => item.name);
for (const name of chosen) {
  assert.ok(
    catalog.some((item) => item.name === name),
    `Unknown source item: ${name}`,
  );
  execFileSync("vp", ["test", "--project", name], { stdio: "inherit" });
}
