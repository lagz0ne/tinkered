// Tool-call decision chain (ADR: docs/roadmap/jev-loop/PLAN.md).
//
// Every tool call is wrapped by two Jev-judged gates and a Jev-routed trim:
//
//   frame  — record the goal ONCE as a structured chain decision
//            (objective · intention · verification[]). The agent supplies the
//            structure; Jev never generates text, so it cannot invent it.
//   before — judge the *intended* call: should it run now, or is it a detour off the
//            objective / intention / verification chain? (should-run pre-filter, proven
//            6/6 @ 82% separation). Advisory warn, never a block.
//   after  — verify the *result* (did the request stray? did the output fail?) AND trim:
//            Jev picks ONE strategy (whole/pointer/head/tail/errors — proven 5/5) and the
//            SCRIPT executes it. Jev routes; code cuts; the full output is always saved.
//
// Doctrine (PLAN.md): Jev is advisory on every side and jagged — strong at whole-call
// judgments, blind at per-line relevance (reading-intention.mjs, ~0% separation), so it
// never picks which lines to keep. The trim keeps output WHOLE below the confidence bar
// (nothing lost; full dump in .jev/). The only pass/fail remains scripts/ticket.sh, the
// gates, and the human. Exit codes: 0 when it proceeds / keeps whole; 3 when a call is
// advised-skipped or the gate blocks a command (nothing ran); the child's own code when
// `run` executes; 2 for a usage error or --strict. "Advisory" means it never overrides
// your real gates — not that it never sets an exit code.
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  readdirSync,
  rmSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { loadKey, ask, pct } from "./lib.mjs";

const DIR = process.env.JEV_TOOLCALL_DIR ?? ".jev";
const FRAME_FILE = `${DIR}/frame.json`;
const FULL_FILE = `${DIR}/last-output.txt`;
const TRACE_FILE = `${DIR}/trace.jsonl`; // run log (gitignored), FIFO-capped, for later analysis
const TRACE_MAX_LINES = Number(process.env.JEV_TRACE_MAX_LINES ?? 2000); // keep newest N entries
const TRACE_MAX_BYTES = Number(process.env.JEV_TRACE_MAX_BYTES ?? 1_048_576); // only compact past ~1 MB
const OUT_DIR = `${DIR}/out`; // one immutable dump per call so trim pointers stay valid
const OUT_MAX = Number(process.env.JEV_OUT_MAX ?? 500); // cap kept dumps (FIFO by name/timestamp)

const LINK_THRESHOLD = 0.6; // warn a link is weak at/above this
const HOW_MIN = 0.6; // trust the trim-how choice only at/above this, else keep whole (safe)
const HEAD_TAIL_LINES = 20; // lines kept by the head/tail strategies
// The `errors` strategy keeps real failure/error lines (incl. compiler/lint warnings)…
const ERROR_RE =
  /\b(error|fail(ed|ure)?|assert(ion)?|exception|panic)\b|✗|(error|warning) TS\d+|\bwarning:/i;
// …but never package-manager chatter (anchored to the tool name so a real "X is
// deprecated" diagnostic is not mistaken for noise).
const NOISE_LINE_RE = /\b(npm|pnpm|yarn)\b.*\b(warn|deprecated)\b/i;
const JUDGE_SLICE = 6000; // when judging a big output, show Jev its head AND tail, not just the head

// ---------- args ----------
// Everything before the first `--` is the wrapper's own options; everything after is the
// child command (for `run`). Parsing ONLY the prefix keeps a child flag (e.g. a command's
// own --force) from leaking into wrapper behaviour.
const rawArgv = process.argv.slice(2);
const ddIndex = rawArgv.indexOf("--");
const argv = ddIndex >= 0 ? rawArgv.slice(0, ddIndex) : rawArgv;
const cmdTail = ddIndex >= 0 ? rawArgv.slice(ddIndex + 1) : [];
const cmd = argv[0];
const strict = argv.includes("--strict");
const opt = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined; // reject a missing value / an adjacent flag
};
/** Payload JSON from --json '<...>' or --in <file> or stdin (never blocks on a TTY). */
function payload() {
  const inline = opt("--json");
  if (inline) return JSON.parse(inline);
  const file = opt("--in");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  if (process.stdin.isTTY) return {}; // no piped input — do not hang waiting on the terminal
  const stdin = readFileSync(0, "utf8").trim();
  if (stdin) return JSON.parse(stdin);
  return {};
}
/** The saved frame, or null when there is none — callers treat null as "advisory skipped". */
function readFrame() {
  if (!existsSync(FRAME_FILE)) return null;
  try {
    return JSON.parse(readFileSync(FRAME_FILE, "utf8"));
  } catch {
    return null;
  }
}
const ensureDir = () => mkdirSync(DIR, { recursive: true });
/** Best-effort append one JSON record per call, then a light FIFO compaction (drop the
 *  oldest lines) so the trace can't grow without bound — we analyze it after a day of runs. */
