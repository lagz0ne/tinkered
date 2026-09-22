// Review loop for writer trials: save, check, feedback.
// Small commands over the trial manifest. No agents launched here.
// Launch stays through Paseo tools; the finish callback names files.
//
//   save <trial> <round> <worker> --session <pi-session.jsonl> --report <file>
//     Stop the container, then save one attempt: source archive,
//     native session copy, worker report copy, tool event copy,
//     per-file hashes. Refuses overwrite.
//   check <trial> <round> <worker> [--attempt N]
//     Run the worker's own check, test, build in a fresh pinned
//     container from the saved archive, then the suite teacher
//     checker in a second fresh container. A missing checker
//     script fails unavailable, never passes. Records machine
//     pass or fail separately from lead review.
//   feedback <trial> <round> <worker> --teacher <file>
//     Copy ONLY teacher text into the attempt as its own file.
//     Restage frozen task, rules, and tools; refresh limits
//     from the frozen config. Start a fresh event log.
//     Never overwrite saved tries. No model is launched here.
//
// Old trials without frozen/ keep working: save records the live task,
// check uses the repo-local scripts, feedback skips the restage.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  frozenConfigFor,
  guidelineSourcesFor,
  suiteFor,
  taskFileFor,
  verifyFrozen,
} from "./suite.mjs";
import {
  attemptDir,
  checkerFor,
  checkName,
  claimAttemptDir,
  feedbackEventsPath,
  latestAttempt,
  nextAttempt,
  nextCheckSeq,
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
const manifest = JSON.parse(readFileSync(manifestPath));
const suite = suiteFor(manifest);
const worker = manifest.workers[workerNum - 1];
if (!worker) throw new Error(`No worker ${workerNum} in this trial`);
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
const run = (bin, args, input, timeout = 330000) =>
  input === undefined
    ? execFileSync(bin, args, {
        encoding: "utf8",
        timeout,
        maxBuffer: 16 * 1024 * 1024,
      })
    : execFileSync(bin, args, {
        input,
        encoding: "utf8",
        timeout,
        maxBuffer: 16 * 1024 * 1024,
      });
const stopContainer = () => {
  try {
    run("docker", ["stop", "-t", "1", worker.container], undefined, 30000);
  } catch {}
};
const frozenPath = (rel) => join(root, manifest.frozen.dir, rel);

if (command === "save") {
  const attempt = nextAttempt(rows, round);
  const dir = claimAttemptDir(attemptDir(root, round, workerNum, attempt));
  const session = flag("session");
  const report = flag("report");
  // Paseo launches happen outside this file; the finish callback
  // passes the completed agent id and these saved file paths.
  const agentAt = process.argv.indexOf("--agent");
  const agentId = agentAt === -1 ? (worker.agentId ?? null) : process.argv[agentAt + 1];
  // Stop first so the archive holds a stable on-disk state.
  stopContainer();
  const archive = join(dir, "archive.tar");
  writeFileSync(
    archive,
    run("docker", ["cp", `${worker.container}:/work/.`, "-"], undefined, 120000),
  );
  copyFileSync(session, join(dir, "session.jsonl"));
  copyFileSync(report, join(dir, "report.md"));
  const eventsSrc = join(root, `${worker.container}-round-${round}.jsonl`);
  if (existsSync(eventsSrc)) copyFileSync(eventsSrc, join(dir, "events.jsonl"));
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
    attempt,
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
  worker.status = "saved";
  saveManifest();
  console.log(`Saved round ${round} worker ${workerNum} attempt ${attempt} in ${dir}.`);
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
  mkdirSync(checkDir, { recursive: true });
  const ownLog = join(checkDir, "own.log");
  const teacherLog = join(checkDir, "teacher.log");
  // Checker source hashes plus the pinned image sit beside exit
  // codes, so a later teacher edit cannot reuse an old pass claim.
  const evidence = checkerEvidence(checker, row.archive, manifest.image);
  writeFileSync(join(checkDir, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  let machine;
  try {
    runOwnChecks(row.archive, manifest.image, ownLog);
    runTeacherChecker(checker, row.archive, manifest.image, teacherLog);
    machine = "machine-pass";
  } catch (error) {
    machine = "machine-fail";
    writeFileSync(join(checkDir, "machine.txt"), `machine-fail\n${error.message}\n`);
    (row.checks ??= []).push({
      seq,
      dir: checkDir,
      machine,
      evidence,
      ownLog,
      teacherLog,
      checkedAt: new Date().toISOString(),
    });
    row.machine = machine;
    saveManifest();
    throw error;
  }
  (row.checks ??= []).push({
    seq,
    dir: checkDir,
    machine,
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
  writeFileSync(join(checkDir, "machine.txt"), `${machine}\nlead-review: ${row.leadReview}\n`);
  saveManifest();
  console.log(`${machine}: round ${round} worker ${workerNum} attempt ${want} ${checkName(seq)}.`);
} else {
  const teacher = flag("teacher");
  const row = latestAttempt(rows, round);
  const retry = nextAttempt(rows, round);
  // Copy ONLY teacher text. The writer attempt stays as saved.
  const dir = join(row.archive.slice(0, row.archive.lastIndexOf("/")));
  copyFileSync(teacher, join(dir, "feedback.md"));
  row.feedback = join(dir, "feedback.md");
  if (manifest.frozen) {
    verifyFrozen(root, manifest.frozen);
    run("docker", ["start", worker.container]);
    writeFileSync(
      join(root, "feedback-task.md"),
      readFileSync(frozenPath(`tasks/${taskFileFor(suite, round)}`), "utf8"),
    );
    run("docker", ["cp", join(root, "feedback-task.md"), `${worker.container}:/work/TASK.md`]);
    writeFileSync(
      join(root, "feedback-guidelines.md"),
      guidelineSourcesFor(suite)
        .map((file) => readFileSync(frozenPath(`rules/${file}`), "utf8"))
        .join("\n"),
    );
    run("docker", [
      "cp",
      join(root, "feedback-guidelines.md"),
      `${worker.container}:/work/GUIDELINES.md`,
    ]);
    const ext = join(worker.dir, ".pi/extensions/trial");
    copyFileSync(frozenPath("tools/extension.mjs"), join(ext, "index.mjs"));
    copyFileSync(frozenPath("tools/broker.mjs"), join(ext, "broker.mjs"));
    // Limits come from the frozen copy, never the live repo config.
    const frozenLimits = frozenConfigFor(root, manifest.frozen).limits;
    const cfgPath = join(ext, "worker.json");
    const cfg = JSON.parse(readFileSync(cfgPath));
    cfg.limits = frozenLimits;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  }
  // Fresh event log for the next attempt. Saved logs are kept.
  const events = feedbackEventsPath(root, worker.container, round, retry);
  writeFileSync(events, "");
  const cfgPath = join(worker.dir, ".pi/extensions/trial/worker.json");
  const cfg = JSON.parse(readFileSync(cfgPath));
  cfg.events = events;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  saveManifest();
  console.log(`Staged feedback for round ${round} worker ${workerNum}; next try is ${retry}.`);
}

// Checker source hashes plus the pinned image ID, written before
// the run. A rerun after a teacher edit gets a new folder and new
// hashes; an old pass claim cannot be reused silently.
function checkerEvidence(checker, archive, image) {
  const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const files = {};
  // Outer runner: evaluate.mjs or acceptance.mjs beside review.mjs.
  // Stock checker lives beside review.mjs; booking entries fix above.
  const outer =
    checker.script === "evaluate.mjs" || checker.script === "acceptance.mjs"
      ? join(here, checker.script)
      : join(here, checker.script);
  files[checker.script] = sha(outer);
  // Teacher helpers the runner loads inside the container.
  for (const helper of ["teacher/check.mjs", "teacher/run.mjs", "teacher/browser.mjs"]) {
    const path = join(here, helper);
    if (existsSync(path)) files[helper] = sha(path);
  }
  if (checker.script === "acceptance.mjs") {
    for (const helper of ["teacher/acceptance.mjs", "teacher/acceptance-shape.mjs"]) {
      const path = join(here, helper);
      if (existsSync(path)) files[helper] = sha(path);
    }
  }
  return { checker: checker.script, args: checker.args, image, archive: sha(archive), files };
}

// Own check/test/build from the archive inside the pinned image.
// Submitted code never runs on the host.
function runOwnChecks(archive, image, logPath) {
  const id = `writer-trial-own-${Date.now().toString(36)}`;
  const out = [];
  try {
    run("docker", [
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
    run(
      "docker",
      ["exec", "-i", id, "timeout", "30", "tar", "-xf", "-", "-C", "/work"],
      readFileSync(archive),
    );
    for (const script of ["check", "test", "build"]) {
      try {
        out.push(`RUN npm run ${script}\n`);
        out.push(
          run("docker", ["exec", id, "timeout", "280", "npm", "run", script], undefined, 300000),
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
      run("docker", ["rm", "-f", id], undefined, 30000);
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
    out.push(run("node", fullArgs, undefined, 320000));
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
