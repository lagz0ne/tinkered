import { expect, test } from "vite-plus/test";

import { capsule, createScope, data, namespace, operation } from "@/index";

// ADR 0126: the edge picks the layer a write lands on, in resource-target words (ADR 0064):
//   held.controller               the caller's own layer (as `session`)
//   held.atNamespace.controller   the root, in the caller's namespace (as `namespace`)
//   held.atScope.controller       the root, outside any namespace (as `scope`)

const held = data<string | null>({ label: "held", initial: null });
const ann = namespace();
const bob = namespace();
type Placement = "own" | "namespace" | "scope";

const edgeOf = (at: Placement) =>
  at === "own"
    ? held.controller
    : at === "namespace"
      ? held.atNamespace.controller
      : held.atScope.controller;

const write = (at: Placement, value: string) =>
  operation({
    label: `write.${at}`,
    depends: { c: edgeOf(at) },
    run: async ({ c }) => c.set(value),
  });

const signal = () => ({ signal: new AbortController().signal });

test("P1 each placement lands where its resource-target word says", async () => {
  const scope = createScope();
  const annSession = scope.createSession({ ns: ann });
  const bobSession = scope.createSession({ ns: bob });
  const seen = () => ({
    root: scope.resolve(held),
    ann: scope.resolve(held, { ns: ann }),
    bob: scope.resolve(held, { ns: bob }),
  });

  await annSession.run(write("own", "own"), signal());
  expect(seen()).toEqual({ root: null, ann: null, bob: null });

  await annSession.run(write("namespace", "ann only"), signal());
  expect(seen()).toEqual({ root: null, ann: "ann only", bob: null });

  await bobSession.run(write("scope", "everyone"), signal());
  expect(seen()).toEqual({ root: "everyone", ann: "ann only", bob: "everyone" });

  await annSession.close();
  await bobSession.close();
  await scope.close();
});

test("P2 with no namespace, atNamespace and atScope both land in the root's own bucket", async () => {
  const scope = createScope();
  const session = scope.createSession();

  await session.run(write("namespace", "n"), signal());
  expect(scope.resolve(held)).toBe("n");

  await session.run(write("scope", "s"), signal());
  expect(scope.resolve(held)).toBe("s");

  await session.close();
  await scope.close();
});

test("P3 a session's own write never climbs; its shadow wins its own reads", async () => {
  const scope = createScope();
  const session = scope.createSession();

  await session.run(write("own", "mine"));
  expect(scope.resolve(held)).toBe(null);
  expect(session.resolve(held)).toBe("mine");

  await session.run(write("scope", "root"));
  expect(scope.resolve(held)).toBe("root");
  expect(session.resolve(held)).toBe("mine");

  await session.close();
  await scope.close();
});

test("P4 atScope from a call two levels below a session still lands at the root", async () => {
  const inner = write("scope", "deep");
  const outer = operation({
    label: "outer",
    depends: { inner: inner.controller },
    run: async ({ inner }) => inner.run(signal()),
  });
  const scope = createScope();
  const session = scope.createSession();

  await session.run(outer, signal());
  expect(scope.resolve(held)).toBe("deep");

  await session.close();
  await scope.close();
});

test("P6 a placed controller kept past its call still writes the root, and watchers see it", async () => {
  const keep = operation({
    label: "keep",
    depends: { c: held.atScope.controller },
    run: async ({ c }) => c,
  });
  const scope = createScope();
  const seen: (string | null)[] = [];
  const unwatch = scope.controller(held).watch((now) => seen.push(now));

  const kept = await scope.run(keep, signal());
  kept.set("after the call");

  expect(scope.resolve(held)).toBe("after the call");
  expect(kept.get()).toBe("after the call");
  expect(seen).toEqual(["after the call"]);

  unwatch();
  await scope.close();
});

test("P5 a read view has no placement, at run time and in the types", () => {
  const own = data({ label: "own", initial: 1 });
  const feature = capsule({ label: "feature", exports: { own } });
  // @ts-expect-error: a read view has no atScope
  expect(feature.own.atScope).toBeUndefined();
  // @ts-expect-error: a read view has no atNamespace
  expect(feature.own.atNamespace).toBeUndefined();
  expect(own.atScope.controller.kind).toBe("controller");
});
