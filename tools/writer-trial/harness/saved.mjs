import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256File, verifyFrozen } from "../suite.mjs";

const root = process.argv[2];
const manifest = JSON.parse(readFileSync(join(root, "manifest.json")));
assert.equal(verifyFrozen(root, manifest.frozen), true);
for (const worker of manifest.workers) {
  for (const attempt of worker.attempts ?? []) {
    const folder = attempt.archive.slice(0, attempt.archive.lastIndexOf("/"));
    const hashes = JSON.parse(readFileSync(join(folder, "hashes.json")));
    for (const [key, filename] of [
      ["archive", "archive.tar"],
      ["session", "session.jsonl"],
      ["report", "report.md"],
      ["events", "events.jsonl"],
    ])
      assert.equal(sha256File(join(folder, filename)), hashes[key], filename);
    assert.deepEqual(hashes.suiteFiles, manifest.frozen.files);
    for (const check of attempt.checks ?? []) {
      const evidence = JSON.parse(readFileSync(join(check.dir, "evidence.json")));
      assert.equal(evidence.archive, hashes.archive);
      assert.equal(evidence.image, manifest.image);
      assert.deepEqual(evidence.flightImages, manifest.flightImages);
      assert.ok(evidence.files["flight-teacher/check.mjs"]);
      assert.ok(evidence.files[`flight-teacher/round-${attempt.round}.mjs`]);
    }
  }
}
console.log(
  "PASS saved attempts, archive/session/report/event hashes, frozen copies, checker hashes, pinned image IDs",
);
