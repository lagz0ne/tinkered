import { test } from "node:test";
import assert from "node:assert/strict";
import { flightScore } from "./flight-score.mjs";

const passed = (round) => ({ round, checks: [{ machine: "machine-pass" }] });

await test("keeps the first failed round and its baseline after a retry passes", () => {
  const attempts = [passed(1), { round: 2, checks: [{ machine: "machine-fail" }] }, passed(2)];
  assert.deepEqual(flightScore(attempts), {
    status: "stopped",
    passedRounds: 1,
    firstFailedRound: 2,
    baseline: 1,
  });
});
await test("does not score missing teachers, network setup failures, or old placeholders", () => {
  const attempts = [
    {
      round: 1,
      checks: [
        { machine: "machine-fail", evidence: { unavailable: "round-1.mjs" } },
        { machine: "machine-fail", flight: { unscored: true } },
        { machine: "machine-pass", flight: { placeholder: true } },
      ],
    },
  ];
  assert.deepEqual(flightScore(attempts), {
    status: "pending",
    passedRounds: 0,
    firstFailedRound: null,
    baseline: null,
  });
});
await test("records a failure even when a prior check of that round passed", () => {
  assert.equal(
    flightScore([passed(1), { round: 1, checks: [{ machine: "machine-fail" }] }]).firstFailedRound,
    1,
  );
});
await test("counts only the passed prefix until the next round is checked", () => {
  assert.deepEqual(flightScore([passed(1), passed(2), passed(4)]), {
    status: "pending",
    passedRounds: 2,
    firstFailedRound: null,
    baseline: null,
  });
});
await test("records a full five-round pass", () => {
  assert.deepEqual(flightScore([1, 2, 3, 4, 5].map(passed)), {
    status: "complete",
    passedRounds: 5,
    firstFailedRound: null,
    baseline: 5,
  });
});

await test("missing plain does not erase a scaffold, own, or teacher failure", () => {
  for (const failed of ["scaffoldExit", "ownExit", "teacherExit"]) {
    const flight = {
      plainExit: 1,
      plainUnavailable: true,
      unscored: true,
      unavailable: "Image check:plain unavailable",
      scaffoldExit: 0,
      ownExit: 0,
      teacherExit: 0,
      [failed]: 1,
    };
    assert.deepEqual(
      flightScore([{ round: 1, checks: [{ machine: "machine-fail", flight }] }, passed(1)]),
      { status: "stopped", passedRounds: 0, firstFailedRound: 1, baseline: 0 },
    );
  }
});
await test("missing plain alone earns no round and no baseline", () => {
  assert.deepEqual(
    flightScore([
      {
        round: 1,
        checks: [
          {
            machine: "machine-fail",
            flight: {
              plainExit: 1,
              plainUnavailable: true,
              unscored: true,
              scaffoldExit: 0,
              ownExit: 0,
              teacherExit: 0,
            },
          },
        ],
      },
    ]),
    { status: "pending", passedRounds: 0, firstFailedRound: null, baseline: null },
  );
});
