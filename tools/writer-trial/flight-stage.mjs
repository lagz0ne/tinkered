import { flightScore } from "./flight-score.mjs";

/** Select each worker on its own; teacher references have no model run to stop. */
export function stageableFlightWorkers(workers, completedRound = 0) {
  const ready = [],
    skipped = [];
  for (const worker of workers) {
    const reason = stopReason(worker, completedRound);
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
