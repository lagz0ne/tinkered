import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { checkDrift } from "../../src/drizzle/migrations.ts";

const run = promisify(execFile);
const root = new URL("../../", import.meta.url).pathname;

test("fresh auth generation matches the saved schema and rejects an edited copy", async () => {
  await run(process.execPath, ["configs/auth/check-schema.mjs"], { cwd: root });
  const folder = await mkdtemp(join(tmpdir(), "auth-drift-test-"));
  try {
    const changed = join(folder, "auth-schema.ts");
    const saved = await readFile(join(root, "tests/auth/fixture/auth-schema.ts"), "utf8");
    await writeFile(changed, saved.replace('text("name")', 'text("changed_name")'));
    await expect(
      run(process.execPath, ["configs/auth/check-schema.mjs", changed], { cwd: root }),
    ).rejects.toMatchObject({ code: 1, stderr: `Auth schema differs: ${changed}\n` });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("the app and auth tables match the one migration history", async () => {
  await checkDrift(join(root, "tests/auth/fixture/drizzle.config.ts"));
});
