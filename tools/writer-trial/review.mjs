// Review loop for writer trials: save, check, feedback.
// Small commands over the trial manifest. No agents launched here.
// Launch stays through Paseo tools; the finish callback names files.
//
//   save <trial> <round> <worker> --session <pi-session.jsonl> --report <file>
//     Verify the container stopped (or fail unavailable), then save
//     one attempt as raw bytes: source archive, native session copy,
//     worker report copy, tool event copy, per-file hashes.
//     A second save without staged feedback refuses; it never
//     invents a new attempt number.
//   check <trial> <round> <worker> [--attempt N]
//     Run own check, test, build AND the suite teacher checker,
//     each recorded apart. An own failure still runs the teacher
//     checks: every case result is scored. A missing checker
//     script fails unavailable, never passes. Each repeat writes
//     a named check-N folder with checker hashes and the image ID.
//   feedback <trial> <round> <worker> --teacher <file>
//     Preflight every path first (no overwrites), then copy ONLY
//     teacher text into the attempt as feedback.md and into
//     /work/FEEDBACK.md, restage frozen task, rules, and tools,
//     refresh limits from the frozen config, and start a fresh
//     event log. Saved tries are kept. No model is launched here.
//
// Old trials without frozen/ keep working: save records the live task,
// check uses the repo-local scripts, feedback skips the restage.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  frozenConfigFor,
  guidelineSourcesFor,
  readFrozenGuidelines,
  readFrozenTask,
  suiteFor,
  verifyFrozen,
} from "./suite.mjs";
import {
  attemptDir,
  checkerFor,
  checkName,
  claimLock,
  feedbackEventsPath,
  latestAttempt,
  nextAttempt,
  nextCheckSeq,
  planSave,
} from "./attempts.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const home = join(homedir(), ".local/share/tinker-writer-trial");
const [command, name, roundText, workerText] = process.argv.slice(2);
if (!["save", "check", "feedback"].includes(command ?? ""))
  throw new Error("Use review.mjs save|check|feedback");
if (!/^[a-z0-9-]+$/.test(name ?? "")) throw new Error("Use a short trial name");
const round = Number(roundText);
if (!Number.isInteger(round) || round < 1) throw new Error("Pass the staged round number");
const workerNum = Number(workerText);
if (!Number.isInteger(workerNum) || workerNum < 1)
  throw new Error("Pass the worker number, 1-based");

const root = join(home, name);
const manifestPath = join(root, "manifest.json");
// One manifest writer at a time: fail busy instead of losing a
// parallel save or check to a stale overwrite.
const release = claimLock(root);
process.on("exit", () => {
  try {
    release();
  } catch {}
});
const manifest = JSON.parse(readFileSync(manifestPath));
const suite = suiteFor(manifest);
const worker = manifest.workers[workerNum - 1];
if (!worker) throw new Error(`No worker ${workerNum} in this trial`);
if (manifest.round !== undefined && manifest.round !== round)
  throw new Error(`Trial is on round ${manifest.round}; save that round first`);
if (manifest.frozen) verifyFrozen(root, manifest.frozen);

