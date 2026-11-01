import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { inspectPlain } from "./plain.mjs";

await test("the S24 fix text typechecks against @tinker/core and passes the plain rules", (t) => {
  const [finding] = inspectPlain(
    'export const send = () => fetch("https://api.example.com/notices");',
    "src/backend/notices.ts",
    { writer: true },
  );
  assert.equal(finding.id, "S24");
  const fix = finding.message.split(". Fix: ")[1];
  assert.ok(fix, "S24 must show a filled fix snippet");
  assert.deepEqual(inspectPlain(fix, "src/backend/notices.ts", { writer: true }), []);

  const core = resolve(import.meta.dirname, "../../packages/core");
  const copy = mkdtempSync(join(import.meta.dirname, ".s24-core-"));
  try {
    mkdirSync(join(copy, "src/backend"), { recursive: true });
    mkdirSync(join(copy, "node_modules/@tinker"), { recursive: true });
    symlinkSync(core, join(copy, "node_modules/@tinker/core"), "dir");
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
          lib: ["esnext", "dom"],
          types: [],
        },
        include: ["src"],
      }),
    );
    writeFileSync(join(copy, "src/backend/notices.ts"), `${fix}\n`);
    // The entry line the message names: the seam binds the built-in fetch to the tag.
    writeFileSync(
      join(copy, "src/main.ts"),
      'import { createScope } from "@tinker/core";\n' +
        'import { httpSend, postNotice } from "./backend/notices";\n' +
        "const scope = createScope({ tags: [httpSend(fetch)] });\n" +
        "export const sent = scope.run(postNotice);\n",
    );

    const result = spawnSync(
      process.execPath,
      [join(core, "node_modules/typescript/bin/tsc"), "--noEmit"],
      { cwd: copy, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.error ?? ""}${result.stdout}${result.stderr}`);
    t.diagnostic("Core snippet: tsc --noEmit EXIT 0");
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
