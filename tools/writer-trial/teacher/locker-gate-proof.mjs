// Jev gate proof for the parcel locker reference app.
// Judges every src/ and tests/ file of the teacher fixture through the same
// judgeSource + gateFiles path the broker and review.mjs check use: the
// repo's tools/jev, the judges in config.json, and real Jev (key from
// tools/jev/lib.mjs loadKey). Then it judges three copies, each with one
// planted bug: blank locker text becomes locker 1, the same-locker check
// runs after the AlreadyStored guard, and one `value as string` cast in src.
// Usage: node tools/writer-trial/teacher/locker-gate-proof.mjs
// Exit 0 only when the fixture gate is `pass`, the blank-locker copy is
// `block` with inputDefaultMasks among the blocking findings, the moved
// same-locker copy is `block` with noOpRejected among them, and the cast
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
const fixture = join(here, "locker-fixture");

// Planted bug 1: the same line the (a) canary adds.
const PARSER = "function readLocker(raw: unknown): Locker {\n";
const BLANK_LOCKER = [
  "model.ts",
  PARSER,
  `${PARSER}  if (typeof raw === "string" && raw.trim() === "") return LOCKERS[0];\n`,
];

// Planted bug 2: the same swap the (b) canary makes.
const SAME_LOCKER = "      if (parcel.locker === locker.number) return parcel;\n";
const STORED_GUARD = [
  "      if (parcel.locker !== null)\n",
  '        throw fail("AlreadyStored", { id: parcel.id, locker: parcel.locker });\n',
].join("");
const MOVED_SAME = ["model.ts", SAME_LOCKER + STORED_GUARD, STORED_GUARD + SAME_LOCKER];

// Planted bug 3: one type assertion in app source.
const CAST = [
  "screen.ts",
  "draft.update((text) => ({ ...text, locker: input.value }));",
  "draft.update((text) => ({ ...text, locker: input.value as string }));",
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
    "readRecipient",
    "readSize",
    "readLocker",
    "findParcel",
    "receiveParcel",
    "storeParcel",
  ],
  noOpRejected: ["receiveParcel", "storeParcel", "collectParcel", "returnToDesk"],
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
  const dir = mkdtempSync(join(tmpdir(), "locker-gate-"));
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
  const blank = await judgePlanted(BLANK_LOCKER, ask);
  show("planted blank-locker-to-1 copy", blank);
  probe("blank-locker", blank);
  const moved = await judgePlanted(MOVED_SAME, ask);
  show("planted same-locker-after-AlreadyStored copy", moved);
  probe("same-locker", moved);
  const cast = await judgePlanted(CAST, ask);
  show("planted value-as-string copy", cast);

  const blankOk = blocksOn(blank, "inputDefaultMasks");
  const movedOk = blocksOn(moved, "noOpRejected");
  const castOk = blocksOnRule(cast, "S17");
  console.log(`PROOF blank-locker copy blocks on inputDefaultMasks: ${blankOk ? "yes" : "NO"}`);
  console.log(`PROOF same-locker copy blocks on noOpRejected: ${movedOk ? "yes" : "NO"}`);
  console.log(`PROOF value-as-string copy blocks on S17: ${castOk ? "yes" : "NO"}`);
  process.exitCode = goodOk && blankOk && movedOk && castOk ? 0 : 1;
}
