// Pure attempt bookkeeping for review.mjs.
// No docker, no Paseo, no network. Tested in attempts.test.mjs.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Which teacher checker scores one suite round.
// Booking rounds 1-3 use the round runner.
// Round 4 adds repair acceptance; round 5 uses transfer.
// Stock uses the new stock entry (may not exist yet).
export const checkerFor = (suite, round) => {
  if (suite === "booking" && [1, 2, 3].includes(round))
    return { script: "evaluate.mjs", args: [String(round)] };
  if (suite === "booking" && round === 4) return { script: "acceptance.mjs", args: ["repair"] };
  if (suite === "booking" && round === 5)
    return { script: "acceptance.mjs", args: ["transfer"] };
  if (suite === "stock" && round === 1) return { script: "stock-acceptance.mjs", args: [] };
  throw new Error(`No checker for suite ${suite} round ${round}`);
};

// Attempt numbers count saved tries for one round, starting at 1.
export const nextAttempt = (attempts, round) =>
  attempts.filter((a) => a.round === round).length + 1;

export const latestAttempt = (attempts, round) => {
  const rows = attempts.filter((a) => a.round === round);
  if (!rows.length) throw new Error(`No saved attempt for round ${round}`);
  return rows.at(-1);
};

// One folder per worker try. Never reuse a folder.
export const attemptDir = (root, round, worker, attempt) =>
  join(root, "results", `round-${round}`, `worker-${worker}-attempt-${attempt}`);

export const claimAttemptDir = (dir) => {
  mkdirSync(join(dir, ".."), { recursive: true });
  mkdirSync(dir);
  return dir;
};

// Fresh event log per retry. Never reuse a log path.
export const feedbackEventsPath = (root, container, round, retry) => {
  const path = join(root, `${container}-round-${round}-retry-${retry}.jsonl`);
  if (existsSync(path)) throw new Error(`Event log exists; refusing overwrite: ${path}`);
  return path;
};

// Cleanup needs every worker's current attempt saved first.
export const cleanupReady = (workers, round) => {
  const missing = workers
    .map((w, i) => ({ w, n: i + 1 }))
    .filter(({ w }) => !(w.attempts ?? []).some((a) => a.round === round && a.archive))
    .map(({ n }) => n);
  if (missing.length)
    throw new Error(`Save the current attempt first for worker(s): ${missing.join(", ")}`);
  return true;
};