const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const rows = (worker.attempts ??= []);
const flag = (key) => {
  const at = process.argv.indexOf(`--${key}`);
  const path = at === -1 ? null : process.argv[at + 1];
  if (!path || !existsSync(path)) throw new Error(`Pass --${key} <path>`);
  return path;
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const runText = (bin, args, input, timeout = 330000) =>
  input === undefined
    ? execFileSync(bin, args, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 })
    : execFileSync(bin, args, { input, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
// Raw bytes for docker cp: tar output must never pass through text.
const runBytes = (bin, args, input, timeout = 120000) =>
  input === undefined
    ? execFileSync(bin, args, { timeout, maxBuffer: 128 * 1024 * 1024 })
    : execFileSync(bin, args, { input, timeout, maxBuffer: 128 * 1024 * 1024 });
const frozenPath = (rel) => join(root, manifest.frozen.dir, rel);

// Stop, then prove the container is down. A container that keeps
// running fails unavailable: its archive would be a moving target.
const stopWorker = () => {
  try {
    runText("docker", ["stop", "-t", "1", worker.container], undefined, 30000);
  } catch (error) {
    throw new Error(`Stop unavailable for ${worker.container}: ${error.message}`);
  }
  const state = runText(
    "docker",
    ["inspect", worker.container, "--format", "{{.State.Running}}"],
    undefined,
    30000,
  ).trim();
  if (state !== "false") throw new Error(`Container still running: ${worker.container}`);
};

if (command === "save") {
  // Flags first: a bad call must not claim the attempt folder.
  const session = flag("session");
  const report = flag("report");
  const agentAt = process.argv.indexOf("--agent");
  const agentId = agentAt === -1 ? (worker.agentId ?? null) : process.argv[agentAt + 1];
  const plan = planSave(worker, round);
  const dir = attemptDir(root, round, workerNum, plan.attempt);
  if (existsSync(dir)) throw new Error(`Attempt folder exists; refusing overwrite: ${dir}`);
  // The live event log comes from the worker config, which feedback
  // moves to a fresh retry log. The manifest round path is stale.
  const cfgPath = join(worker.dir, ".pi/extensions/trial/worker.json");
  const eventsSrc = existsSync(cfgPath) ? (JSON.parse(readFileSync(cfgPath)).events ?? null) : null;
  if (eventsSrc && !existsSync(eventsSrc)) throw new Error(`Event log missing: ${eventsSrc}`);
  // Claim the folder only after every check above passes.
  mkdirSync(join(dir, ".."), { recursive: true });
  mkdirSync(dir);
  // Paseo launches happen outside this file; the finish callback
  // passes the completed agent id and these saved file paths.
  stopWorker();
  const archive = join(dir, "archive.tar");
  try {
    writeFileSync(archive, runBytes("docker", ["cp", `${worker.container}:/work/.`, "-"]));
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Archive unavailable: ${error.message}`);
  }
  copyFileSync(session, join(dir, "session.jsonl"));
  copyFileSync(report, join(dir, "report.md"));
  if (eventsSrc) copyFileSync(eventsSrc, join(dir, "events.jsonl"));
  const frozen = manifest.frozen ?? null;
  writeFileSync(
    join(dir, "hashes.json"),
    JSON.stringify(
      {
        archive: sha256(archive),
        session: sha256(join(dir, "session.jsonl")),
        report: sha256(join(dir, "report.md")),
        events: existsSync(join(dir, "events.jsonl")) ? sha256(join(dir, "events.jsonl")) : null,
        suiteFiles: frozen ? { ...frozen.files } : null,
      },
      null,
      2,
    ) + "\n",
  );
  rows.push({
    round,
    attempt: plan.attempt,
    agentId,
    suite,
    frozen: frozen ? { ...frozen.files } : null,
    archive,
    session: join(dir, "session.jsonl"),
    report: join(dir, "report.md"),
    events: existsSync(join(dir, "events.jsonl")) ? join(dir, "events.jsonl") : null,
    stoppedAt: new Date().toISOString(),
    machine: "unsaved-checks",
    leadReview: "pending",
  });
  // A retried save parks the worker again; feedback clears pending.
  if (plan.retry) worker.pending = null;
  worker.status = "saved";
  saveManifest();
  console.log(`Saved round ${round} worker ${workerNum} attempt ${plan.attempt} in ${dir}.`);
} else if (command === "check") {
  const at = process.argv.indexOf("--attempt");
  const want = at === -1 ? latestAttempt(rows, round).attempt : Number(process.argv[at + 1]);
  const row = rows.find((a) => a.round === round && a.attempt === want);
  if (!row) throw new Error(`No saved attempt ${want} for round ${round}`);
  const checker = checkerFor(suite, round);
  // Fail fast when the checker is missing: unavailable, never a pass.
  // No container is started in that case.
  if (!existsSync(join(here, checker.script)))
    throw new Error(`Checker unavailable: ${checker.script} is not in this checkout`);
  const seq = nextCheckSeq(row.checks);
  const base = join(row.archive.slice(0, row.archive.lastIndexOf("/")));
  const checkDir = join(base, checkName(seq));
  if (existsSync(checkDir)) throw new Error(`Check folder exists; refusing overwrite: ${checkDir}`);
  mkdirSync(checkDir, { recursive: true });
  const ownLog = join(checkDir, "own.log");
  const teacherLog = join(checkDir, "teacher.log");
  // Checker source hashes plus the pinned image sit beside exit
  // codes, so a later teacher edit cannot reuse an old pass claim.
  const evidence = checkerEvidence(checker, row.archive, manifest.image);
  writeFileSync(join(checkDir, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  // Own and teacher checks run apart: an own failure still scores
  // every teacher case. Each exit is recorded on its own.
  let ownExit = null;
  let teacherExit = null;
  try {
    runOwnChecks(row.archive, manifest.image, ownLog);
    ownExit = 0;
  } catch (error) {
    ownExit = 1;
    writeFileSync(ownLog, `${readFileSync(ownLog, "utf8")}\n${error.message}\n`);
  }
  try {
    runTeacherChecker(checker, row.archive, manifest.image, teacherLog);
    teacherExit = 0;
  } catch (error) {
    teacherExit = 1;
    writeFileSync(teacherLog, `${readFileSync(teacherLog, "utf8")}\n${error.message}\n`);
  }
  const machine = ownExit === 0 && teacherExit === 0 ? "machine-pass" : "machine-fail";
  (row.checks ??= []).push({
    seq,
    dir: checkDir,
    machine,
    ownExit,
    teacherExit,
    evidence,
    ownLog,
    teacherLog,
    checkedAt: new Date().toISOString(),
  });
  row.machine = machine;
  row.ownLog = ownLog;
  row.teacherLog = teacherLog;
  // Machine checks are not acceptance; the lead review stays open.
  // Only the lead sets leadReview, never this command.
  row.leadReview = row.leadReview ?? "pending";
  writeFileSync(
    join(checkDir, "machine.txt"),
    `${machine}\nown: ${ownExit}\nteacher: ${teacherExit}\nlead-review: ${row.leadReview}\n`,
  );
  saveManifest();
  if (machine !== "machine-pass") throw new Error(`Teacher or own checks failed; see ${checkDir}`);
  console.log(`${machine}: round ${round} worker ${workerNum} attempt ${want} ${checkName(seq)}.`);
} else {
  const teacher = flag("teacher");
  const row = latestAttempt(rows, round);
  const retry = nextAttempt(rows, round);
  // Preflight every path before writing anything: no overwrites.
  const dir = join(row.archive.slice(0, row.archive.lastIndexOf("/")));
  const feedbackFile = join(dir, "feedback.md");
  if (existsSync(feedbackFile)) throw new Error(`Feedback exists; refusing overwrite: ${dir}`);
  const events = feedbackEventsPath(root, worker.container, round, retry);
  const feedbackTask = join(root, "feedback-task.md");
  const feedbackGuidelines = join(root, "feedback-guidelines.md");
  if (manifest.frozen) verifyFrozen(root, manifest.frozen);
  // Copy ONLY teacher text. The writer attempt stays as saved.
  copyFileSync(teacher, feedbackFile);
  row.feedback = feedbackFile;
  if (manifest.frozen) {
    runText("docker", ["start", worker.container]);
    // Booking rounds grow: restage the full text through round N,
    // not only the latest packet.
    writeFileSync(feedbackTask, readFrozenTask(root, manifest.frozen, suite, round));
    runText("docker", ["cp", feedbackTask, `${worker.container}:/work/TASK.md`]);
    writeFileSync(feedbackGuidelines, readFrozenGuidelines(root, manifest.frozen, suite));
    runText("docker", ["cp", feedbackGuidelines, `${worker.container}:/work/GUIDELINES.md`]);
    // The writer gets its own failures inside the project too.
    runText("docker", ["cp", feedbackFile, `${worker.container}:/work/FEEDBACK.md`]);
    const ext = join(worker.dir, ".pi/extensions/trial");
    copyFileSync(frozenPath("tools/extension.mjs"), join(ext, "index.mjs"));
    copyFileSync(frozenPath("tools/broker.mjs"), join(ext, "broker.mjs"));
    // Limits come from the frozen copy, never the live repo config.
    const frozenLimits = frozenConfigFor(root, manifest.frozen).limits;
    const extCfgPath = join(ext, "worker.json");
    const extCfg = JSON.parse(readFileSync(extCfgPath));
    extCfg.limits = frozenLimits;
    writeFileSync(extCfgPath, JSON.stringify(extCfg, null, 2));
    void guidelineSourcesFor;
  }
  // Fresh event log for the next attempt. Saved logs are kept.
  writeFileSync(events, "");
  const cfgPath = join(worker.dir, ".pi/extensions/trial/worker.json");
  const cfg = JSON.parse(readFileSync(cfgPath));
  cfg.events = events;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  // Mark the retry open: cleanup waits for its save, and a second
  // save without new work keeps refusing until then.
  worker.pending = { round, attempt: retry };
  worker.status = "feedback";
  saveManifest();
  console.log(`Staged feedback for round ${round} worker ${workerNum}; next try is ${retry}.`);
}

// Checker source hashes plus the pinned image ID, written before
// the run. A rerun after a teacher edit gets a new folder and new
// hashes; an old pass claim cannot be reused silently.
function checkerEvidence(checker, archive, image) {
  const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const files = {};
  files[checker.script] = sha(join(here, checker.script));
  // Hash the helpers the runner loads: booking core, browser,
  // full acceptance pair, or the stock checker itself.
  const helpers =
    checker.script === "evaluate.mjs"
      ? ["teacher/check.mjs", "teacher/run.mjs", "teacher/browser.mjs"]
      : checker.script === "acceptance.mjs"
        ? [
            "teacher/acceptance.mjs",
            "teacher/acceptance-shape.mjs",
            "teacher/browser.mjs",
            "teacher/check.mjs",
            "teacher/run.mjs",
          ]
        : [checker.script];
  for (const helper of helpers) {
    const path = join(here, helper);
    if (!existsSync(path))
      throw new Error(`Checker helper unavailable: ${helper} is not in this checkout`);
    files[helper] = sha(path);
  }
  return { checker: checker.script, args: checker.args, image, archive: sha(archive), files };
}

// Own check/test/build from the archive inside the pinned image.
// Submitted code never runs on the host.
function runOwnChecks(archive, image, logPath) {
  const id = `writer-trial-own-${Date.now().toString(36)}`;
  const out = [];
  try {
    runText("docker", [
      "run",
      "-d",
      "--name",
      id,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "2g",
      "--cpus",
      "2",
      "--tmpfs",
      "/tmp:rw,nosuid,size=512m",
      "--tmpfs",
      "/work:rw,nosuid,size=1g,uid=1001,gid=1001",
      "--user",
      "pwuser",
      "--init",
      image,
    ]);
    runText(
      "docker",
      ["exec", "-i", id, "timeout", "30", "tar", "-xf", "-", "-C", "/work"],
      readFileSync(archive),
    );
    for (const script of ["check", "test", "build"]) {
      try {
        out.push(`RUN npm run ${script}\n`);
        out.push(
          runText(
            "docker",
            ["exec", id, "timeout", "280", "npm", "run", script],
            undefined,
            300000,
          ),
        );
        out.push(`\nEXIT 0 npm run ${script}\n`);
      } catch (error) {
        if (error.stdout) out.push(error.stdout);
        if (error.stderr) out.push(error.stderr);
        out.push(`\nEXIT nonzero npm run ${script}: ${error.message}\n`);
        throw new Error(`Own ${script} failed; see ${logPath}`);
      }
    }
  } finally {
    try {
      runText("docker", ["rm", "-f", id], undefined, 30000);
    } catch {}
    writeFileSync(logPath, out.join(""));
  }
}

// Suite checker through the repo host wrappers, which own their
// disposable pinned containers. Booking 1-3: evaluate.mjs
// <archive> <round> <image>. Booking 4-5: acceptance.mjs
// <archive> <repair|transfer> <image>. Stock: stock-acceptance.mjs
// <archive> <image-id>. A missing checker script fails
// unavailable, never passes.
function runTeacherChecker(checker, archive, image, logPath) {
  const script = join(here, checker.script);
  if (!existsSync(script))
    throw new Error(`Checker unavailable: ${checker.script} is not in this checkout`);
  const out = [];
  const fullArgs = [script, archive, ...checker.args, image];
  out.push(`RUN node ${checker.script} <archive> ${checker.args.join(" ")} <image>\n`);
  try {
    out.push(runText("node", fullArgs, undefined, 320000));
    out.push(`\nEXIT 0 teacher ${checker.script}\n`);
  } catch (error) {
    if (error.stdout) out.push(error.stdout);
    if (error.stderr) out.push(error.stderr);
    out.push(`\nEXIT nonzero teacher ${checker.script}: ${error.message}\n`);
    throw new Error(`Teacher ${checker.script} failed; see ${logPath}`);
  } finally {
    writeFileSync(logPath, out.join(""));
  }
}
