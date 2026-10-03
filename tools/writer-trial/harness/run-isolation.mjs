import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { environmentArgs, pinFlightImages, startFlight, stopFlight } from "../flight-network.mjs";

const run = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 16e6,
  });
const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url)));
const images = pinFlightImages(config);
const prefix = `flight-isolation-${process.pid}-${Date.now().toString(36)}`;
const app = `${prefix}-writer`;
const volume = `${app}-work`;
let state;
try {
  state = startFlight(prefix, images);
  state.containers.push(app);
  run(["volume", "create", "--label", `tinker.writer-trial=${prefix}`, volume]);
  // Match workers.mjs create, including the writer's writable volume and network aliases.
  run([
    "create",
    "--name",
    app,
    "--label",
    `tinker.writer-trial=${prefix}`,
    "--network",
    state.network,
    "--network-alias",
    "app",
    "--network-alias",
    "flight-app",
    "--dns",
    "127.0.0.1",
    ...environmentArgs(),
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
    "--mount",
    `type=volume,src=${volume},dst=/work`,
    "--user",
    "pwuser",
    "--init",
    images.image,
  ]);
  run(["start", app]);
  run(["exec", app, "sh", "-c", "cp -R /home/pwuser/flight-seed/. /work/"]);
  run(
    ["exec", "-i", app, "sh", "-c", "cat > /work/isolation.mjs"],
    readFileSync(new URL("./isolation.mjs", import.meta.url)),
  );
  const privateIp = (name) =>
    run([
      "inspect",
      `${prefix}-${name}`,
      "--format",
      `{{(index .NetworkSettings.Networks "${state.controlNetwork}").IPAddress}}`,
    ]).trim();
  console.log(
    run([
      "exec",
      app,
      "node",
      "/work/isolation.mjs",
      privateIp("supplier-a"),
      privateIp("mailpit"),
    ]),
  );
  console.log(
    run([
      "exec",
      `${prefix}-proxy`,
      "node",
      "--input-type=module",
      "-e",
      "import assert from 'node:assert/strict';const r=await fetch('http://control-mailpit:8025/api/v1/chaos',{method:'PUT',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);console.log('PASS teacher may set Mailpit Chaos');",
    ]),
  );
} finally {
  if (state) stopFlight(state);
  run(["volume", "rm", volume]);
  if (state) {
    for (const name of state.containers)
      assert.notEqual(spawnSync("docker", ["inspect", name]).status, 0, name);
    for (const name of [state.network, state.controlNetwork])
      assert.notEqual(spawnSync("docker", ["network", "inspect", name]).status, 0, name);
  }
  console.log("PASS proof containers, networks, and volume removed");
}
