// The folder gate's plain-code part. No model call: the gate asks no judge,
// and its `ask` fails the test if anything calls it anyway.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exitCodeOf, gateFolder, judgedFiles, summaryOf } from "./folder.mjs";

const jevDir = fileURLToPath(new URL("../jev/", import.meta.url));
const appGate = fileURLToPath(new URL("app-gate.mjs", import.meta.url));
const noModel = () => assert.fail("the plain-code gate called the model");
const plainGate = (root) => gateFolder(root, { jevDir, judges: [], ask: noModel });

/** A folder holding `files` (relative path → text). */
function fixture(base, name, files) {
  const root = join(base, name);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/** The app-gate CLI's exit code and output. The key is out of reach: no model call. */
function runAppGate(args) {
  const env = { ...process.env, JEV_TOKEN_FILE: "/nonexistent/jev-token" };
  delete env.AI_GATEWAY_API_KEY;
  try {
    return { exit: 0, out: execFileSync("node", [appGate, ...args], { env, encoding: "utf8" }) };
  } catch (error) {
    return { exit: error.status, out: error.stdout };
  }
}

void describe("the folder gate", () => {
  let base;
  before(() => {
    base = mkdtempSync(join(tmpdir(), "folder-gate-"));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  void it("blocks on a shape finding with exit 1 and names its rule, line, and fix", async () => {
    const root = fixture(base, "cast", {
      "src/ids.ts": "export function idOf(v: unknown): string {\n  return v as string;\n}\n",
    });
    const { gate } = await plainGate(root);
    assert.equal(exitCodeOf(gate), 1);
    assert.deepEqual(
      gate.blocking.map((item) => [item.file, item.rule, item.line]),
      [["src/ids.ts", "S17", 2]],
    );
    assert.match(summaryOf(gate), /src\/ids\.ts\n {2}block S17 line 2: type assertion/);
  });

  void it("passes a clean folder with exit 0", async () => {
    const root = fixture(base, "clean", {
      "src/sum.ts": "export function sum(a: number, b: number): number {\n  return a + b;\n}\n",
      "tests/sum.test.ts": 'test("adds", () => {\n  expect(sum(1, 2)).toBe(3);\n});\n',
    });
    const { files, gate } = await plainGate(root);
    assert.deepEqual(files, ["src/sum.ts", "tests/sum.test.ts"]);
    assert.equal(exitCodeOf(gate), 0);
    assert.match(summaryOf(gate), /blocking 0, advice 0, unavailable 0\ngate: pass\n$/);
  });

  void it("judges only .ts and .tsx files below src/ and tests/", () => {
    const root = fixture(base, "mixed", {
      "src/view.tsx": "export const one = 1;\n",
      "src/notes.md": "# notes\n",
      "tests/helper.ts": "export const two = 2;\n",
      "vite.config.ts": "export default {};\n",
    });
    assert.deepEqual(judgedFiles(root), ["src/view.tsx", "tests/helper.ts"]);
  });

  void it("is unavailable with exit 2 for a link that leaves the folder", async () => {
    const outside = fixture(base, "outside", { "src/real.ts": "export const one = 1;\n" });
    const root = fixture(base, "linked", {});
    mkdirSync(join(root, "src"), { recursive: true });
    symlinkSync(join(outside, "src/real.ts"), join(root, "src/real.ts"));
    const { gate } = await plainGate(root);
    assert.equal(exitCodeOf(gate), 2);
    assert.deepEqual(gate.reasons, ["src/real.ts: not a regular file inside the judged folder"]);
  });

  void it("is unavailable with exit 2 when the folder has nothing to judge", async () => {
    const { gate } = await plainGate(fixture(base, "empty", { "README.md": "# empty\n" }));
    assert.equal(exitCodeOf(gate), 2);
    assert.deepEqual(gate.reasons, ["no files judged"]);
  });

  void it("exits 2 from the command when the Jev key is missing, never 0", () => {
    const root = fixture(base, "no-key", { "src/one.ts": "export const one = 1;\n" });
    const { exit, out } = runAppGate([root]);
    assert.equal(exit, 2);
    assert.match(out, /unavailable jev: Jev unavailable: missing credentials\n/);
  });
});
