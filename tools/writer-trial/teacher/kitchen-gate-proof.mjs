// Jev gate proof for the kitchen queue reference app.
// Judges every src/ and tests/ file of the teacher fixture through the same
// judgeSource + gateFiles path the broker and review.mjs check use: the
// repo's tools/jev, the judges in config.json, and real Jev (key from
// tools/jev/lib.mjs loadKey). Then it judges three copies, each with one
// planted bug: blank qty text becomes 1, the already-cooking check runs
// after the stove-full guard, and one `value as string` cast in src.
// Usage: node tools/writer-trial/teacher/kitchen-gate-proof.mjs
// Exit 0 only when the fixture gate is `pass`, the blank-qty copy is
// `block` with inputDefaultMasks among the blocking findings, the moved
// already-cooking copy is `block` with noOpRejected among them, and the
// cast copy is `block` on the plain rule S17.
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
const fixture = join(here, "kitchen-fixture");

// Planted bug 1: the same line the (a) canary adds.
const PARSER = "function readQty(raw: unknown): number {\n";
const BLANK_QTY = [
  "model.ts",
  PARSER,
  `${PARSER}  if (typeof raw === "string" && raw.trim() === "") return 1;\n`,
];

// Planted bug 2: the same swap the (b) canary makes.
const ALREADY_COOKING = '    if (ticket.state === "cooking") return ticket;\n';
const START_GUARDS = [
  '    if (ticket.state === "served") throw fail("AlreadyServed", { id: ticket.id });\n',
  "    const size = cells.stove.get();\n",
  '    if (cookingCount(rows) >= size) throw fail("StoveFull", { size });\n',
].join("");
const MOVED_COOKING = ["model.ts", ALREADY_COOKING + START_GUARDS, START_GUARDS + ALREADY_COOKING];

// Planted bug 3: one type assertion in app source.
const CAST = [
  "screen.ts",
  "draft.update((text) => ({ ...text, table: input.value }));",
  "draft.update((text) => ({ ...text, table: input.value as string }));",
];

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

// Every answer from the two planted judges, hit or not, for the units the
// plants touch: the evidence when a copy does not block.
const PROBED = {
  inputDefaultMasks: ["readQty", "readTable", "readSize", "readDish", "findTicket", "addTicket"],
  noOpRejected: ["startCooking", "serveTicket", "setStove"],
};
const probe = (label, { reports }) => {
  for (const report of reports)
    for (const row of report.rows ?? [])
      for (const finding of row.findings ?? [])
        if ((PROBED[finding.id] ?? []).includes(row.unit))
          console.log(
            `  probe ${label} ${report.file} ${row.unit} ${finding.id} p=${finding.probability} threshold ${finding.threshold} (${finding.calibration})`,
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

// A copy of the fixture's src/ with one swap in one file. The anchor must
// match exactly once, so a moved fixture line fails loudly.
const plantedCopy = ([file, from, to]) => {
  const dir = mkdtempSync(join(tmpdir(), "kitchen-gate-"));
  cpSync(join(fixture, "src"), join(dir, "src"), { recursive: true });
  const path = join(dir, "src", file);
  const text = readFileSync(path, "utf8");
  if (text.split(from).length !== 2) throw new Error(`${file} anchor moved; update the script`);
  writeFileSync(path, text.replace(from, to));
  return dir;
};

const judgePlanted = async (swap, ask) => {
  const copy = plantedCopy(swap);
  try {
    return await judgeApp(copy, ask);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

const blocksOn = (result, judge) =>
  result.gate.status === "block" && result.gate.blocking.some((item) => item.judge === judge);
const blocksOnRule = (result, rule) =>
  result.gate.status === "block" && result.gate.blocking.some((item) => item.rule === rule);

const ask = await jevAsk(jevDir);
const good = await judgeApp(fixture, ask);
show("reference fixture", good);
probe("reference", good);
const blank = await judgePlanted(BLANK_QTY, ask);
show("planted blank-qty-to-1 copy", blank);
probe("blank-qty", blank);
const moved = await judgePlanted(MOVED_COOKING, ask);
show("planted already-cooking-after-stove-full copy", moved);
probe("already-cooking", moved);
const cast = await judgePlanted(CAST, ask);
show("planted value-as-string copy", cast);

const goodOk = good.gate.status === "pass";
const blankOk = blocksOn(blank, "inputDefaultMasks");
const movedOk = blocksOn(moved, "noOpRejected");
const castOk = blocksOnRule(cast, "S17");
console.log(`PROOF reference fixture passes: ${goodOk ? "yes" : "NO"}`);
console.log(`PROOF blank-qty copy blocks on inputDefaultMasks: ${blankOk ? "yes" : "NO"}`);
console.log(`PROOF already-cooking copy blocks on noOpRejected: ${movedOk ? "yes" : "NO"}`);
console.log(`PROOF value-as-string copy blocks on S17: ${castOk ? "yes" : "NO"}`);
process.exitCode = goodOk && blankOk && movedOk && castOk ? 0 : 1;
