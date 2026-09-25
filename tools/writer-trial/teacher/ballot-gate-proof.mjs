// Jev gate proof for the team poll reference app.
// Judges every src/ and tests/ file of the teacher fixture through the same
// judgeSource + gateFiles path the broker and review.mjs check use: the
// repo's tools/jev, the judges in config.json, and real Jev (key from
// tools/jev/lib.mjs loadKey). Then it judges two copies, each with one
// planted bug: blank limit text becomes 10, and the same-vote check runs
// after the closed-poll guard.
// Usage: node tools/writer-trial/teacher/ballot-gate-proof.mjs
// Exit 0 only when the fixture gate is `pass`, the blank-limit copy is
// `block` with inputDefaultMasks among the blocking findings, and the
// moved same-vote copy is `block` with noOpRejected among them.
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
const fixture = join(here, "ballot-fixture");

// Planted bug 1: the same line the (a) canary adds.
const PARSER = "function readLimit(raw: unknown): number {\n";
const BLANK_LIMIT = [
  PARSER,
  `${PARSER}  if (typeof raw === "string" && raw.trim() === "") return 10;\n`,
];

// Planted bug 2: the same swap the (b) canary makes.
const SAME_VOTE = "      if (held !== undefined && held.choice === choice) return held;\n";
const CLOSED_GUARD = '      if (poll.closed) throw fail("PollClosed", { id: poll.id });\n';
const MOVED_SAME_VOTE = [SAME_VOTE + CLOSED_GUARD, CLOSED_GUARD + SAME_VOTE];

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
  inputDefaultMasks: ["readLimit", "createPoll", "setLimit"],
  noOpRejected: ["castVote"],
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

// A copy of the fixture's src/ with one swap in model.ts. The anchor must
// match exactly once, so a moved fixture line fails loudly.
const plantedCopy = ([from, to]) => {
  const dir = mkdtempSync(join(tmpdir(), "ballot-gate-"));
  cpSync(join(fixture, "src"), join(dir, "src"), { recursive: true });
  const model = join(dir, "src", "model.ts");
  const text = readFileSync(model, "utf8");
  if (text.split(from).length !== 2) throw new Error("model anchor moved; update the script");
  writeFileSync(model, text.replace(from, to));
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

const ask = await jevAsk(jevDir);
const good = await judgeApp(fixture, ask);
show("reference fixture", good);
probe("reference", good);
const blank = await judgePlanted(BLANK_LIMIT, ask);
show("planted blank-limit-to-10 copy", blank);
probe("blank-limit", blank);
const moved = await judgePlanted(MOVED_SAME_VOTE, ask);
show("planted same-vote-after-closed copy", moved);
probe("same-vote", moved);

const goodOk = good.gate.status === "pass";
const blankOk = blocksOn(blank, "inputDefaultMasks");
const movedOk = blocksOn(moved, "noOpRejected");
console.log(`PROOF reference fixture passes: ${goodOk ? "yes" : "NO"}`);
console.log(`PROOF blank-limit copy blocks on inputDefaultMasks: ${blankOk ? "yes" : "NO"}`);
console.log(`PROOF same-vote copy blocks on noOpRejected: ${movedOk ? "yes" : "NO"}`);
process.exitCode = goodOk && blankOk && movedOk ? 0 : 1;
