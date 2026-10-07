import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripDocument } from "./strip-import-extensions.mjs";

const ts = "." + "ts";
const tsx = "." + "tsx";
const mts = "." + "mts";

await test("the gate rejects saved module endings, then accepts the rerunnable cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "saved-module-endings-"));
  const json = JSON.stringify({
    target: `~/src/view${tsx}`,
    meta: { seams: { extensions: { from: `../demo${ts}`, include: { from: `../setup${mts}` } } } },
    content: JSON.stringify({ line: `export { x } from "./x${ts}";` }),
  });
  const files = {
    "guide.md": '```ts\nexport { x } from "./view' + tsx + '";\n```\n',
    "registry.json": json,
    "template.txt": `import("./lazy${mts}"); import "./style.css"; import "./x${ts}?url";`,
  };
  const paths = Object.keys(files).map((file) => join(root, file));
  try {
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
    const red = spawnSync(process.execPath, ["scripts/check-import-extensions.mjs", ...paths], {
      encoding: "utf8",
    });
    assert.equal(red.status, 1);
    assert.match(red.stdout, /5 hit\(s\)/);
    for (const [file, text] of Object.entries(files))
      writeFileSync(join(root, file), stripDocument(text).text);
    const green = spawnSync(process.execPath, ["scripts/check-import-extensions.mjs", ...paths], {
      encoding: "utf8",
    });
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /0 hit\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
