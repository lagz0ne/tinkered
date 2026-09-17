import { createScope, data, makeTestClock, operation, resource, tag } from "../src/index.ts";

/** A cast-free tour of the public API: every value's type is INFERRED — no `as`, no non-null `!`. */
export async function tour(): Promise<number> {
  const region = tag<string>({ label: "region" });
  const count = data({ label: "count", initial: 0 });

  const doubled = operation({
    label: "doubled",
    depends: { n: count },
    run: ({ n }) => n * 2,
  });

  const store = resource({
    label: "store",
    factory: (_deps, { defer }) => {
      const rows: string[] = [];
      defer((end) => {
        if (end.status !== "success") rows.length = 0;
      });
      return { add: (row: string) => rows.push(row), size: () => rows.length };
    },
  });

  // Time is an ambient capability on every ctx; inject a controllable clock at the scope so this
  // reads a fixed instant with no `Date.now` mock and no fake timers.
  const stamp = operation({
    label: "stamp",
    run: (_deps, { clock }) => clock.currentTimeMillis(),
  });

  const scope = createScope({ tags: [region("eu")], clock: makeTestClock({ now: 0 }) });
  const c = scope.controller(count);
  c.set(21);
  const seen: number[] = [];
  c.watch((v) => seen.push(v));

  const n = scope.run(doubled); // run an operation now
  const inline = scope.run(
    { depends: { count }, run: ({ count }, { input }) => count + input },
    { input: 1 },
  ); // an inline body: same call object, one span, nothing cached
  const s = scope.resolve(store); // read a snapshot: builds the resource once
  s.add("first");
  const t = scope.run(stamp); // 0 — the injected test clock, deterministic

  const inSession = await scope.session((child) => {
    child.controller(count).set(100); // give back control: a write handle
    return child.run(doubled);
  });

  const result = await scope.close();
  const teardownOk = result.status === "success" || result.status === "cancelled";
  return n + s.size() + inSession + c.get() + seen.length + t + inline + (teardownOk ? 0 : 1);
}
