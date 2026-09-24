// Suite freeze and staging reads. No docker, no Paseo, no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assembleGuidelines,
  copyTrialTools,
  freezeTrial,
  frozenConfigFor,
  guidelineSourcesFor,
  limitsFor,
  readFrozenGuidelines,
  readFrozenTask,
  roundsFor,
  suiteFor,
  taskFileFor,
  taskSourcesFor,
  validRounds,
  verifyFrozen,
} from "./suite.mjs";

void describe("suite defs", () => {
  void it("defaults old trials to booking, keeps every fresh suite single-round", () => {
    assert.equal(suiteFor({}), "booking");
    assert.deepEqual(roundsFor("booking"), [1, 2, 3, 4, 5]);
    assert.deepEqual(roundsFor("stock"), [1]);
    assert.deepEqual(roundsFor("plan"), [1]);
    assert.deepEqual(roundsFor("loans"), [1]);
    assert.deepEqual(roundsFor("ballot"), [1]);
    assert.deepEqual(roundsFor("kitchen"), [1]);
    assert.deepEqual(roundsFor("locker"), [1]);
    assert.throws(() => roundsFor("nope"), /Unknown suite/);
  });

  void it("grows booking tasks round by round, freezes every fresh suite task", () => {
    assert.equal(taskSourcesFor("booking", 1).length, 1);
    assert.equal(taskSourcesFor("booking", 5).length, 5);
    assert.deepEqual(taskSourcesFor("stock", 1), ["stock/01-stock-moves.md"]);
    assert.deepEqual(taskSourcesFor("plan", 1), ["plan/01-learning-plan.md"]);
    assert.deepEqual(taskSourcesFor("loans", 1), ["loans/01-tool-library.md"]);
    assert.deepEqual(taskSourcesFor("ballot", 1), ["ballot/01-team-poll.md"]);
    assert.deepEqual(taskSourcesFor("kitchen", 1), ["kitchen/01-kitchen-queue.md"]);
    assert.deepEqual(taskSourcesFor("locker", 1), ["locker/01-parcel-locker.md"]);
    assert.throws(() => taskSourcesFor("stock", 2), /no round/);
    assert.throws(() => taskSourcesFor("plan", 2), /no round/);
    assert.throws(() => taskSourcesFor("loans", 2), /no round/);
    assert.throws(() => taskSourcesFor("ballot", 2), /no round/);
    assert.throws(() => taskSourcesFor("kitchen", 2), /no round/);
    assert.throws(() => taskSourcesFor("locker", 2), /no round/);
  });

  void it("keeps booking clauses out of the default rules", () => {
    const text = assembleGuidelines("booking");
    for (const word of ["BadDate", "BookingApp", "bookings"]) assert.match(text, new RegExp(word));
    const base = assembleGuidelines("stock");
    for (const word of ["BadDate", "BookingApp", "booking"])
      assert.doesNotMatch(base, new RegExp(word));
    assert.match(base, /useData and runs operations with useRun/);
    assert.doesNotMatch(base, /Worked example|for example/i);
    assert.deepEqual(guidelineSourcesFor("stock"), ["guidelines.md"]);
    assert.deepEqual(guidelineSourcesFor("plan"), ["guidelines.md"]);
    assert.deepEqual(guidelineSourcesFor("loans"), ["guidelines.md"]);
    assert.deepEqual(guidelineSourcesFor("ballot"), ["guidelines.md"]);
    assert.deepEqual(guidelineSourcesFor("kitchen"), ["guidelines.md"]);
    assert.deepEqual(guidelineSourcesFor("locker"), ["guidelines.md"]);
  });
});

