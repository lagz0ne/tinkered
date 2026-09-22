// Pure attempt bookkeeping for review.mjs.
// No docker, no Paseo, no network. Tested in attempts.test.mjs.
import { existsSync, mkdirSync, openSync, closeSync, rmSync } from "node:fs";
import { join } from "node:path";

// Which teacher checker scores one suite round.
// Booking rounds 1-3 use the round runner.
// Round 4 adds repair acceptance; round 5 uses transfer.
// Stock uses the new stock entry (may not exist yet).
const bookingChecker = (round) => {
  if ([1, 2, 3].includes(round)) return { script: "evaluate.mjs", args: [String(round)] };
  if (round === 4) return { script: "acceptance.mjs", args: ["repair"] };
  if (round === 5) return { script: "acceptance.mjs", args: ["transfer"] };
  throw new Error(`No checker for suite booking round ${round}`);
};

export const checkerFor = (suite, round) => {
  if (suite === "booking") return bookingChecker(round);
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

// One worker try is open at a time per round. Save claims the next
// number only once: a second save without staged feedback refuses
// instead of inventing a new attempt. Feedback opens the retry.
export const pendingFor = (worker, round) => {
  const pending = worker.pending ?? null;
  return pending && pending.round === round ? pending : null;
};

export const planSave = (worker, round) => {
  const attempts = worker.attempts ?? [];
  const existing = attempts.filter((a) => a.round === round);
  const pending = pendingFor(worker, round);
  if (pending) return { attempt: pending.attempt, retry: true };
  if (worker.pending)
    throw new Error(`Feedback is staged for round ${worker.pending.round}; save that round first`);
  if (!existing.length) return { attempt: 1, retry: false };
  throw new Error(
    `Round ${round} attempt ${existing.at(-1).attempt} is already saved; ` +
      "stage feedback before saving again",
  );
};

// One folder per worker try. Never reuse a folder.
// Cleanup also needs the worker parked on a save, not on staged
// feedback: after feedback the next attempt is still unsaved.
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
// A worker with staged feedback still owes its next attempt.
// Only attempts for the active round count.
export const cleanupReady = (workers, round) => {
  const missing = [];
  workers.forEach((w, i) => {
    const rows = (w.attempts ?? []).filter((a) => a.round === round && a.archive);
    const latest = rows.at(-1);
    void latest;
    if (!rows.length || w.pending?.round === round || w.status !== "saved") missing.push(i + 1);
  });
  if (missing.length)
    throw new Error(`Save the current attempt first for worker(s): ${missing.join(", ")}`);
  return true;
};

// Named check results: every repeat gets a new folder, never a reuse.
export const checkName = (seq) => `check-${seq}`;
export const nextCheckSeq = (checks) => (checks ?? []).length + 1;

// One manifest writer at a time: review commands hold an exclusive
// lock file for the whole command and release it in a finally.
// A second command fails busy instead of overwriting with stale
// manifest state. Lock lives beside the manifest it guards.
export const lockPathFor = (root) => join(root, "review.lock");

export const claimLock = (root) => {
  const path = lockPathFor(root);
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch {
    throw new Error(`Trial is busy; another review command holds ${path}`);
  }
  return () => {
    try {
      closeSync(fd);
    } finally {
      rmSync(path, { force: true });
    }
  };
};
