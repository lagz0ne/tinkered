import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { gateOf } from "./gate.mjs";

/** A path Jev judges: a .ts or .tsx file below src/ or tests/, with no `..` part. */
export const isJudgedPath = (file) =>
  /^(src|tests)\/[a-zA-Z0-9_./-]+\.tsx?$/.test(file) && !file.split("/").includes("..");

function validateSource(file) {
  if (!isJudgedPath(file)) throw new Error("Choose a .ts or .tsx file below src/ or tests/");
}

const unavailable = (why) => new Error(`Shape check unavailable: ${why}`);

async function loadShapeHelper(jevDir) {
  const shapePath = join(jevDir, "shape.mjs");
  if (!existsSync(shapePath)) return null;
  try {
    return await import(pathToFileURL(shapePath).href);
  } catch (error) {
    throw unavailable(`cannot import shape.mjs (${error?.message ?? error})`);
  }
}

function requireInspectShape(shape) {
  if (typeof shape?.inspectShape === "function") return shape.inspectShape;
  throw unavailable("shape.mjs has no inspectShape export");
}

async function runInspectShape(inspect, source, file) {
  try {
    return await inspect(source, file);
  } catch (error) {
    throw unavailable(`inspectShape failed (${error?.message ?? error})`);
  }
}

function requireFindingRows(found) {
  if (Array.isArray(found)) return found;
  throw unavailable("inspectShape must return an array");
}

// Deterministic source-shape findings for one file. Only an absent
// shape.mjs is legacy-optional (old frozen dirs report no findings).
// A present helper that cannot import, has no inspectShape export,
// throws, or returns a non-array is an unavailable check: it throws,
// never a clean empty list (unavailable checks never pass).
export async function plainFindingsFor(source, file, jevDir) {
  const shape = await loadShapeHelper(jevDir);
  if (shape === null) return [];
  const inspect = requireInspectShape(shape);
  const found = await runInspectShape(inspect, source, file);
  return requireFindingRows(found);
}

const importFrom = (dir, name) => import(pathToFileURL(join(dir, name)).href);

/** The live Jev call through one jev dir's lib.mjs. A missing key throws unavailable. */
export async function jevAsk(jevDir) {
  const lib = await importFrom(jevDir, "lib.mjs");
  if (!lib.loadKey()) throw new Error("Jev unavailable: missing credentials");
  return (state, questions) => lib.ask(state, questions, 2);
}

// The state a test judge sees: the same shape tools/jev/tests.mjs
// and label.mjs send, so the calibration applies to it.
const testState = (test) => ({
  title: test.title,
  causes: test.causes,
  asserts: test.asserts.map((a) => `${a.subject}${a.not ? ".not" : ""}.${a.matcher}(${a.arg})`),
  narrows: test.narrows,
  body: test.body,
});

/** Judge one source file with the judges named in `judges`, through the bank, extractor,
 *  shape helper, and calibration in `jevDir`. `ask(state, questions)` returns Jev answers;
 *  `allow()` returns a reason when no more calls may run (that unit is `not-run`). Shared
 *  by the broker (live writer) and review.mjs check (saved snapshot). */
