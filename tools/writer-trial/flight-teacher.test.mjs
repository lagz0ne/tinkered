import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import { freezeTrial, readFlightTeacher, sha256File, trialDir } from "./suite.mjs";
import { flightGate, machineVerdict } from "./gate.mjs";
import { flightScore } from "./flight-score.mjs";

void it("freezes teacher hashes at create and makes changed teacher checks unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "flight-teacher-"));
  try {
    const frozen = freezeTrial(root, "flight");
    const pins = frozen.teacher;
    assert.match(pins.hash, /^[a-f0-9]{64}$/);
    assert.equal(
      pins.files["round-1.mjs"],
      sha256File(join(trialDir, "teacher/flight/round-1.mjs")),
    );
    const snapshot = readFlightTeacher(pins, 1);
    assert.equal(snapshot.hash, pins.hash);
    assert.deepEqual(
      snapshot.files["round-1.mjs"],
      readFileSync(join(trialDir, "teacher/flight/round-1.mjs")),
    );

    // An isolated checkout lets the real checker see teacher edits without touching the repo.
    for (const file of ["suite.mjs", "jev-packages.mjs", "flight-check.mjs", "flight-network.mjs"])
      copyFileSync(join(trialDir, file), join(root, file));
    const teacher = join(root, "teacher/flight");
    cpSync(join(trialDir, "teacher/flight"), teacher, { recursive: true });
    const { checkFlight } = await import(pathToFileURL(join(root, "flight-check.mjs")));
    const changed = join(teacher, "round-1.mjs");
    const original = readFileSync(changed);
    for (const change of ["changed", "added", "missing", "not-pinned"]) {
      writeFileSync(changed, original);
      rmSync(join(teacher, "extra.mjs"), { force: true });
      if (change === "changed") writeFileSync(changed, "throw new Error('changed teacher');\n");
      if (change === "added") writeFileSync(join(teacher, "extra.mjs"), "export default 1;\n");
      if (change === "missing") rmSync(changed);
      // No images or archive: refusal must happen before any container starts.
      const result = checkFlight({
        round: 1,
        teacherPins: change === "not-pinned" ? undefined : pins,
        logDir: root,
      });
      assert.match(result.unavailable, /Teacher .*unavailable/);
      assert.equal(result.teacherExit, 1);
      assert.equal(result.unscored, true);
      assert.equal(result.teacherHash, change === "not-pinned" ? null : pins.hash);
      const gate = flightGate(result);
      assert.equal(gate.status, "unavailable");
      const machine = machineVerdict({ ...result, gate });
      assert.notEqual(machine, "machine-pass");
      assert.equal(
        flightScore([{ round: 1, checks: [{ machine, flight: result }] }]).status,
        "pending",
      );
      assert.match(readFileSync(join(root, "teacher.log"), "utf8"), /unavailable/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
