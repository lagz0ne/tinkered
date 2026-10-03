/** A wiring check earns no rounds. The first scored failure stays final across retries. */
export function flightScore(attempts) {
  let passedRounds = 0;
  for (const round of [1, 2, 3, 4, 5]) {
    const checks = attempts
      .filter((attempt) => attempt.round === round)
      .flatMap((attempt) => attempt.checks ?? [])
      .filter(
        (check) =>
          !check.flight?.placeholder && !check.flight?.unscored && !check.evidence?.unavailable,
      );
    if (!checks.length)
      return { status: "pending", passedRounds, firstFailedRound: null, baseline: null };
    if (checks.some((check) => check.machine !== "machine-pass"))
      return { status: "stopped", passedRounds, firstFailedRound: round, baseline: passedRounds };
    passedRounds++;
  }
  return { status: "complete", passedRounds, firstFailedRound: null, baseline: passedRounds };
}