export async function judgeSource({ source, file, jevDir, judges, ask, allow = () => null }) {
  const lib = await importFrom(jevDir, "lib.mjs");
  const bank = await importFrom(jevDir, "bank.mjs");
  const extractor = await importFrom(jevDir, "extract.mjs");
  const plainFindings = await plainFindingsFor(source, file, jevDir);
  const selected = new Set(judges);
  const calibration = lib.readCalibration();
  const rows = [];
  const judge = async (state, candidates, unit) => {
    const questions = Object.fromEntries(
      Object.entries(candidates)
        .filter(([id]) => selected.has(id))
        .map(([id, j]) => [id, j.q]),
    );
    if (!Object.keys(questions).length) return;
    const stop = allow();
    if (stop !== null) {
      rows.push({ unit, status: "not-run", reason: stop });
      return;
    }
    const answers = await ask(state, questions);
    rows.push({
      unit,
      findings: Object.entries(answers).map(([id, answer]) => ({
        id,
        probability: answer.probability,
        threshold: candidates[id].threshold,
        hit: answer.probability >= candidates[id].threshold,
        calibration: calibration[id]?.status ?? "uncalibrated",
      })),
    });
  };
  await judge({ file, code: source }, lib.JUDGES, file);
  if (file.includes(".test.")) {
    for (const test of extractor.tests(source, file))
      await judge(testState(test), bank.TESTS, test.title);
  } else {
    for (const unit of bank.slice(source, file)) {
      const fit = Object.fromEntries(
        Object.entries(bank.LINT).filter(([, j]) => !j.applies || j.applies.includes(unit.kind)),
      );
      await judge(bank.forJev(unit), fit, unit.name);
    }
  }
  return {
    file,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    rows,
    plainFindings,
  };
}

export function createBroker(config) {
  if (!/^writer-trial-[a-z0-9-]+$/.test(config.container))
    throw new Error("Invalid trial container");
  let calls = 0;
  let jevCalls = 0;
  const jevLimitReached = () => !config.limits.disabled && jevCalls >= config.limits.jevCalls;
  const log = (event) =>
    appendFileSync(
      config.events,
      JSON.stringify({ time: new Date().toISOString(), ...event }) + "\n",
    );
  const run = (args, signal, timeout = 120) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-w",
          "/work",
          config.container,
          "timeout",
          "-k",
          "2",
          String(Math.min(timeout, 120)),
          ...args,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      let timer;
      const append = (data) => {
        if (output.length < 64000) output += data.toString().slice(0, 64000 - output.length);
      };
      const abort = () => {
        try {
          execFileSync("docker", ["stop", "-t", "1", config.container], {
            stdio: "ignore",
            timeout: 10000,
          });
        } catch {}
        child.kill("SIGKILL");
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(abort, (Math.min(timeout, 120) + 15) * 1000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve({ code, output, truncated: output.length >= 64000 });
      });
    });
  return {
    log,
    async shell(command, signal, timeout) {
      calls++;
      if (!config.limits.disabled && calls > config.limits.toolCalls)
        throw new Error("Tool-call limit reached");
      const result = await run(["bash", "-lc", command], signal, timeout);
      log({ kind: "shell", call: calls, command, ...result });
      return result;
    },
    async jev(file, signal) {
      validateSource(file);
      if (jevLimitReached()) throw new Error("Jev call limit reached");
      const result = await run(
        [
          "node",
          "-e",
          'const f=require("node:fs");const p=f.realpathSync(process.argv[1]);if(!p.startsWith("/work/src/")&&!p.startsWith("/work/tests/"))process.exit(2);const s=f.readFileSync(p,"utf8");if(s.length>40000)process.exit(3);process.stdout.write(s)',
          file,
        ],
        signal,
      );
      if (result.code !== 0 || result.truncated)
        throw new Error("Cannot read source, or file exceeds 40000 characters");
      const source = result.output;
      const ask = await jevAsk(config.jevDir);
      const judged = await judgeSource({
        source,
        file,
        jevDir: config.jevDir,
        judges: config.judges,
        ask: (state, questions) => {
          jevCalls++;
          return ask(state, questions);
        },
        allow: () => (jevLimitReached() ? "Jev call limit reached" : null),
      });
      const gate = gateOf(judged);
      // `advisory` stays for old readers: true while nothing blocks.
      const report = {
        advisory: gate.blocking.length === 0,
        ...judged,
        gate,
        callsUsed: jevCalls,
        usage: null,
        cost: null,
      };
      log({ kind: "jev", ...report });
      return report;
    },
    stop() {
      execFileSync("docker", ["stop", "-t", "1", config.container], {
        stdio: "ignore",
        timeout: 10000,
      });
    },
  };
}
