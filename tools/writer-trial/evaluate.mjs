import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const [archive, roundText, image] = process.argv.slice(2);
const round = Number(roundText);
assert.ok(
  archive && Number.isInteger(round) && round >= 1 && round <= 4 && image,
  "usage: evaluate.mjs <snapshot.tar> <round> <manifest-image-id>",
);
assert.match(image, /^sha256:[a-f0-9]{64}$/);
const container = `writer-trial-eval-${randomUUID()}`;
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
const teacher = fileURLToPath(new URL("./teacher/", import.meta.url));
// Read trusted checks before creating the disposable container.
readFileSync(resolve(teacher, "run.mjs"));
try {
  docker([
    "run",
    "-d",
    "--name",
    container,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "2g",
    "--cpus",
    "2",
    "--pids-limit",
    "256",
    "--shm-size",
    "512m",
    "--tmpfs",
    "/tmp:rw,nosuid,size=512m",
    "--tmpfs",
    "/work:rw,nosuid,size=1g,uid=1001,gid=1001",
    "--tmpfs",
    "/teacher:rw,nosuid,size=16m,uid=1001,gid=1001",
    "--user",
    "pwuser",
    "--init",
    image,
  ]);
  docker(
    [
      "exec",
      "-i",
      container,
      "timeout",
      "30",
      "tar",
      "--no-same-owner",
      "--no-same-permissions",
      "-xf",
      "-",
      "-C",
      "/work",
    ],
    readFileSync(resolve(archive)),
  );
  docker(
    ["exec", "-i", container, "tar", "--no-same-owner", "-xf", "-", "-C", "/teacher"],
    execFileSync("tar", ["-C", teacher, "-cf", "-", "."]),
  );
  docker([
    "exec",
    container,
    "ln",
    "-s",
    "/home/pwuser/toolchain/node_modules",
    "/teacher/node_modules",
  ]);
  process.stdout.write(
    docker([
      "exec",
      container,
      "timeout",
      "-k",
      "2",
      "120",
      "node",
      "/teacher/run.mjs",
      "/work",
      String(round),
    ]),
  );
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  docker(["rm", "-f", container]);
}
