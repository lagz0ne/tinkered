import { expect, test } from "vite-plus/test";
import { createScope, data, namespace, resource, tag } from "../src/index.ts";

test("named and chained cell watches notify only when their resolved value changes", async () => {
  const a = namespace();
  const b = namespace();
  const cell = data({ initial: 0 });
  const scope = createScope();
  const named: [number, number][] = [];
  const chain: [number, number][] = [];
  scope.controller(cell, { ns: a }).watch((next, prev) => named.push([prev, next]));
  scope.controller(cell, { ns: [a, b] }).watch((next, prev) => chain.push([prev, next]));
  scope.controller(cell, { ns: b }).set(1);
  expect(named).toEqual([]);
  expect(chain).toEqual([[0, 1]]);
  scope.controller(cell, { ns: b }).set(2);
  expect(chain).toEqual([[0, 1], [1, 2]]);
  scope.controller(cell, { ns: a }).set(3);
  expect(named).toEqual([[0, 3]]);
  expect(chain).toEqual([[0, 1], [1, 2], [2, 3]]);
  scope.controller(cell).set(9);
  expect(named).toEqual([[0, 3]]);
  expect(chain).toEqual([[0, 1], [1, 2], [2, 3]]);
  await scope.close();
});

test("a failed named resource retries without leaking to a sibling chain", async () => {
  const tenant = tag<string>({ label: "tenant" });
  const a = namespace({ tags: [tenant("A")] });
  const b = namespace({ tags: [tenant("B")] });
  let fail = true;
  const built: string[] = [];
  const client = resource({
    label: "client",
    target: "session",
    depends: { tenant },
    factory: ({ tenant }) => {
      built.push(tenant);
      if (tenant === "A" && fail) throw new Error("not ready");
      return tenant;
    },
  });
  const scope = createScope();
  expect(() => scope.resolve(client, { ns: a })).toThrow("not ready");
  expect(scope.resolve(client, { ns: [b, a] })).toBe("B");
  fail = false;
  expect(scope.resolve(client, { ns: a })).toBe("A");
  expect(scope.resolve(client, { ns: [b, a] })).toBe("B");
  expect(built).toEqual(["A", "B", "A"]);
  await scope.close();
});