function trace(rec) {
  try {
    ensureDir();
    appendFileSync(TRACE_FILE, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
    if (statSync(TRACE_FILE).size <= TRACE_MAX_BYTES) return; // cheap gate: skip the read-back
    const lines = readFileSync(TRACE_FILE, "utf8").split("\n").filter(Boolean);
    if (lines.length > TRACE_MAX_LINES)
      writeFileSync(TRACE_FILE, lines.slice(-TRACE_MAX_LINES).join("\n") + "\n");
  } catch {
    /* trace is advisory too — never break a call over it */
  }
}
/** ask() but advisory: a gateway/auth/exhausted-retry failure returns null (logged) instead of
 *  throwing, so a Jev outage never blocks a command or swallows output — every caller falls back. */
async function askAdvisory(state, questions, where) {
  try {
    return await ask(state, questions, 2); // few tries: a wrapped call must not stall on a 429
  } catch (e) {
    console.error(
      `toolcall: ${where} advisory skipped — jev error (${String(e?.message ?? e).slice(0, 80)})`,
    );
    return null;
  }
}
/** Save this call's full output under a unique, immutable name so earlier trim pointers keep
 *  resolving; refresh last-output.txt as a newest-copy convenience and FIFO-cap the dump dir. */
function saveDump(output) {
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${OUT_DIR}/${stamp}-${Math.random().toString(36).slice(2, 8)}.txt`;
    writeFileSync(path, output);
    writeFileSync(FULL_FILE, output); // newest-copy convenience
    const files = readdirSync(OUT_DIR).sort();
    for (const f of files.slice(0, Math.max(0, files.length - OUT_MAX)))
      rmSync(`${OUT_DIR}/${f}`, { force: true });
    return path;
  } catch {
    return "(dump unavailable)"; // disk full / permissions — never crash a call over housekeeping
  }
}
/** Judge on the WHOLE small output; for a big one, show Jev both ends so a tail/errors pick is sound. */
const judgeSample = (s) =>
  s.length <= JUDGE_SLICE * 2
    ? s
    : `${s.slice(0, JUDGE_SLICE)}\n…[middle trimmed for judging]…\n${s.slice(-JUDGE_SLICE)}`;
const goalText = (f) =>
  `objective: ${f.objective}\nintention: ${f.intention}\nverification: ${(f.verification ?? []).join("; ")}`;
const callStr = (p) =>
  `tool: ${p.tool}\nargs: ${JSON.stringify(p.args ?? {})}\nwhy: ${p.why ?? "(unstated)"}`;
const boolQ = (instructions, t, f) => ({
  type: "boolean",
  instructions,
  criteria: { true: t, false: f },
});

// ---------- frame ----------
async function doFrame() {
  const p = payload();
  if (!p.objective || !p.intention) {
    console.error(`jev toolcall frame: need { objective, intention, verification: [...] }`);
    process.exit(2);
  }
  const frame = {
    objective: String(p.objective),
    intention: String(p.intention),
    verification: Array.isArray(p.verification) ? p.verification.map(String) : [],
  };
  ensureDir();
  writeFileSync(FRAME_FILE, JSON.stringify(frame, null, 2));
  trace({ cmd: "frame", ...frame });
  console.log("jev toolcall: chain decision recorded\n");
  console.log(goalText(frame));
  console.log(`\n(saved to ${FRAME_FILE})`);
}

// ---------- before ----------
// should-run is the decision; the three links are diagnostic detail (why it is off).
const BEFORE_QUESTIONS = {
  shouldRun: boolQ(
    "Given the goal, should this command run now — does it advance the goal without being a detour, redundant, or unsafe?",
    "it advances the goal and is safe to run now",
    "it is a detour, redundant, or unsafe for this goal",
  ),
  offObjective: boolQ(
    "Is this tool call a detour — it does NOT advance the stated objective for this task?",
    "the call does not move toward the objective",
    "the call plausibly advances the objective",
  ),
  offIntention: boolQ(
    "Does this tool call stray from or contradict the stated intention?",
    "the call goes against or aside from the intention",
    "the call is consistent with the intention",
  ),
  offVerification: boolQ(
    "Is this call disconnected from the verification chain — neither producing something the checks cover nor checking it?",
    "the call is outside what the verification steps cover",
    "the call feeds or performs a verification step",
  ),
};
const LINKS = [
  ["offObjective", "objective"],
  ["offIntention", "intention"],
  ["offVerification", "verification"],
];
const weakLinks = (a) =>
  LINKS.filter(([id]) => a[id].probability >= LINK_THRESHOLD).map(
    ([id, label]) => `${label} link weak (${pct(a[id].probability)})`,
  );
/** A before/gate answer we can act on: the decision and all three links are present. */
const validBefore = (a) =>
  a && a.shouldRun && a.offObjective && a.offIntention && a.offVerification;

/** No frame or no key → advisory: proceed. Returns false when the caller should just proceed. */
function beforeReady(frame) {
  if (!frame) {
    console.log("before: proceed (no frame — advisory skipped)");
    return false;
  }
  if (!loadKey()) {
    console.log("before: proceed (no key — advisory skipped)");
    return false;
  }
  return true;
}
async function doBefore() {
  const frame = readFrame();
  const p = payload();
  if (!beforeReady(frame)) process.exit(0);
  const a = await askAdvisory(
    { goal: goalText(frame), call: callStr(p) },
    BEFORE_QUESTIONS,
    "before",
  );
  if (!validBefore(a)) {
    console.log("before: proceed (jev unavailable or unusable answer — advisory skipped)");
    process.exit(0);
  }
  const weak = weakLinks(a);
  const runP = a.shouldRun.probability;
  const skip = runP < 0.5;
  trace({
    cmd: "before",
    tool: p.tool,
    why: p.why,
    shouldRun: runP,
    decision: skip ? "skip" : "proceed",
    weak,
  });
  if (skip) {
    const why = weak.length ? ` (${weak.join(", ")})` : "";
    console.log(
      `before: ⚠ skip — run confidence ${pct(runP)}${why} — reconsider or note why you proceed`,
    );
    process.exit(strict ? 2 : 3); // exit 3 = advised skip (nothing ran)
  }
  console.log(
    `before: ✓ run (${pct(runP)}) — linked to objective · intention · verification — proceed`,
  );
}

// ---------- after ----------
const AFTER_QUESTIONS = {
  requestStrayed: boolQ(
    "Did the request that was made diverge from the stated intention?",
    "the request asked for something off-intention",
    "the request matched the intention",
  ),
  outputFailed: boolQ(
    "Does the output fail to satisfy what the request asked for (an error, empty, or the wrong thing)?",
    "the output does not satisfy the request",
    "the output satisfies the request",
  ),
  // ONE choice; `whole` is the "none / do not trim" option. The kept output must still
  // answer the goal. Proven 5/5 (trim-how.mjs); trusted only at/above HOW_MIN.
  how: {
    type: "choice",
    instructions:
      "To keep only what still answers the goal, which strategy fits this output — or leave it whole?",
    criteria: {
      whole: "almost all of it answers the goal; do not shorten",
      pointer: "none of it answers the goal; replace it all with a pointer",
      head: "what the goal needs is in the first lines",
      tail: "what the goal needs is in the last lines",
      errors: "what the goal needs is the error / failure / warning lines inside",
    },
  },
};

// The trim strategies. Jev picks one (a choice), the SCRIPT executes it — retention is
// deterministic and cannot invent or reorder text. Every trimming strategy leaves a
// pointer to the full dump, so nothing is ever lost. `whole` is the "none" option.
const STRATEGIES = new Set(["whole", "pointer", "head", "tail", "errors"]);
const ptr = (n, full) => `[… ${n} more line(s) trimmed — full at ${full}]`;
/** The `head` / `tail` strategies: keep HEAD_TAIL_LINES from one end, point at the rest. */
function applyEdge(how, lines, output, full) {
  const total = lines.length;
  const kept = how === "head" ? lines.slice(0, HEAD_TAIL_LINES) : lines.slice(-HEAD_TAIL_LINES);
  const rest = total - kept.length;
  if (rest === 0) return { text: output, kept: kept.length, total };
  const text =
    how === "head"
      ? kept.join("\n") + "\n" + ptr(rest, full)
      : ptr(rest, full) + "\n" + kept.join("\n");
  return { text, kept: kept.length, total };
}
function applyStrategy(how, output, full) {
  const body = output.endsWith("\n") ? output.slice(0, -1) : output; // no phantom trailing line
  const lines = body === "" ? [] : body.split("\n");
  const total = lines.length;
  if (how === "pointer") return { text: ptr(total, full), kept: 0, total };
  if (how === "head" || how === "tail") return applyEdge(how, lines, output, full);
  if (how === "errors") {
    const hits = lines.filter((l) => ERROR_RE.test(l) && !NOISE_LINE_RE.test(l));
    if (hits.length === 0) return { text: output, kept: total, total }; // safe: keep whole
    return {
      text: hits.join("\n") + "\n" + ptr(total - hits.length, full),
      kept: hits.length,
      total,
    };
  }
  return { text: output, kept: total, total }; // whole
}

const verifyFlags = (a) => {
  const flags = [];
  if (a.requestStrayed.probability >= LINK_THRESHOLD)
    flags.push(`request strayed from intention (${pct(a.requestStrayed.probability)})`);
  if (a.outputFailed.probability >= LINK_THRESHOLD)
    flags.push(`output may not satisfy the request (${pct(a.outputFailed.probability)})`);
  return flags;
};
/** Trust the choice only at/above HOW_MIN (and a known strategy); else keep whole — safe. */
function pickStrategy(a) {
  const pick = a.how.choice;
  const conf = a.how.probabilities[pick] ?? 0;
  const how = conf >= HOW_MIN && STRATEGIES.has(pick) ? pick : "whole";
  return { pick, conf, how };
}
const trimNote = (how, pick, conf, kept, total) =>
  how === "whole"
    ? `kept whole (${total} line(s))` +
      (pick !== "whole" ? ` — wanted ${pick} at only ${pct(conf)}` : "")
    : `${how} (${pct(conf)}): kept ${kept}/${total} line(s)`;
const emit = (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n");
/** A Jev answer we can act on: all three expected fields present. */
const validAnswer = (a) => a && a.how?.probabilities && a.requestStrayed && a.outputFailed;

/** Shared tail of `after` and `run`: verify the request/output, pick a strategy, prune, emit.
 *  `full` is this call's immutable dump path; `exitCode` is the child's code (0 for `after`).
 *  A Jev outage or a malformed answer keeps the output whole (nothing lost). */
async function pruneEmit(frame, p, output, full, tag, traceCmd, exitCode = 0) {
  const a = await askAdvisory(
    { goal: goalText(frame), call: callStr(p), output: judgeSample(output) },
    AFTER_QUESTIONS,
    tag,
  );
  if (!validAnswer(a)) {
    emit(output);
    console.error(`${tag}: kept whole (jev unavailable or unusable answer). Full output: ${full}`);
    process.exit(strict ? 2 : exitCode);
  }
  const flags = verifyFlags(a);
  const { pick, conf, how } = pickStrategy(a);
  const { text, kept, total } = applyStrategy(how, output, full);
  trace({
    cmd: traceCmd,
    tool: p.tool,
    why: p.why,
    requestStrayed: a.requestStrayed.probability,
    outputFailed: a.outputFailed.probability,
    pick,
    conf,
    how,
    kept,
    total,
    fullBytes: output.length,
  });
  for (const f of flags) console.error(`${tag}: ⚠ ${f}`);
  emit(text);
  console.error(`${tag}: ${trimNote(how, pick, conf, kept, total)}. Full output: ${full}`);
  process.exit(strict && (flags.length || how !== "whole") ? 2 : exitCode);
}

/** Read the tool output from --out <file> or the payload; a bad --out path is a clean error. */
function afterOutput(p) {
  const outFile = opt("--out");
  if (!outFile) return String(p.output ?? "");
  try {
    return readFileSync(outFile, "utf8");
  } catch (e) {
    console.error(`after: cannot read --out file (${String(e?.message ?? e).slice(0, 80)})`);
    process.exit(2);
  }
}
async function doAfter() {
  const frame = readFrame();
  const p = payload();
  const output = afterOutput(p);
  if (!frame || !loadKey()) {
    console.error("after: advisory skipped (no frame or key) — output kept whole"); // status → stderr
    emit(output);
    process.exit(0);
  }
  const full = saveDump(output);
  await pruneEmit(frame, p, output, full, "after", "after");
}

// ---------- run: the whole chain around one real command, in a single call ----------
// node scripts/jev/toolcall.mjs run --intention "..." --why "..." [--force] -- <command...>
// Gates the command (before), runs it if allowed, then verifies + prunes its output (after).
const splitList = (s) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
/** Inline --intention (with optional --objective/--verification) beats the saved frame. */
function resolveFrame() {
  const intention = opt("--intention");
  if (!intention) return readFrame();
  return {
    objective: opt("--objective") ?? intention,
    intention,
    verification: splitList(opt("--verification")),
  };
}
/** BEFORE as a real gate: returns whether the command may run. Advisory if no key. */
async function gate(frame, p, command) {
  if (!loadKey()) return true;
  const a = await askAdvisory(
    { goal: goalText(frame), call: callStr(p) },
    BEFORE_QUESTIONS,
    "gate",
  );
  if (!validBefore(a)) return true; // jev unavailable or unusable answer → advisory, allow the run
  const runP = a.shouldRun.probability;
  const weak = weakLinks(a);
  const allowed = runP >= 0.5 || argv.includes("--force");
  trace({
    cmd: "run/before",
    command,
    why: p.why,
    shouldRun: runP,
    decision: allowed ? "run" : "skip",
    weak,
  });
  if (!allowed)
    console.error(
      `toolcall: ⚠ skipped (run ${pct(runP)}${weak.length ? ", " + weak.join(", ") : ""}) — not run. Add --force to override.`,
    );
  else if (runP < 0.5) console.error(`toolcall: forced (run only ${pct(runP)})`);
  return allowed;
}
/** Run the command (argv, no shell — preserves the caller's quoting) and capture BOTH stdout and
 *  stderr (concatenated), plus the child's exit code, on success, failure, or buffer overflow. */
function execCapture(cmdArgv) {
  const r = spawnSync(cmdArgv[0], cmdArgv.slice(1), {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const captured = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) {
    // spawn/buffer failure (e.g. ENOENT, ENOBUFS): keep any partial output, add the reason.
    const note = String(r.error.message ?? r.error);
    return { output: captured ? `${captured}\n${note}` : note, code: 1 };
  }
  return { output: captured, code: r.signal ? 1 : (r.status ?? 0) };
}
async function doRun() {
  const cmdArgv = cmdTail; // the command after `--`; wrapper options are the prefix only
  if (cmdArgv.length === 0) {
    console.error(
      "usage: node scripts/jev/toolcall.mjs run --intention '...' [--why '...'] [--force] -- <command...>",
    );
    process.exit(2);
  }
  const command = cmdArgv.join(" "); // display / judged text only; execution uses the argv
  const frame = resolveFrame();
  const p = { tool: "Bash", args: { cmd: command }, why: opt("--why") ?? "(unstated)" };

  // Gate only when we have a frame AND a key; otherwise run unwrapped (advisory).
  const gated = frame && loadKey();
  if (gated && !(await gate(frame, p, command))) process.exit(3); // exit 3 = gate blocked, nothing ran

  const { output, code } = execCapture(cmdArgv);
  const full = saveDump(output);

  if (!gated) {
    emit(output); // no frame/key → keep whole, preserve the child's exit code
    process.exit(code);
  }
  await pruneEmit(frame, p, output, full, "toolcall", "run/after", code);
}

// ---------- dispatch ----------
const table = { frame: doFrame, before: doBefore, after: doAfter, run: doRun };
const run = table[cmd];
if (!run) {
  console.error(
    "usage: node scripts/jev/toolcall.mjs <frame|before|after|run> [--json '<...>'|--in f] [--out f] [--strict]\n" +
      "       run --intention '...' [--why '...'] [--force] -- <command...>",
  );
  process.exit(2);
}
await run();
