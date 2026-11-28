import { capsule, data, operation, resource, tag } from "@tinkered/core";

/** Where the app runs: the cmd fills it. */
const region = tag<string>({ label: "basic.region" });

/** One number. Others read it; only `setCount` changes it. */
const count = data({ label: "basic.count", initial: 0 });

/** Sets the count. */
const setCount = operation({
  label: "basic.setCount",
  depends: { count: count.controller },
  run: ({ count }, { input }: { input: number }) => {
    count.set(input);
  },
});

/** The count, twice. */
const doubled = operation({
  label: "basic.doubled",
  depends: { n: count },
  run: ({ n }) => n * 2,
});

/** The region and the count, as `eu:21`. */
const where = operation({
  label: "basic.where",
  depends: { region, n: count },
  run: ({ region, n }) => `${region}:${n}`,
});

/** Rows kept for the scope's life; a failed end drops them. */
const store = resource({
  label: "basic.store",
  factory: (_deps, { defer }) => {
    const rows: string[] = [];
    defer((end) => {
      if (end.status !== "success") rows.length = 0;
    });
    return { add: (row: string) => rows.push(row), size: () => rows.length };
  },
});

/** The entry supplies a test clock, so this reads a fixed instant without fake timers. */
const stamp = operation({
  label: "basic.stamp",
  run: (_deps, { clock }) => clock.currentTimeMillis(),
});

/** The example's one capsule: `basic({ region: "eu" })`. */
export const basic = capsule({
  label: "basic",
  config: { region: region.required },
  exports: { count, setCount, doubled, where, store, stamp },
});
