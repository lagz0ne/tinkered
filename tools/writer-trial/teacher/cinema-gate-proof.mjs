// Jev gate proof for the cinema seat map reference app.
// Judges every src/ and tests/ file of the teacher fixture through the same
// judgeSource + gateFiles path the broker and review.mjs check use: the
// repo's tools/jev, the judges in config.json, and real Jev (key from
// tools/jev/lib.mjs loadKey). Then it judges three copies, each with one
// planted bug: blank number text becomes number 1, the same-customer check
// runs after the SeatLimit guard, and one `value as string` cast in src.
// Usage: node tools/writer-trial/teacher/cinema-gate-proof.mjs
// Exit 0 only when the fixture gate is `pass`, the blank-number copy is
// `block` with inputDefaultMasks among the blocking findings, the moved
// same-customer copy is `block` with noOpRejected among them, and the cast
// copy is `block` on the plain rule S17.
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
const fixture = join(here, "cinema-fixture");

// Planted bug 1: the same line the (a) canary adds.
const PARSER = "function readNumber(raw: unknown): number {\n";
const BLANK_NUMBER = [
  "model.ts",
  PARSER,
  `${PARSER}  if (typeof raw === "string" && raw.trim() === "") return 1;\n`,
];

// Planted bug 2: the same swap the (b) canary makes.
const SAME_CUSTOMER =
  '      if (seat.state === "held" && seat.customer === customer) return seat;\n';
const LIMIT_GUARD = [
  "      if (rows.filter((each) => each.customer === customer).length >= SEAT_LIMIT)\n",
  '        throw fail("SeatLimit", { customer });\n',
].join("");
const MOVED_SAME = ["model.ts", SAME_CUSTOMER + LIMIT_GUARD, LIMIT_GUARD + SAME_CUSTOMER];

// Planted bug 3: one type assertion in app source.
const CAST = [
  "screen.ts",
  "draft.update((text) => ({ ...text, number: input.value }));",
  "draft.update((text) => ({ ...text, number: input.value as string }));",
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
  inputDefaultMasks: [
    "fieldOf",
    "readRow",
    "readNumber",
    "readCustomer",
    "findSeat",
    "holdSeat",
    "buySeats",
    "releaseSeat",
  ],
  noOpRejected: ["holdSeat", "buySeats", "releaseSeat"],
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
  const dir = mkdtempSync(join(tmpdir(), "cinema-gate-"));
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

// `--only reference` judges the fixture alone while tuning; a full run is the proof.
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : "";
const ask = await jevAsk(jevDir);
const good = await judgeApp(fixture, ask);
show("reference fixture", good);
probe("reference", good);
const goodOk = good.gate.status === "pass";
console.log(`PROOF reference fixture passes: ${goodOk ? "yes" : "NO"}`);
if (only === "reference") {
  process.exitCode = goodOk ? 0 : 1;
} else {
  const blank = await judgePlanted(BLANK_NUMBER, ask);
  show("planted blank-number-to-1 copy", blank);
  probe("blank-number", blank);
  const moved = await judgePlanted(MOVED_SAME, ask);
  show("planted same-customer-after-SeatLimit copy", moved);
  probe("same-customer", moved);
  const cast = await judgePlanted(CAST, ask);
  show("planted value-as-string copy", cast);

  const blankOk = blocksOn(blank, "inputDefaultMasks");
  const movedOk = blocksOn(moved, "noOpRejected");
  const castOk = blocksOnRule(cast, "S17");
  console.log(`PROOF blank-number copy blocks on inputDefaultMasks: ${blankOk ? "yes" : "NO"}`);
  console.log(`PROOF same-customer copy blocks on noOpRejected: ${movedOk ? "yes" : "NO"}`);
  console.log(`PROOF value-as-string copy blocks on S17: ${castOk ? "yes" : "NO"}`);
  process.exitCode = goodOk && blankOk && movedOk && castOk ? 0 : 1;
}
