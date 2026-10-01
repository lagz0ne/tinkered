import { data, operation, resource, tag } from "@tinker/core";

export const region = tag<string>({ label: "region" });
export const count = data({ label: "count", initial: 0 });

export const doubled = operation({
  label: "doubled",
  depends: { n: count },
  run: ({ n }) => n * 2,
});

export const store = resource({
  label: "store",
  factory: (_deps, { defer }) => {
    const rows: string[] = [];
    defer((end) => {
      if (end.status !== "success") rows.length = 0;
    });
    return { add: (row: string) => rows.push(row), size: () => rows.length };
  },
});

/** The entry supplies a test clock, so this reads a fixed instant without fake timers. */
export const stamp = operation({
  label: "stamp",
  run: (_deps, { clock }) => clock.currentTimeMillis(),
});
