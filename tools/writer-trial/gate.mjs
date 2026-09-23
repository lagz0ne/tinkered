// The writer-trial Jev gate: one rule, read by the broker (so the
// writer sees what blocks) and by review.mjs check (so the teacher
// refuses a snapshot that fails it). Pure: no fs, no network.
//
//   - A plain shape finding always blocks.
//   - A Jev hit blocks when its judge is `proven` in the calibration.
//   - A Jev hit on a provisional, noisy, or uncalibrated judge is advice.
//   - A missing or failed check is `unavailable`, never a pass.
//
// The repo's own tools/jev stays advisory; this gate is trial-only.

// Every blocking item says how to clear it: a plain rule's message names
// the allowed form; a Jev judge carries its own `fix` line (older frozen
// banks have none, so `fix` is null there).
const shapeItem = (file, finding) => ({
  file,
  line: finding.line,
  rule: finding.id,
  message: finding.message,
  fix: finding.message,
});

const jevItem = (file, row, finding) => ({
  file,
  unit: row.unit,
  judge: finding.id,
  probability: finding.probability,
  calibration: finding.calibration,
  fix: finding.fix ?? null,
});

const listOf = (value) => (Array.isArray(value) ? value : []);

function unavailableReasons(report) {
  if (report.error) return [`${report.file ?? "jev"}: ${report.error}`];
  const missing = [
    [report.plainFindings, "shape check returned no finding list"],
    [report.rows, "Jev returned no rows"],
  ]
    .filter(([value]) => !Array.isArray(value))
    .map(([, why]) => `${report.file}: ${why}`);
  const notRun = listOf(report.rows)
    .filter((row) => row.status === "not-run")
    .map((row) => `${report.file} ${row.unit}: ${row.reason}`);
  return [...missing, ...notRun];
}

const jevHits = (report) =>
  listOf(report.rows).flatMap((row) =>
    (row.findings ?? [])
      .filter((finding) => finding.hit)
      .map((finding) => jevItem(report.file, row, finding)),
  );

/** The gate for one judged file: `block` names every blocking finding, `advice` every
 *  non-blocking Jev hit, and `unavailable` wins when any part of the check did not run. */
export function gateOf(report) {
  const reasons = unavailableReasons(report);
  const hits = jevHits(report);
  const blocking = [
    ...listOf(report.plainFindings).map((finding) => shapeItem(report.file, finding)),
    ...hits.filter((item) => item.calibration === "proven"),
  ];
  const advice = hits.filter((item) => item.calibration !== "proven");
  const status = reasons.length ? "unavailable" : blocking.length ? "block" : "pass";
  return { status, blocking, advice, reasons };
}

/** One gate across many files: any unavailable file makes the whole gate unavailable,
 *  else any block blocks. No files judged is unavailable, never a clean pass. */
export function gateFiles(reports) {
  if (!reports.length)
    return { status: "unavailable", blocking: [], advice: [], reasons: ["no files judged"] };
  const gates = reports.map(gateOf);
  const has = (status) => gates.some((gate) => gate.status === status);
  return {
    status: has("unavailable") ? "unavailable" : has("block") ? "block" : "pass",
    blocking: gates.flatMap((gate) => gate.blocking),
    advice: gates.flatMap((gate) => gate.advice),
    reasons: gates.flatMap((gate) => gate.reasons),
  };
}

/** The machine verdict of one check. `gate` is null for an old trial with no frozen
 *  Jev copy: its verdict stays own + teacher exits, as before the gate. */
export function machineVerdict({ ownExit, teacherExit, gate }) {
  const gatePass = gate === null || gate.status === "pass";
  return ownExit === 0 && teacherExit === 0 && gatePass ? "machine-pass" : "machine-fail";
}
