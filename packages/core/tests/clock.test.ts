import { expect, test } from "vite-plus/test";
import { createScope, makeTestClock, operation } from "../src/index.ts";

test("a test-clock sleep with an already-aborted signal rejects with the abort reason", async () => {
  const clock = makeTestClock({ now: 0 });
  const reason = new Error("stop-now");
  const ac = new AbortController();
  ac.abort(reason);
  const nap = operation({
    label: "nap",
    run: (_deps, { clock: tick }) => tick.sleep(1000, ac.signal),
  });
  await expect(createScope({ clock }).controller(nap).run()).rejects.toBe(reason);
});

test("a system-clock sleep with an already-aborted signal rejects with the abort reason", async () => {
  const reason = new Error("halt-now");
  const ac = new AbortController();
  ac.abort(reason);
  const nap = operation({
    label: "sysnap",
    run: (_deps, { clock }) => clock.sleep(60_000, ac.signal),
  });
  await expect(createScope().controller(nap).run()).rejects.toBe(reason);
});

test("the system clock's nanos advance with wall time", async () => {
  const readings: bigint[] = [];
  const read = operation({
    label: "read",
    run: (_deps, { clock }) => {
      readings.push(clock.currentTimeNanos());
      return clock.sleep(5).then(() => {
        readings.push(clock.currentTimeNanos());
        return 1;
      });
    },
  });
  await createScope().controller(read).run();
  expect(readings[1] > readings[0]).toBe(true);
});

test("a system-clock sleep with no signal resolves", async () => {
  const nap = operation({
    label: "nap",
    run: (_deps, { clock }) => clock.sleep(1).then(() => "woke"),
  });
  expect(await createScope().controller(nap).run()).toBe("woke");
});

test("a system-clock sleep with a live signal resolves", async () => {
  const ac = new AbortController();
  const nap = operation({
    label: "nap",
    run: (_deps, { clock }) => clock.sleep(1, ac.signal).then(() => "woke"),
  });
  expect(await createScope().controller(nap).run()).toBe("woke");
});

test("due test-clock sleeps wake earliest-first", async () => {
  const clock = makeTestClock({ now: 0 });
  const seen: string[] = [];
  const scope = createScope({ clock });
  const late = scope
    .controller(
      operation({
        label: "late",
        run: (_deps, { clock: tick }) =>
          tick.sleep(200).then(() => {
            seen.push("late");
            return "late";
          }),
      }),
    )
    .run();
  const early = scope
    .controller(
      operation({
        label: "early",
        run: (_deps, { clock: tick }) =>
          tick.sleep(100).then(() => {
            seen.push("early");
            return "early";
          }),
      }),
    )
    .run();
  clock.advance(200);
  await Promise.all([late, early]);
  expect(seen).toEqual(["early", "late"]);
});

test("a system-clock sleep cleans its timer after an abort", async () => {
  const ac = new AbortController();
  const cause = new Error("halt-now");
  const nap = operation({
    label: "nap",
    run: (_deps, { clock }) =>
      clock.sleep(60_000, ac.signal).then(
        () => "woke",
        (error: unknown) => error,
      ),
  });
  const scope = createScope();
  const pending = scope.controller(nap).run() as Promise<unknown>;
  ac.abort(cause);
  expect(await pending).toBe(cause);
  await scope.close();
});

test("a test-clock sleep set into the past wakes at once", async () => {
  const clock = makeTestClock({ now: 1000 });
  const seen: number[] = [];
  const scope = createScope({ clock });
  const nap = scope
    .controller(
      operation({
        label: "nap",
        run: (_deps, { clock: tick }) =>
          tick.sleep(500).then(() => {
            seen.push(tick.currentTimeMillis());
            return "woke";
          }),
      }),
    )
    .run() as Promise<unknown>;
  clock.setTime(2000);
  expect(await nap).toBe("woke");
  expect(seen).toEqual([2000]);
});
