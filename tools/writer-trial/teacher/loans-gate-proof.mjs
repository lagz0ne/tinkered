// Jev gate proof for the tool library reference app.
// Judges every src/ and tests/ file of the teacher fixture through the same
// judgeSource + gateFiles path the broker and review.mjs check use: the
// repo's tools/jev, the judges in config.json, and real Jev (key from
// tools/jev/lib.mjs loadKey). Then it judges a copy with one planted bug
// in the copies parser (blank text becomes 1).
// Usage: node tools/writer-trial/teacher/loans-gate-proof.mjs
// Exit 0 only when the fixture gate is `pass` and the planted copy is
// `block` with inputDefaultMasks among the blocking findings.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeSource, jevAsk } from "../broker.mjs";
import { gateFiles } from "../gate.mjs";
import { listFiles } from "../suite.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const trialDir = resolve(here, "..");
const jevDir = resolve(trialDir, "../jev");
const { judges } = JSON.parse(readFileSync(join(trialDir, "config.json"), "utf8"));
const fixture = join(here, "loans-fixture");

// The planted bug: the same line the (a) canary adds.
const PARSER = "function readCopies(raw: unknown): number {\n";
const PLANTED = `${PARSER}  if (typeof raw === "string" && raw.trim() === "") return 1;\n`;

const judgedFiles = (root) =>
  ["src", "tests"].flatMap((dir) =>
    listFiles(join(root, dir))
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => `${dir}/${file}`),
  );

const judgeApp = async (root, ask) => {
  const reports = [];
  for (const file of judgedFiles(root)) {
    const source = readFileSync(join(root, file), "utf8");
    reports.push(await judgeSource({ source, file, jevDir, judges, ask }));
  }
  return { files: reports.length, reports, gate: gateFiles(reports) };
};

// Every inputDefaultMasks answer, hit or not, for the units that parse
// copies: the evidence when the planted copy does not block.
const PROBED = ["readCopies", "addTool", "setCopies"];
const probe = (label, { reports }) => {
  for (const report of reports)
    for (const row of report.rows.filter((r) => PROBED.includes(r.unit)))
      for (const finding of (row.findings ?? []).filter((f) => f.id === "inputDefaultMasks"))
        console.log(
          `  probe ${label} ${report.file} ${row.unit} inputDefaultMasks p=${finding.probability} threshold ${finding.threshold} (${finding.calibration})`,
        );
};

const itemLine = (item) =>
  item.rule
    ? `${item.file}:${item.line} ${item.rule} (plain shape finding)`
    : `${item.file} ${item.unit} ${item.judge} p=${item.probability} (${item.calibration})`;

const show = (label, { files, gate }) => {
  console.log(`GATE ${label}: status ${gate.status} over ${files} file(s)`);
  for (const item of gate.blocking) console.log(`  blocking ${itemLine(item)}`);
  for (const item of gate.advice) console.log(`  advice   ${itemLine(item)}`);
  for (const reason of gate.reasons) console.log(`  reason   ${reason}`);
};

const plantedCopy = () => {
  const dir = mkdtempSync(join(tmpdir(), "loans-gate-"));
  cpSync(join(fixture, "src"), join(dir, "src"), { recursive: true });
  const model = join(dir, "src", "model.ts");
  const text = readFileSync(model, "utf8");
  if (text.split(PARSER).length !== 2) throw new Error("parser anchor moved; update the script");
  writeFileSync(model, text.replace(PARSER, PLANTED));
  return dir;
};

const ask = await jevAsk(jevDir);
const good = await judgeApp(fixture, ask);
show("reference fixture", good);
probe("reference", good);
const copy = plantedCopy();
let bad;
try {
  bad = await judgeApp(copy, ask);
} finally {
  rmSync(copy, { recursive: true, force: true });
}
show("planted blank-copies-to-1 copy", bad);
probe("planted", bad);

const goodOk = good.gate.status === "pass";
const caught = bad.gate.blocking.some((item) => item.judge === "inputDefaultMasks");
const badOk = bad.gate.status === "block" && caught;
console.log(`PROOF reference fixture passes: ${goodOk ? "yes" : "NO"}`);
console.log(`PROOF planted copy blocks on inputDefaultMasks: ${badOk ? "yes" : "NO"}`);
process.exitCode = goodOk && badOk ? 0 : 1;
