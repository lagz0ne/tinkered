import { expect, test } from "vite-plus/test";
import { createScope, data, namespace, operation, resource, tag } from "../src/index.ts";

test("ambient namespace survives child, tagged subflow, inline run, and imperative controllers", async () => {
  const tenant = tag<string>({ label: "tenant" });
  const marker = tag({ label: "marker", default: false });
  const a = namespace({ tags: [tenant("A")] });
  const b = namespace({ tags: [tenant("B")] });
  const cell = data({ initial: 0 });
  const client = resource({
    label: "client",
    target: "session",
    depends: { tenant },
    factory: ({ tenant }) => tenant,
  });
  const leaf = operation({
    label: "leaf",
    depends: { tenant, marker, cell },
    run: ({ tenant, marker, cell }) => ({ tenant, marker, cell }),
  });
  const parent = operation({
    label: "parent",
    depends: { leaf },
    run: ({ leaf }) => leaf.run({ tags: [marker(true)] }),
  });
  const scope = createScope();
  scope.controller(cell, { ns: a }).set(1);
  scope.controller(cell, { ns: b }).set(2);
  const session = scope.createSession({ ns: a });
  const child = session.createSession();
  expect(child.resolve(tenant)).toBe("A");
  expect(await child.run(parent)).toEqual({ tenant: "A", marker: true, cell: 1 });
  expect(
    child.run({ depends: { tenant, cell }, run: ({ tenant, cell }) => [tenant, cell] }),
  ).toEqual(["A", 1]);
  expect(child.controller(cell).get()).toBe(1);
  expect(child.controller(client).resolve()).toBe("A");
  expect(child.resolve(client)).toBe("A");
  expect(child.resolve(client, { ns: b })).toBe("B");
  expect(child.controller(cell, { ns: b }).get()).toBe(2);
  expect(child.resolve(client)).toBe("A");
  expect(child.controller(cell).get()).toBe(1);
  expect(await child.run(parent)).toEqual({ tenant: "A", marker: true, cell: 1 });
  await scope.close();
});