void describe("frozen copies", () => {
  void it("freezes copies once and refuses a silent refresh", () => {
    const root = mkdtempSync(join(tmpdir(), "suite-freeze-"));
    try {
      const frozen = freezeTrial(root, "stock");
      assert.ok(frozen.files["tasks/01-stock-moves.md"]);
      assert.ok(frozen.files["rules/guidelines.md"]);
      assert.ok(frozen.files["tools/broker.mjs"]);
      assert.ok(frozen.files["jev/shape.mjs"]);
      assert.ok(frozen.files["jev/plain.mjs"]);
      assert.throws(() => freezeTrial(root, "stock"), /do not refresh/);
      assert.equal(verifyFrozen(root, frozen), true);
      writeFileSync(join(root, "frozen/rules/guidelines.md"), "changed\n");
      assert.throws(() => verifyFrozen(root, frozen), /Frozen copy changed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  void it("stages task and rules from frozen copies only", () => {
    const root = mkdtempSync(join(tmpdir(), "suite-stage-"));
    const stockRoot = mkdtempSync(join(tmpdir(), "suite-stock-"));
    try {
      const frozen = freezeTrial(root, "booking");
      const task = readFrozenTask(root, frozen, "booking", 2);
      assert.match(task, /Round 1/);
      assert.match(task, /Round 2/);
      assert.doesNotMatch(task, /Round 3/);
      assert.match(readFrozenGuidelines(root, frozen, "booking"), /BadDate/);
      const stock = freezeTrial(stockRoot, "stock");
      assert.match(readFrozenTask(stockRoot, stock, "stock", 1), /Stock moves/);
      const planRoot = mkdtempSync(join(tmpdir(), "suite-plan-"));
      try {
        const plan = freezeTrial(planRoot, "plan");
        assert.match(readFrozenTask(planRoot, plan, "plan", 1), /Learning plan/);
        assert.match(readFrozenGuidelines(planRoot, plan, "plan"), /useData and runs operations/);
      } finally {
        rmSync(planRoot, { recursive: true, force: true });
      }
      const loansRoot = mkdtempSync(join(tmpdir(), "suite-loans-"));
      try {
        const loans = freezeTrial(loansRoot, "loans");
        assert.match(readFrozenTask(loansRoot, loans, "loans", 1), /Tool library/);
        assert.match(
          readFrozenGuidelines(loansRoot, loans, "loans"),
          /useData and runs operations/,
        );
      } finally {
        rmSync(loansRoot, { recursive: true, force: true });
      }
      const ballotRoot = mkdtempSync(join(tmpdir(), "suite-ballot-"));
      try {
        const ballot = freezeTrial(ballotRoot, "ballot");
        assert.match(readFrozenTask(ballotRoot, ballot, "ballot", 1), /Team poll/);
        assert.match(
          readFrozenGuidelines(ballotRoot, ballot, "ballot"),
          /useData and runs operations/,
        );
      } finally {
        rmSync(ballotRoot, { recursive: true, force: true });
      }
      const kitchenRoot = mkdtempSync(join(tmpdir(), "suite-kitchen-"));
      try {
        const kitchen = freezeTrial(kitchenRoot, "kitchen");
        assert.match(readFrozenTask(kitchenRoot, kitchen, "kitchen", 1), /Kitchen queue/);
        assert.match(
          readFrozenGuidelines(kitchenRoot, kitchen, "kitchen"),
          /useData and runs operations/,
        );
      } finally {
        rmSync(kitchenRoot, { recursive: true, force: true });
      }
      const lockerRoot = mkdtempSync(join(tmpdir(), "suite-locker-"));
      try {
        const locker = freezeTrial(lockerRoot, "locker");
        assert.match(readFrozenTask(lockerRoot, locker, "locker", 1), /Parcel locker/);
        assert.match(
          readFrozenGuidelines(lockerRoot, locker, "locker"),
          /`ctx.rawInput` holds the caller.s\s+value/,
        );
      } finally {
        rmSync(lockerRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stockRoot, { recursive: true, force: true });
    }
  });

  void it("stages the frozen gate beside the broker so the worker broker loads", async () => {
    const root = mkdtempSync(join(tmpdir(), "suite-tools-"));
    const ext = mkdtempSync(join(tmpdir(), "suite-ext-"));
    try {
      const frozen = freezeTrial(root, "plan");
      copyTrialTools(join(root, frozen.dir, "tools"), ext);
      const broker = await import(pathToFileURL(join(ext, "broker.mjs")).href);
      assert.equal(typeof broker.createBroker, "function");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(ext, { recursive: true, force: true });
    }
  });

  void it("freezes the worker limits so live config cannot drift stage", () => {
    const root = mkdtempSync(join(tmpdir(), "suite-limits-"));
    try {
      const frozen = freezeTrial(root, "stock");
      assert.ok(frozen.files["config.json"]);
      // A changed live config object cannot move the frozen read.
      const live = { limits: { ...frozenConfigFor(root, frozen).limits, toolCalls: 1 } };
      assert.notEqual(live.limits.toolCalls, limitsFor({ frozen }, live, root).toolCalls);
      assert.equal(
        limitsFor({ frozen }, live, root).toolCalls,
        frozenConfigFor(root, frozen).limits.toolCalls,
      );
      // Old trials with no frozen/ still read the live config.
      assert.equal(limitsFor({}, live, root).toolCalls, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  void it("names one task file per round, no false round 5 for legacy", () => {
    assert.equal(taskFileFor("stock", 1), "01-stock-moves.md");
    assert.equal(taskFileFor("plan", 1), "01-learning-plan.md");
    assert.equal(taskFileFor("loans", 1), "01-tool-library.md");
    assert.equal(taskFileFor("ballot", 1), "01-team-poll.md");
    assert.equal(taskFileFor("kitchen", 1), "01-kitchen-queue.md");
    assert.equal(taskFileFor("locker", 1), "01-parcel-locker.md");
    assert.equal(taskFileFor("booking", 5), "05-rename-series.md");
    assert.throws(() => taskFileFor("stock", 2), /no round/);
    assert.throws(() => taskFileFor("plan", 2), /no round/);
    assert.throws(() => taskFileFor("loans", 2), /no round/);
    assert.throws(() => taskFileFor("ballot", 2), /no round/);
    assert.throws(() => taskFileFor("kitchen", 2), /no round/);
    assert.throws(() => taskFileFor("locker", 2), /no round/);
    assert.deepEqual(validRounds({}), [1, 2, 3, 4]);
    assert.deepEqual(
      validRounds({ suite: "booking", frozen: { dir: "f", files: {} } }),
      [1, 2, 3, 4, 5],
    );
  });
});
