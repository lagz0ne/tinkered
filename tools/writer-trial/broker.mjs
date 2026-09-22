import { spawn, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

function validateSource(file) {
  if (!/^(src|tests)\/[a-zA-Z0-9_./-]+\.tsx?$/.test(file) || file.split("/").includes(".."))
    throw new Error("Choose a .ts or .tsx file below src/ or tests/");
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
      const lib = await import(pathToFileURL(join(config.jevDir, "lib.mjs")).href);
      const bank = await import(pathToFileURL(join(config.jevDir, "bank.mjs")).href);
      const extractor = await import(pathToFileURL(join(config.jevDir, "extract.mjs")).href);
      if (!lib.loadKey()) throw new Error("Jev unavailable: missing credentials");
      const selected = new Set(config.judges);
      const calibration = lib.readCalibration();
      const rows = [];
      const ask = async (state, candidates, unit) => {
        const questions = Object.fromEntries(
          Object.entries(candidates)
            .filter(([id]) => selected.has(id))
            .map(([id, j]) => [id, j.q]),
        );
        if (!Object.keys(questions).length) return;
        if (jevLimitReached()) {
          rows.push({ unit, status: "not-run", reason: "Jev call limit reached" });
          return;
        }
        jevCalls++;
        const answers = await lib.ask(state, questions, 2);
        rows.push({
          unit,
          findings: Object.entries(answers).map(([id, answer]) => ({
            id,
            probability: answer.probability,
            hit: answer.probability >= candidates[id].threshold,
            calibration: calibration[id]?.status ?? "uncalibrated",
          })),
        });
      };
      await ask({ file, code: source }, lib.JUDGES, file);
      if (file.includes(".test.")) {
        for (const test of extractor.tests(source, file))
          await ask({ title: test.title, body: test.body }, bank.TESTS, test.title);
      } else {
        for (const unit of bank.slice(source, file)) {
          const judges = Object.fromEntries(
            Object.entries(bank.LINT).filter(
              ([, j]) => !j.applies || j.applies.includes(unit.kind),
            ),
          );
          await ask(bank.forJev(unit), judges, unit.name);
        }
      }
      const report = {
        advisory: true,
        file,
        sourceHash: createHash("sha256").update(source).digest("hex"),
        rows,
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
