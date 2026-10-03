/** A wiring check earns no rounds. The first scored failure stays final across retries. */
export function flightScore(attempts) {
  let passedRounds = 0;
  for (const round of [1, 2, 3, 4, 5]) {
    const checks = attempts
      .filter((attempt) => attempt.round === round)
      .flatMap((attempt) => attempt.checks ?? [])
      .filter(
        (check) =>
          !check.flight?.placeholder &&
          !check.evidence?.unavailable &&
          (!check.flight?.unscored || failedAlongsideMissingPlain(check.flight)),
      );
    if (!checks.length)
      return { status: "pending", passedRounds, firstFailedRound: null, baseline: null };
    if (checks.some((check) => check.machine !== "machine-pass"))
      return { status: "stopped", passedRounds, firstFailedRound: round, baseline: passedRounds };
    passedRounds++;
  }
  return { status: "complete", passedRounds, firstFailedRound: null, baseline: passedRounds };
}

/** A missing plain checker cannot erase failures from checks that did run. */
function failedAlongsideMissingPlain(flight) {
  const missingPlain =
    flight.plainUnavailable === true ||
    (flight.plainExit === 1 && flight.unavailable === "Image check:plain script unavailable");
  return (
    missingPlain &&
    [flight.scaffoldExit, flight.ownExit, flight.teacherExit].some((exit) => exit === 1)
  );
}
