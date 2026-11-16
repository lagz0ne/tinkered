// Replays the Round model's bug path (/home/paseo/statechart/core2/round), one step per action.
// Rules: RoundEndsAtRest and EveryWatcherTold (ADR 0152 d1, d3).
// The round flag is a module global, so this file holds one test only: after it, no watcher
// in this module hears a write.
import { expect, test } from "vite-plus/test";

import { createScope, data, namespace } from "@/main";

type Row = { id: number } | null;

test("RoundEndsAtRest + EveryWatcherTold path: an eq throws in a write's first round", () => {
  // Set-up: cell A's eq guards only its second value (a common slip).
  const a = data<Row>({
    label: "round.a",
    initial: { id: 1 },
    eq: (x, y) => (x as { id: number }).id === y?.id,
  });
  const ns = namespace();
  const scope = createScope();
  const aInNs = scope.controller(a, { ns });
  aInNs.watch(() => {});
  aInNs.set(null); // The namespaced watcher now last heard null.

  const b = data({ label: "round.b", initial: 0 });
  const other = createScope();
  const bControl = other.controller(b);
  const heard: number[] = [];
  bControl.watch((next) => heard.push(next));
  bControl.set(1);
  expect(heard).toEqual([1]); // Control: b1 hears a write before the bug.

  // 1. You write cell A. Its first round starts (tellWrite sets inRound).
  // 2. The cell's eq throws in that first round: eq(null, null) in pendingNsWatchers.
  const write = (): unknown => {
    try {
      scope.controller(a).set({ id: 2 });
    } catch (error) {
      return error;
    }
    return undefined;
  };
  expect(write()).toBeInstanceOf(TypeError);

  // 3. You write cell B, in another scope. The write lands (ADR 0152 d2) ...
  bControl.set(2);
  expect(bControl.get()).toBe(2);
  // ... and its watcher must hear it (ADR 0152 d1, d3).
  expect(heard).toEqual([1, 2]);
});
