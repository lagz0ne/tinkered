import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleNames, exportExample } from "./export-example.mjs";

function run(folder, args) {
  try {
    return execFileSync("vp", args, {
      cwd: folder,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_PATH: "" },
    });
  } catch (error) {
    console.error(error.stdout?.toString() ?? "");
    console.error(error.stderr?.toString() ?? "");
    throw error;
  }
}

async function checkBrowser(folder) {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(
    "vp",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: folder,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_PATH: "" },
    },
  );
  const closed = once(child, "close");
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(30_000);
      const expired = () => reject(new Error(`Browser start did not finish:\n${output}`));
      timeout.addEventListener("abort", expired, { once: true });
      child.once("error", reject);
      child.once("exit", () => reject(new Error(`Browser start exited:\n${output}`)));
      const read = (chunk) => {
        output += chunk.toString();
        if (output.includes(`http://127.0.0.1:${port}`)) {
          timeout.removeEventListener("abort", expired);
          resolve();
        }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
    });
    const response = await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !(await response.text()).includes('type="module"')) {
      throw new Error("The stand-alone browser entry did not load.");
    }
  } finally {
    if (child.exitCode === null && child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    await closed;
  }
}

if (import.meta.main) {
  const chosen = process.argv.slice(2).filter((argument) => argument !== "--");
  const names = chosen.length ? chosen : exampleNames();
  const scratch = mkdtempSync(join(tmpdir(), "tinkered-examples-"));
  console.log(`Stand-alone copies: ${scratch}`);
  for (const name of names) {
    const folder = exportExample(name, join(scratch, name));
    run(folder, ["install", "--prefer-offline"]);
    run(folder, ["run", "check"]);
    run(folder, ["run", "test"]);
    const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    if (manifest.scripts.build !== undefined) run(folder, ["run", "build"]);
    if (name === "react") await checkBrowser(folder);
    else run(folder, ["run", "start"]);
    console.log(`PASS ${name}: outside-repo install, check, tests, and run`);
  }
}
