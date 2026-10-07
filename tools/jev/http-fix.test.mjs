import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { inspectPlain } from "./plain.mjs";

await test("the S24 fix text typechecks against the Start base", (t) => {
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
    mkdirSync(join(copy, "src/backend"), { recursive: true });
    symlinkSync(join(scaffold, "node_modules"), join(copy, "node_modules"), "dir");
    writeFileSync(join(copy, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(copy, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          types: ["node"],
          paths: { "@/*": ["./src/*"] },
        },
        include: ["src"],
      }),
    );
    writeFileSync(
      join(copy, "src/errors.ts"),
      'export function raise(kind: "NotificationFailed", payload: Record<string, never>): never { throw Object.assign(new Error(kind), { kind, payload }); }\n',
    );
    writeFileSync(join(copy, "src/backend/s24-fix.ts"), `${fix}\n`);
    const result = spawnSync(
      process.execPath,
      [join(scaffold, "node_modules/typescript/bin/tsc"), "--noEmit"],
      { cwd: copy, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.error ?? ""}${result.stdout}${result.stderr}`);
    t.diagnostic("Start base snippet: tsc --noEmit EXIT 0");
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
