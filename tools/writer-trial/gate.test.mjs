// The writer-trial Jev gate. No docker, no network: judgeSource gets
// a fake `ask` that answers like Jev, over a copy of tools/jev with a
// fixture calibration.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { confirmNearBar, judgeSource } from "./broker.mjs";
import { gateFiles, gateOf, machineVerdict } from "./gate.mjs";

const jevSource = fileURLToPath(new URL("../jev/", import.meta.url));

const finding = (id, probability, calibration) => ({
  id,
  probability,
  hit: probability >= 0.5,
  calibration,
});

const report = ({ findings = [], plainFindings = [], rows } = {}) => ({
  file: "src/app.ts",
  rows: rows ?? [{ unit: "app", findings }],
  plainFindings,
});

/** Answers every question like Jev: `hits` get 0.9, the rest 0.1. */
const fakeAsk = (hits, seen = []) => {
  return async (state, questions) => {
    seen.push(state);
    return Object.fromEntries(
      Object.keys(questions).map((id) => [id, { probability: hits.includes(id) ? 0.9 : 0.1 }]),
    );
  };
};

void describe("the Jev gate", () => {
  let jevDir;
  before(() => {
    jevDir = mkdtempSync(join(tmpdir(), "gate-jev-"));
    for (const file of ["lib.mjs", "bank.mjs", "extract.mjs", "shape.mjs", "plain.mjs"])
      copyFileSync(join(jevSource, file), join(jevDir, file));
    symlinkSync(join(jevSource, "node_modules"), join(jevDir, "node_modules"));
    // A frozen trial's bank may still carry a test judge (the live bank retired titleVague).
    appendFileSync(
      join(jevDir, "bank.mjs"),
      'TESTS.frozenTestJudge = { threshold: 0.5, q: { type: "boolean", instructions: "Is it bad?", criteria: { true: "bad", false: "fine" } } };\n',
    );
    writeFileSync(
      join(jevDir, "calibration.json"),
      JSON.stringify({ partialStub: { status: "proven" }, leakedInternal: { status: "noisy" } }),
    );
  });
  after(() => rmSync(jevDir, { recursive: true, force: true }));

  void it("blocks on a hit from a proven judge", () => {
    const gate = gateOf(report({ findings: [finding("partialStub", 0.8, "proven")] }));
    assert.equal(gate.status, "block");
    assert.deepEqual(gate.blocking, [
      {
        file: "src/app.ts",
        unit: "app",
        judge: "partialStub",
        probability: 0.8,
        calibration: "proven",
        fix: null,
      },
    ]);
  });

  void it("passes a hit from a provisional, noisy, or uncalibrated judge as advice", () => {
    const gate = gateOf(
      report({
        findings: [
          finding("titleVague", 0.9, "provisional"),
          finding("configNotTag", 0.9, "noisy"),
          finding("newJudge", 0.9, "uncalibrated"),
        ],
      }),
    );
    assert.equal(gate.status, "pass");
    assert.deepEqual(
      gate.advice.map((item) => item.judge),
      ["titleVague", "configNotTag", "newJudge"],
    );
  });

  void it("passes a proven judge answer below its threshold", () => {
    const gate = gateOf(report({ findings: [finding("partialStub", 0.3, "proven")] }));
    assert.deepEqual(gate, { status: "pass", blocking: [], advice: [], reasons: [] });
  });

  void it("blocks on a plain shape finding", () => {
    const shape = { id: "no-scope-prop", line: 4, message: "scope in view props" };
    const gate = gateOf(report({ plainFindings: [shape] }));
    assert.equal(gate.status, "block");
    assert.deepEqual(gate.blocking, [
      {
        file: "src/app.ts",
        line: 4,
        rule: "no-scope-prop",
        message: "scope in view props",
        fix: "scope in view props",
      },
    ]);
  });

  void it("is unavailable, not a pass, when a unit was not run", () => {
    const rows = [{ unit: "app", status: "not-run", reason: "Jev call limit reached" }];
    const gate = gateOf(report({ rows }));
    assert.equal(gate.status, "unavailable");
    assert.deepEqual(gate.reasons, ["src/app.ts app: Jev call limit reached"]);
  });

  void it("is unavailable when a file could not be judged", () => {
    const gate = gateOf({ file: "src/big.ts", error: "file exceeds 40000 characters" });
    assert.equal(gate.status, "unavailable");
  });

  void it("lets one unavailable file outrank a blocking file", () => {
    const blocked = report({ findings: [finding("partialStub", 0.8, "proven")] });
    const missing = { file: "src/b.ts", error: "Jev unavailable: missing credentials" };
    assert.equal(gateFiles([blocked, missing]).status, "unavailable");
  });

  void it("is unavailable when no file was judged", () => {
    assert.equal(gateFiles([]).status, "unavailable");
  });

  void it("judges a source file into a gate that blocks on the proven judge", async () => {
    const judged = await judgeSource({
      source: "export function add(a: number, b: number) { return a + b; }\n",
      file: "src/add.ts",
      jevDir,
      judges: ["partialStub", "leakedInternal"],
      ask: fakeAsk(["partialStub", "leakedInternal"]),
    });
    const gate = gateOf(judged);
    assert.equal(gate.status, "block");
    assert.deepEqual(
      gate.blocking.map((item) => item.judge),
      ["partialStub"],
    );
    assert.deepEqual(
      gate.advice.map((item) => item.judge),
      ["leakedInternal"],
    );
  });

  void it("tells the writer how to clear a blocking Jev hit with the judge's fix line", async () => {
    const judged = await judgeSource({
      source: "export function add(a: number, b: number) { return a + b; }\n",
      file: "src/add.ts",
      jevDir,
      judges: ["partialStub"],
      ask: fakeAsk(["partialStub"]),
    });
    const bank = await import(pathToFileURL(join(jevDir, "lib.mjs")).href);
    assert.deepEqual(
      gateOf(judged).blocking.map((item) => item.fix),
      [bank.JUDGES.partialStub.fix],
    );
  });

  void it("tells the writer how to clear a plain rule break with its message", async () => {
    const judged = await judgeSource({
      source: 'test("x", () => {\n  expect(isError(e, "X")).toBe(true);\n});\n',
      file: "tests/app.test.ts",
      jevDir,
      judges: [],
      ask: fakeAsk([]),
    });
    const [item] = gateOf(judged).blocking;
    assert.match(item.fix, /narrow with isError in an if/);
  });

  void it("blocks on a type assertion in writer source (S17)", async () => {
    const judged = await judgeSource({
      source: "export function idOf(v: unknown): string {\n  return v as string;\n}\n",
      file: "src/ids.ts",
      jevDir,
      judges: [],
      ask: fakeAsk([]),
    });
    assert.deepEqual(
      gateOf(judged).blocking.map((item) => [item.rule, item.line]),
      [["S17", 2]],
    );
  });

  void it("blocks on isError inside expect in a test file (T08)", async () => {
    const judged = await judgeSource({
      source: 'test("x", () => {\n  expect(isError(e, "X")).toBe(true);\n});\n',
      file: "tests/app.test.ts",
      jevDir,
      judges: ["frozenTestJudge"],
      ask: fakeAsk([]),
    });
    const gate = gateOf(judged);
    assert.equal(gate.status, "block");
    assert.deepEqual(
      gate.blocking.map((item) => [item.rule, item.line]),
      [["T08", 2]],
    );
  });

  void it("sends each test as title, causes, asserts, narrows, and body", async () => {
    const seen = [];
    await judgeSource({
      source: 'test("adds two numbers", () => { expect(add(1, 2)).toBe(3); });\n',
      file: "tests/add.test.ts",
      jevDir,
      judges: ["frozenTestJudge"],
      ask: fakeAsk([], seen),
    });
    assert.deepEqual(seen, [
      {
        title: "adds two numbers",
        causes: [],
        asserts: ["add(1, 2).toBe(3)"],
        narrows: [],
        body: "{ expect(add(1, 2)).toBe(3); }",
      },
    ]);
  });

  void it("records a unit not-run once the call limit says stop", async () => {
    const judged = await judgeSource({
      source: "export function add(a: number, b: number) { return a + b; }\n",
      file: "src/add.ts",
      jevDir,
      judges: ["partialStub"],
      ask: fakeAsk([]),
      allow: () => "Jev call limit reached",
    });
    assert.equal(gateOf(judged).status, "unavailable");
  });
});

