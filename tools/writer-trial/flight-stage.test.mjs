import assert from "node:assert/strict";
import { test } from "node:test";
import { stageableFlightWorkers } from "./flight-stage.mjs";

await test("a stopped model does not block passing workers; unchecked rounds still refuse", () => {
  const worker = (machine) => ({
    model: machine,
    attempts: [{ round: 1, agentId: "saved-model-run", checks: [{ machine }] }],
  });
  const stopped = worker("machine-fail"),
    passing = worker("machine-pass");
  const pending = {
    model: "pending",
    attempts: [{ round: 1, agentId: "saved-model-run", checks: [] }],
  };
  const result = stageableFlightWorkers([stopped, passing], 1);
  assert.deepEqual(result.ready, [passing]);
  assert.deepEqual(
    result.skipped.map(({ worker }) => worker),
    [stopped],
  );
  assert.match(result.skipped[0].reason, /stopped at round 1; baseline 0/);
  assert.throws(
    () => stageableFlightWorkers([stopped, passing, pending], 1),
    /Check round 1 for pending/,
  );
});
await test("reference proofs stay stageable and all stopped models give no ready worker", () => {
  const stopped = {
    attempts: [{ round: 1, agentId: "saved-model-run", checks: [{ machine: "machine-fail" }] }],
  };
  assert.equal(stageableFlightWorkers([stopped], 1).ready.length, 0);
  const reference = { attempts: [{ round: 1, checks: [{ machine: "machine-fail" }] }] };
  assert.deepEqual(stageableFlightWorkers([stopped, reference], 1).ready, [reference]);
});
