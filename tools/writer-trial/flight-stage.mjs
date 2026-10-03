import { flightScore } from "./flight-score.mjs";

/**
 * Select each worker on its own; teacher references have no model run to stop.
 * `explore` lets a stopped model go on once its latest try of every round passed.
 * It never changes the score: the first failure stays the baseline.
 */
export function stageableFlightWorkers(workers, completedRound = 0, { explore = false } = {}) {
  const ready = [],
    skipped = [];
  for (const worker of workers) {
    const reason = explore
      ? exploreReason(worker, completedRound)
      : stopReason(worker, completedRound);
    if (reason) skipped.push({ worker, reason });
    else ready.push(worker);
  }
  return { ready, skipped };
}
function stopReason(worker, completedRound) {
  if (!(worker.attempts ?? []).some((attempt) => Boolean(attempt.agentId))) return null;
  const score = flightScore(worker.attempts);
  if (score.status === "stopped")
    return `Flight stopped at round ${score.firstFailedRound}; baseline ${score.baseline}`;
  if (score.passedRounds < completedRound)
    throw new Error(
      `Check round ${completedRound} for ${worker.model} before staging the next flight round`,
    );
  return null;
}

function exploreReason(worker, completedRound) {
  if (!(worker.attempts ?? []).some((attempt) => Boolean(attempt.agentId))) return null;
  for (let round = 1; round <= completedRound; round++) {
    const check = latestCheck(worker.attempts, round);
    if (!check)
      throw new Error(
        `Check round ${round} for ${worker.model} before staging the next flight round`,
      );
    if (check.machine !== "machine-pass") return `latest try for round ${round} did not pass`;
  }
  return null;
}
/** The newest check of the newest try for one round. */
function latestCheck(attempts, round) {
  const tries = attempts.filter((attempt) => attempt.round === round);
  tries.sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0));
  return tries.at(-1)?.checks?.at(-1);
}
