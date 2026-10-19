import { expect, test } from "vite-plus/test";

import { createScope, namespace, resource } from "@/index";

test("a settled async resource still resolves to a promise, with or without a kept controller", async () => {
  let builds = 0;
  const slow = resource({ label: "slow", factory: async () => ({ build: ++builds }) });
  const scope = createScope();

  const value = await scope.resolve(slow);
  const settled = scope.resolve(slow);
  expect(settled).toBeInstanceOf(Promise);
  expect(await settled).toBe(value);

  const kept = scope.controller(slow);
  expect(scope.resolve(slow)).toBe(kept.resolve());
  expect(builds).toBe(1);

  return scope.close();
});

test("a namespaced session resolves its own async bucket, before and after a kept controller", async () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    factory: async () => ({ build: ++builds }),
  });
  const scope = createScope();
  const inA = scope.createSession({ ns: a });
  const inB = scope.createSession({ ns: b });

  const fromA = await inA.resolve(client);
  const fromB = await inB.resolve(client);
  expect(fromB).not.toBe(fromA);

  const settled = inA.resolve(client);
  expect(settled).toBeInstanceOf(Promise);
  expect(await settled).toBe(fromA);

  expect(inA.resolve(client)).toBe(inA.controller(client).resolve());
  expect(builds).toBe(2);

  return scope.close();
});