void describe("the machine verdict", () => {
  const blocked = { status: "block", blocking: [], advice: [], reasons: [] };

  void it("fails a snapshot the gate blocks even when own and teacher checks pass", () => {
    assert.equal(machineVerdict({ ownExit: 0, teacherExit: 0, gate: blocked }), "machine-fail");
  });

  void it("fails a snapshot whose gate is unavailable", () => {
    const gate = { ...blocked, status: "unavailable" };
    assert.equal(machineVerdict({ ownExit: 0, teacherExit: 0, gate }), "machine-fail");
  });

  void it("keeps an old trial with no frozen Jev copy on own and teacher exits", () => {
    assert.equal(machineVerdict({ ownExit: 0, teacherExit: 0, gate: null }), "machine-pass");
  });
});

void describe("a blocking answer near its bar", () => {
  const candidates = {
    noOp: { threshold: 0.66, q: { type: "boolean" } },
    advice: { threshold: 0.5, q: { type: "boolean" } },
  };
  const calibration = { noOp: { status: "proven" }, advice: { status: "provisional" } };
  const asker = (answers) => {
    const asked = [];
    const next = async (qs) => {
      asked.push(Object.keys(qs));
      const p = answers.shift();
      return Object.fromEntries(Object.keys(qs).map((id) => [id, { probability: p }]));
    };
    return { asked, next };
  };

  void it("uses the median of three asks for a proven judge within the margin", async () => {
    const { asked, next } = asker([0.8, 0.7]);
    const p = await confirmNearBar({ noOp: { probability: 0.6 } }, candidates, calibration, next);
    assert.equal(p.noOp, 0.7);
    assert.deepEqual(asked, [["noOp"], ["noOp"]]);
  });

  void it("asks nothing more when the answer is clear of the bar", async () => {
    const { asked, next } = asker([]);
    const p = await confirmNearBar({ noOp: { probability: 0.9 } }, candidates, calibration, next);
    assert.equal(p.noOp, 0.9);
    assert.deepEqual(asked, []);
  });

  void it("asks nothing more for a judge that is not proven", async () => {
    const { asked, next } = asker([]);
    const p = await confirmNearBar(
      { advice: { probability: 0.52 } },
      candidates,
      calibration,
      next,
    );
    assert.equal(p.advice, 0.52);
    assert.deepEqual(asked, []);
  });
});
