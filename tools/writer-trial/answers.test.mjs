import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reusedAnswer, sourceHashOf, writerAnswers } from "./answers.mjs";

const SOURCE = "export function idText(id: unknown): string { return String(id); }\n";
const event = (over = {}) =>
  JSON.stringify({
    time: "2026-09-23T13:30:32.429Z",
    kind: "jev",
    file: "src/pure.ts",
    sourceHash: sourceHashOf(SOURCE),
    rows: [{ unit: "idText", findings: [{ id: "inputDefaultMasks", probability: 0.82 }] }],
    plainFindings: [],
    ...over,
  });

void describe("the writer's own Jev answers", () => {
  void it("gives the teacher the writer's answer for the same file bytes", () => {
    const answers = writerAnswers(`${event()}\n`);
    const report = reusedAnswer(answers, "src/pure.ts", SOURCE);
    assert.equal(report.rows[0].findings[0].probability, 0.82);
    assert.equal(report.reused.from, "writer");
  });

  void it("gives nothing once the file bytes changed", () => {
    const answers = writerAnswers(`${event()}\n`);
    assert.equal(reusedAnswer(answers, "src/pure.ts", `${SOURCE}// edit\n`), null);
  });

  void it("keeps the writer's last answer for the same bytes", () => {
    const later = event({ time: "2026-09-23T13:40:00.000Z" });
    const answers = writerAnswers(`${event()}\n${later}\n`);
    assert.equal(
      reusedAnswer(answers, "src/pure.ts", SOURCE).reused.at,
      "2026-09-23T13:40:00.000Z",
    );
  });

  void it("never reuses a report with a unit Jev did not judge", () => {
    const partial = event({ rows: [{ unit: "idText", status: "not-run", reason: "limit" }] });
    assert.equal(reusedAnswer(writerAnswers(`${partial}\n`), "src/pure.ts", SOURCE), null);
  });

  void it("skips lines that are not complete Jev events", () => {
    const text = `not json\n${JSON.stringify({ kind: "shell", command: "ls" })}\n`;
    assert.equal(writerAnswers(text).size, 0);
  });
});
