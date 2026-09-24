// Attempt bookkeeping. No docker, no Paseo, no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  attemptDir,
  checkerFor,
  checkName,
  claimAttemptDir,
  claimLock,
  cleanupReady,
  feedbackEventsPath,
  latestAttempt,
  lockPathFor,
  nextAttempt,
  nextCheckSeq,
  pendingFor,
  planSave,
} from "./attempts.mjs";

void describe("checker routing", () => {
  void it("uses rounds for booking 1-3, repair, transfer, and each fresh suite", () => {
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
    assert.deepEqual(checkerFor("plan", 1), {
      script: "plan-acceptance.mjs",
      args: [],
    });
    assert.deepEqual(checkerFor("loans", 1), {
      script: "loans-acceptance.mjs",
      args: [],
    });
    assert.deepEqual(checkerFor("ballot", 1), {
      script: "ballot-acceptance.mjs",
      args: [],
    });
    assert.deepEqual(checkerFor("kitchen", 1), {
      script: "kitchen-acceptance.mjs",
      args: [],
    });
    assert.throws(() => checkerFor("stock", 2), /No checker/);
    assert.throws(() => checkerFor("plan", 2), /No checker/);
    assert.throws(() => checkerFor("loans", 2), /No checker/);
    assert.throws(() => checkerFor("ballot", 2), /No checker/);
    assert.throws(() => checkerFor("kitchen", 2), /No checker/);
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
      { status: "saved", attempts: [{ round: 1, archive: "a.tar" }] },
      { status: "staged", attempts: [{ round: 2, archive: "b.tar" }] },
    ];
    assert.throws(() => cleanupReady(workers, 1), /worker\(s\): 2/);
    workers[1].attempts.push({ round: 1, archive: "c.tar" });
    workers[1].status = "saved";
    assert.equal(cleanupReady(workers, 1), true);
  });

  void it("names repeat check folders without reuse", () => {
    assert.equal(checkName(1), "check-1");
    assert.equal(nextCheckSeq(undefined), 1);
    assert.equal(nextCheckSeq([{ seq: 1 }, { seq: 2 }]), 3);
  });

  void it("plans one open save per round; feedback opens the retry", () => {
    const fresh = { status: "staged", attempts: [] };
    assert.deepEqual(planSave(fresh, 1), { attempt: 1, retry: false });
    const saved = { status: "saved", attempts: [{ round: 1, attempt: 1 }] };
    assert.throws(() => planSave(saved, 1), /stage feedback/);
    const fed = {
      status: "feedback",
      pending: { round: 1, attempt: 2 },
      attempts: [{ round: 1, attempt: 1 }],
    };
    assert.deepEqual(planSave(fed, 1), { attempt: 2, retry: true });
    assert.deepEqual(pendingFor(fed, 1), { round: 1, attempt: 2 });
    assert.equal(pendingFor(saved, 1), null);
    assert.throws(() => planSave({ ...fed, pending: { round: 2, attempt: 1 } }, 1), /round 2/);
  });

  void it("cleanup waits for the pending retry save on the active round", () => {
    const ok = [{ status: "saved", attempts: [{ round: 1, archive: "a" }] }];
    assert.equal(cleanupReady(ok, 1), true);
    const fed = [
      {
        status: "feedback",
        pending: { round: 1, attempt: 2 },
        attempts: [{ round: 1, archive: "a" }],
      },
    ];
    assert.throws(() => cleanupReady(fed, 1), /worker\(s\): 1/);
    const other = [{ status: "saved", attempts: [{ round: 2, archive: "a" }] }];
    assert.throws(() => cleanupReady(other, 1), /worker\(s\): 1/);
  });
});

void describe("review lock", () => {
  void it("claims once, fails busy, releases", () => {
    const root = mkdtempSync(join(tmpdir(), "attempts-lock-"));
    try {
      const release = claimLock(root);
      assert.ok(existsSync(lockPathFor(root)));
      assert.throws(() => claimLock(root), /busy/);
      release();
      assert.ok(!existsSync(lockPathFor(root)));
      const again = claimLock(root);
      again();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
