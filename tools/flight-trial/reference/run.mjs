import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const command = process.argv[2] ?? "dev";
const root = fileURLToPath(new URL(".", import.meta.url));
const child = spawn(
  process.execPath,
  command === "start"
    ? ["--env-file=.env", "scripts/serve.mjs"]
    : ["--env-file=.env", "node_modules/vite-plus/bin/vp", command],
  {
    cwd: root,
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
process.exitCode = await new Promise((done) => child.once("exit", (code) => done(code ?? 1)));
