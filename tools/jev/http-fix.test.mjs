import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { inspectPlain } from "./plain.mjs";

await test("the S24 fix text typechecks in a copy of the Start scaffold", (t) => {
  const [finding] = inspectPlain(
    'export const send = () => fetch("https://api.example.com/notices");',
    "src/backend/notices.ts",
    { writer: true },
  );
  assert.equal(finding.id, "S24");
  const fix = finding.message.split(". Fix: ")[1];
  assert.ok(fix, "S24 must show a filled fix snippet");
  const scaffold = resolve(import.meta.dirname, "../../apps/start-scaffold");
  const copy = mkdtempSync(join(import.meta.dirname, ".s24-scaffold-"));
  try {
    cpSync(join(scaffold, "src"), join(copy, "src"), { recursive: true });
    for (const file of ["package.json", "tsconfig.json"])
      cpSync(join(scaffold, file), join(copy, file));
    symlinkSync(join(scaffold, "node_modules"), join(copy, "node_modules"), "dir");
    writeFileSync(join(copy, "src/backend/s24-fix.ts"), `${fix}\n`);
    const result = spawnSync(
      process.execPath,
      [join(scaffold, "node_modules/typescript/bin/tsc"), "--noEmit"],
      { cwd: copy, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.error ?? ""}${result.stdout}${result.stderr}`);
    t.diagnostic("Copied scaffold: tsc --noEmit EXIT 0");
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
