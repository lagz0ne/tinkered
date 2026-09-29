import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(fileURLToPath(import.meta.url));
const expected = resolve(cwd, process.argv[2] ?? "tests/fixture/auth-schema.ts");
const folder = await mkdtemp(join(tmpdir(), "tinker-auth-schema-"));
try {
  const generated = join(folder, "auth-schema.ts");
  execFileSync(
    process.execPath,
    [
      join(cwd, "node_modules/auth/dist/index.mjs"),
      "generate",
      "--config",
      join(cwd, "auth.config.ts"),
      "--output",
      generated,
      "--yes",
    ],
    { cwd, stdio: "pipe" },
  );
  const formatted = execFileSync("vp", ["fmt", "--stdin-filepath", "auth-schema.ts"], {
    cwd,
    input: await readFile(generated),
    encoding: "utf8",
  });
  if (formatted !== (await readFile(expected, "utf8"))) {
    console.error(`Auth schema differs: ${expected}`);
    process.exitCode = 1;
  }
} finally {
  await rm(folder, { recursive: true, force: true });
}
