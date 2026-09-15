import { createScope, data, operation, resource, tag } from "../src/index.ts";

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

  const scope = createScope({ tags: [region("eu")] });
  const c = scope.getController(count);
  c.set(21);
  const seen: number[] = [];
  c.watch((v) => seen.push(v));

  const n = scope.getController(doubled).resolve();
  const s = scope.getController(store).resolve();
  s.add("first");

  const inSession = await scope.session((child) => {
    child.getController(count).set(100);
    return child.getController(doubled).resolve();
  });

  const result = await scope.close();
  const teardownOk = result.status === "success" || result.status === "cancelled";
  return n + s.size() + inSession + c.get() + seen.length + (teardownOk ? 0 : 1);
}
