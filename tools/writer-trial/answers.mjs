// The writer's own Jev answers, reused by the teacher. Jev is not
// deterministic: the same unit can score 0.82 for the writer and 0.85
// for the teacher, on opposite sides of a threshold (ballot-01). The
// gate promised the writer a verdict for exact source bytes; the
// teacher keeps that promise for a file whose bytes did not change.
// Pure: parses event lines, never reads files or calls Jev.
import { createHash } from "node:crypto";

/** The sha256 of one file's source, as the broker records it. */
export const sourceHashOf = (source) => createHash("sha256").update(source).digest("hex");

/** A writer report the teacher may reuse: every unit was judged. */
const complete = (event) =>
  event.kind === "jev" &&
  typeof event.file === "string" &&
  typeof event.sourceHash === "string" &&
  Array.isArray(event.rows) &&
  Array.isArray(event.plainFindings) &&
  event.rows.every((row) => row.status !== "not-run");

/** file + hash → the writer's last complete report for those bytes. */
export function writerAnswers(eventText) {
  const answers = new Map();
  for (const line of eventText.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (complete(event)) answers.set(`${event.file}\0${event.sourceHash}`, event);
  }
  return answers;
}

/** The writer's report for these exact bytes, marked reused, or null. */
export function reusedAnswer(answers, file, source) {
  const event = answers.get(`${file}\0${sourceHashOf(source)}`);
  if (event === undefined) return null;
  return {
    file,
    rows: event.rows,
    plainFindings: event.plainFindings,
    reused: { from: "writer", at: event.time ?? null },
  };
}
