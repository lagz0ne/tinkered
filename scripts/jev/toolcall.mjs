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
// gates, and the human. Exit is always 0 unless --strict (experiments; never in a gate).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadKey, ask, pct } from "./lib.mjs";

const DIR = process.env.JEV_TOOLCALL_DIR ?? ".jev";
const FRAME_FILE = `${DIR}/frame.json`;
const FULL_FILE = `${DIR}/last-output.txt`;
const TRACE_FILE = `${DIR}/trace.jsonl`; // append-only run log (gitignored) for later analysis

const LINK_THRESHOLD = 0.6; // warn a link is weak at/above this
const HOW_MIN = 0.6; // trust the trim-how choice only at/above this, else keep whole (safe)
const HEAD_TAIL_LINES = 20; // lines kept by the head/tail strategies
// The `errors` strategy keeps real failure/error lines (incl. compiler/lint warnings)…
const ERROR_RE =
  /\b(error|fail(ed|ure)?|assert(ion)?|exception|panic)\b|✗|(error|warning) TS\d+|\bwarning:/i;
// …but never package-manager chatter, which also contains the word "warn".
const NOISE_LINE_RE = /\b(npm|pnpm|yarn)\b.*\bwarn\b|deprecated/i;

// ---------- args ----------
const argv = process.argv.slice(2);
const cmd = argv[0];
const strict = argv.includes("--strict");
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
/** Payload JSON from --json '<...>' or --in <file> or stdin. */
function payload() {
  const inline = opt("--json");
  if (inline) return JSON.parse(inline);
  const file = opt("--in");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const stdin = readFileSync(0, "utf8").trim();
  if (stdin) return JSON.parse(stdin);
  return {};
}
function readFrame() {
  if (!existsSync(FRAME_FILE)) {
    console.error(`jev toolcall: no frame — run \`node scripts/jev/toolcall.mjs frame ...\` first`);
    process.exit(strict ? 2 : 0);
  }
  return JSON.parse(readFileSync(FRAME_FILE, "utf8"));
}
const ensureDir = () => mkdirSync(DIR, { recursive: true });
/** Best-effort append one JSON record per call — the trace we analyze after a day of runs. */
function trace(rec) {
  try {
    ensureDir();
    appendFileSync(TRACE_FILE, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
  } catch {
    /* trace is advisory too — never break a call over it */
  }
}
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

async function doBefore() {
  const frame = readFrame();
  const p = payload();
  if (!loadKey()) {
    console.log("before: no key — advisory skipped, proceed");
    process.exit(0);
  }
  const a = await ask({ goal: goalText(frame), call: callStr(p) }, BEFORE_QUESTIONS);
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
    process.exit(strict ? 2 : 0);
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
const ptr = (n) => `[… ${n} more line(s) trimmed — full at ${FULL_FILE}]`;
function applyStrategy(how, output) {
  const lines = output.split("\n");
  const total = lines.length;
  if (how === "pointer") return { text: ptr(total), kept: 0, total };
  if (how === "head") {
    const head = lines.slice(0, HEAD_TAIL_LINES);
    const rest = total - head.length;
    return {
      text: rest > 0 ? head.join("\n") + "\n" + ptr(rest) : output,
      kept: head.length,
      total,
    };
  }
  if (how === "tail") {
    const tail = lines.slice(-HEAD_TAIL_LINES);
    const rest = total - tail.length;
    return {
      text: rest > 0 ? ptr(rest) + "\n" + tail.join("\n") : output,
      kept: tail.length,
      total,
    };
  }
  if (how === "errors") {
    const hits = lines.filter((l) => ERROR_RE.test(l) && !NOISE_LINE_RE.test(l));
    if (hits.length === 0) return { text: output, kept: total, total }; // safe: keep whole
    return { text: hits.join("\n") + "\n" + ptr(total - hits.length), kept: hits.length, total };
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

/** Shared tail of `after` and `run`: verify the request/output, pick a strategy, prune, emit. */
async function pruneEmit(frame, p, output, tag, traceCmd) {
  const a = await ask(
    { goal: goalText(frame), call: callStr(p), output: output.slice(0, 12_000) },
    AFTER_QUESTIONS,
  );
  const flags = verifyFlags(a);
  const { pick, conf, how } = pickStrategy(a);
  const { text, kept, total } = applyStrategy(how, output);
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
  console.error(`${tag}: ${trimNote(how, pick, conf, kept, total)}. Full output: ${FULL_FILE}`);
  process.exit(strict && (flags.length || how !== "whole") ? 2 : 0);
}

async function doAfter() {
  const frame = readFrame();
  const p = payload();
  const outFile = opt("--out");
  const output = outFile ? readFileSync(outFile, "utf8") : String(p.output ?? "");
  ensureDir();
  writeFileSync(FULL_FILE, output);
  if (!loadKey()) {
    console.log("after: no key — advisory skipped, output kept whole");
    emit(output);
    process.exit(0);
  }
  await pruneEmit(frame, p, output, "after", "after");
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
  const a = await ask({ goal: goalText(frame), call: callStr(p) }, BEFORE_QUESTIONS);
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
/** Run the command (argv, no shell — preserves the caller's quoting), capturing
 *  stdout+stderr even when it exits non-zero. */
function execCapture(cmdArgv) {
  try {
    return execFileSync(cmdArgv[0], cmdArgv.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}` || String(e.message ?? e);
  }
}
async function doRun() {
  const sep = argv.indexOf("--");
  const cmdArgv = sep >= 0 ? argv.slice(sep + 1) : [];
  if (cmdArgv.length === 0) {
    console.error(
      "usage: node scripts/jev/toolcall.mjs run --intention '...' [--why '...'] [--force] -- <command...>",
    );
    process.exit(2);
  }
  const command = cmdArgv.join(" "); // display / judged text only; execution uses the argv
  const frame = resolveFrame();
  const p = { tool: "Bash", args: { cmd: command }, why: opt("--why") ?? "(unstated)" };

  if (!(await gate(frame, p, command))) process.exit(strict ? 2 : 0); // gate blocked → do NOT run

  const output = execCapture(cmdArgv);
  ensureDir();
  writeFileSync(FULL_FILE, output);

  if (!loadKey()) {
    emit(output);
    process.exit(0);
  }
  await pruneEmit(frame, p, output, "toolcall", "run/after");
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
