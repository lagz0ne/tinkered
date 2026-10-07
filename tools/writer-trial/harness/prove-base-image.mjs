import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { flightGate, machineVerdict } from "../gate.mjs";
import { environmentArgs, flightEnvironment } from "../flight-network.mjs";
import { placeFlightReference } from "./flight-reference.mjs";

const repo = resolve(import.meta.dirname, "../../..");
const home = join(homedir(), ".local/share/tinker-writer-trial");
const config = JSON.parse(readFileSync(join(repo, "tools/writer-trial/config.json")));
const tag = config.flight.image.split(":").at(-1);
const context = join(home, `image-${tag}`);
const name = process.argv[2] ?? `flight-base-${tag.replaceAll(".", "-")}`;
const trial = join(home, name);
const run = (bin, args) => execFileSync(bin, args, { cwd: repo, stdio: "inherit" });
const docker = (args) => run("docker", args);
const image = execFileSync(
  "docker",
  ["image", "inspect", config.flight.image, "--format", "{{.Id}}"],
  { encoding: "utf8" },
).trim();
const keeper = `tinker-flight-keep-${tag}-app`;
console.log(`IMAGE ${config.flight.image} ${image}`);
console.log(`KEEPER ${keeper}`);
console.log(`TARBALL ${join(context, "image.tar.gz")}`);
const offline = `${name}-offline`;
try {
  docker([
    "run",
    "-d",
    "--name",
    offline,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "2g",
    "--tmpfs",
    "/tmp:rw,nosuid,size=512m",
    "--tmpfs",
    "/work:rw,nosuid,size=1g,uid=1001,gid=1001",
    ...environmentArgs(),
    image,
  ]);
  docker(["exec", offline, "sh", "-c", "cp -R /home/pwuser/flight-seed/. /work/"]);
  console.log("OFFLINE seed: existing installed packages; no install command");
  for (const args of [
    ["tinker", "prepare"],
    ["tinker", "doctor"],
    ["vp", "build"],
  ]) {
    docker(["exec", offline, ...args]);
    console.log(`OFFLINE ${args.join(" ")} EXIT 0`);
  }
  docker([
    "exec",
    offline,
    "sh",
    "-c",
    "rm /work/node_modules && cp -as /home/pwuser/flight-tools/node_modules /work/node_modules && rm -rf /work/node_modules/@tinker/start && cp -R /home/pwuser/flight-tools/node_modules/@tinker/start /work/node_modules/@tinker/start && printf '\\n/* planted base change */\\n' >> /work/node_modules/@tinker/start/src/routes/tinker.tsx",
  ]);
  docker(["exec", offline, "tinker", "prepare"]);
  const planted = spawnSync(
    "docker",
    [
      "exec",
      offline,
      "node",
      "/home/pwuser/flight-tools/node_modules/@tinker/start/bin/tinker.mjs",
      "doctor",
    ],
    { encoding: "utf8" },
  );
  process.stdout.write(planted.stdout + planted.stderr);
  assert.equal(planted.status, 1);
  assert.match(planted.stdout, /fail\s+2 base bytes/);
  assert.match(planted.stdout, /src\/routes\/tinker.tsx\s+changed/);
  const gate = flightGate({ doctorExit: planted.status, plainExit: 0 });
  assert.equal(machineVerdict({ ownExit: 0, teacherExit: 0, gate }), "machine-fail");
  console.log(`PLANTED doctor EXIT ${planted.status}; gate ${gate.status}; machine-fail`);
} finally {
  docker(["rm", "-f", offline]);
}
run("node", ["tools/writer-trial/workers.mjs", "create", name, "--suite", "flight"]);
try {
  run("node", ["tools/writer-trial/workers.mjs", "stage", name, "1"]);
  const manifest = JSON.parse(readFileSync(join(trial, "manifest.json")));
  const worker = manifest.workers[0];
  const project = join(trial, "reference-on-base");
  placeFlightReference(
    join(repo, "tools/flight-trial/reference"),
    join(context, "seed"),
    project,
    1,
  );
  writeFileSync(
    join(project, ".env"),
    Object.entries(flightEnvironment())
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  docker(["cp", `${project}/.`, `${worker.container}:/work/`]);
  docker(["exec", worker.container, "tinker", "prepare"]);
  docker(["exec", worker.container, "vp", "fmt"]);
  docker(["exec", worker.container, "sh", "-c", "node scripts/check-plain.mjs --list > PLAIN.md"]);
  console.log("REFERENCE placed on base; no model writer launched");
  writeFileSync(join(trial, "reference-session.jsonl"), "");
  writeFileSync(
    join(trial, "reference-report.md"),
    "# Fixed reference proof\n\nNo model writer ran.\n",
  );
  run("node", [
    "tools/writer-trial/review.mjs",
    "save",
    name,
    "1",
    "1",
    "--session",
    join(trial, "reference-session.jsonl"),
    "--report",
    join(trial, "reference-report.md"),
  ]);
  run("node", ["tools/writer-trial/review.mjs", "check", name, "1", "1"]);
  const checked = JSON.parse(readFileSync(join(trial, "manifest.json"))).workers[0];
  const check = checked.attempts.at(-1).checks.at(-1);
  console.log(
    `ROUND 1 ${check.machine}; own ${check.ownExit}; teacher ${check.teacherExit}; Jev ${check.jevExit}`,
  );
  console.log(`SCORE ${JSON.stringify(checked.score)}`);
  assert.equal(check.machine, "machine-pass");
} finally {
  const saved = JSON.parse(readFileSync(join(trial, "manifest.json"))).workers;
  writeFileSync(join(trial, "reference-session.jsonl"), "");
  writeFileSync(
    join(trial, "reference-report.md"),
    "# Fixed reference proof\n\nNo model writer ran.\n",
  );
  for (const [index, worker] of saved.entries())
    if (worker.status !== "saved")
      run("node", [
        "tools/writer-trial/review.mjs",
        "save",
        name,
        "1",
        String(index + 1),
        "--session",
        join(trial, "reference-session.jsonl"),
        "--report",
        join(trial, "reference-report.md"),
      ]);
  run("node", ["tools/writer-trial/workers.mjs", "export", name]);
  run("node", ["tools/writer-trial/workers.mjs", "cleanup", name]);
  console.log(`CLEANUP ${name} EXIT 0; results kept at ${trial}`);
}

assert.ok(existsSync(join(context, "image.tar.gz")));
