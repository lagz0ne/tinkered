import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

assert.ok(existsSync("node_modules/@tinker/start/files.json"));
assert.ok(existsSync(".tinker/routeTree.gen.ts"));
assert.ok(!existsSync("src/scaffold"));
for (const skill of [
  "tinker-feature",
  "tinker-forms",
  "tinker-seams",
  "tinker-sync",
  "tinker-testing",
])
  assert.ok(existsSync(`.agents/skills/${skill}/SKILL.md`), skill);
assert.ok(readdirSync("tests").length >= 7);
assert.ok(existsSync("PLAIN.md"));
assert.ok(existsSync("scripts/check-plain.mjs"));
assert.match(readFileSync("SERVICES.md", "utf8"), /supplier|payment/i);
assert.ok(JSON.parse(readFileSync("package.json")).scripts["check:plain"]);
const task = readFileSync("TASK.md", "utf8");
assert.match(task, /round 1/i);
assert.doesNotMatch(task, /round [2-5]/i);
assert.ok(!existsSync("teacher"));
assert.ok(!existsSync("tools/flight-trial"));
const dependencies = JSON.parse(readFileSync("package.json")).dependencies;
assert.equal(dependencies["@tinker/core"], "file:./core.tgz");
assert.equal(dependencies["@tinker/react"], "file:./react.tgz");
assert.equal(dependencies["@tinker/start"], "file:./start.tgz");
console.log(
  "PASS Start scaffold, five skills, tests, packed packages, only packet 1, no teacher files",
);
