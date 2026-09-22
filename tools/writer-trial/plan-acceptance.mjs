import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const [archive, image] = process.argv.slice(2);
assert.ok(archive, "usage: plan-acceptance.mjs <snapshot.tar> <manifest-image-id>");
assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/, "pass the trial manifest image id");
const container = `writer-trial-plan-accept-${randomUUID()}`;
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 330000,
    maxBuffer: 8 * 1024 * 1024,
  });
const teacher = fileURLToPath(new URL("./teacher/", import.meta.url));
// Only these two files ship into the grading container: the runner and its
// one shape helper. The teacher-only fixture and other app checks never
// ride along with an ordinary submission.
const SHIPPED = ["plan-acceptance.mjs", "acceptance-shape.mjs"];
for (const name of SHIPPED) readFileSync(resolve(teacher, name));
// Never import submitted code on the host: it only runs inside the container.
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
    execFileSync("tar", ["-C", teacher, "-cf", "-", ...SHIPPED]),
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
      "5",
      "280",
      "node",
      "/teacher/plan-acceptance.mjs",
      "/work",
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
