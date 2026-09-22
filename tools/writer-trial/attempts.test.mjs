// Attempt bookkeeping. No docker, no Paseo, no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  attemptDir,
  checkerFor,
  cleanupReady,
  claimAttemptDir,
  feedbackEventsPath,
  latestAttempt,
  nextAttempt,
} from "./attempts.mjs";

void describe("checker routing", () => {
  void it("uses rounds for booking 1-3, repair, transfer, stock", () => {
    assert.deepEqual(checkerFor("booking", 1), {
      script: "evaluate.mjs",
      args: ["1"],
    });
    assert.deepEqual(checkerFor("booking", 3), {
      script: "evaluate.mjs",
      args: ["3"],
    });
    assert.deepEqual(checkerFor("booking", 4), {
      script: "acceptance.mjs",
      args: ["repair"],
    });
    assert.deepEqual(checkerFor("booking", 5), {
      script: "acceptance.mjs",
      args: ["transfer"],
    });
    assert.deepEqual(checkerFor("stock", 1), {
      script: "stock-acceptance.mjs",
      args: [],
    });
    assert.throws(() => checkerFor("stock", 2), /No checker/);
    assert.throws(() => checkerFor("booking", 6), /No checker/);
  });
});

void describe("attempt numbers", () => {
  void it("counts per round and picks the latest saved try", () => {
    const rows = [{ round: 1 }, { round: 1 }, { round: 2 }];
    assert.equal(nextAttempt(rows, 1), 3);
    assert.equal(nextAttempt(rows, 3), 1);
    assert.equal(latestAttempt(rows, 1), rows[1]);
    assert.throws(() => latestAttempt(rows, 9), /No saved attempt/);
  });
});

void describe("overwrite refusal", () => {
  void it("names one folder per try and refuses taken paths", () => {
    const root = mkdtempSync(join(tmpdir(), "attempts-"));
    try {
      const dir = attemptDir(root, 1, 2, 3);
      assert.equal(basename(dir), "worker-2-attempt-3");
      claimAttemptDir(dir);
      writeFileSync(join(dir, "archive.tar"), "x");
      assert.throws(() => claimAttemptDir(dir), /EEXIST/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  void it("refuses an existing feedback event log", () => {
    const root = mkdtempSync(join(tmpdir(), "attempts-events-"));
    try {
      const path = feedbackEventsPath(root, "writer-trial-x", 1, 2);
      writeFileSync(path, "");
      assert.throws(() => feedbackEventsPath(root, "writer-trial-x", 1, 2), /refusing overwrite/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

void describe("cleanup gate", () => {
  void it("fails until every worker has a saved archive", () => {
    const workers = [
      { attempts: [{ round: 1, archive: "a.tar" }] },
      { attempts: [{ round: 2, archive: "b.tar" }] },
    ];
    assert.throws(() => cleanupReady(workers, 1), /worker\(s\): 2/);
    workers[1].attempts.push({ round: 1, archive: "c.tar" });
    assert.equal(cleanupReady(workers, 1), true);
  });
});
