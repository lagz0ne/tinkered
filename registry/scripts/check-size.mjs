import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"));
for (const item of catalog) {
  execFileSync("node", ["../scripts/check-size.mjs", String(item.budget), `dist/${item.name}`], {
    cwd: new URL("../", import.meta.url),
    stdio: "inherit",
  });
}
