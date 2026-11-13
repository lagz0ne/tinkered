import { preset } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import {
  capsule,
  createScope,
  data,
  derived,
  operation,
  resource,
  tag,
  type Data,
  type Operation,
  type Resource,
} from "@/index";

// ADR 0151: a unit that depends on a slot tag gets what it would get from the unit in that slot.

type Store = { readonly id: string };

const sqlite = resource({ label: "slot.sqlite", factory: (): Store => ({ id: "sqlite" }) });
const store = tag<Resource.Handle<Store>>({ label: "slot.store" });

/** The store's id, read through the slot. */
const whoami = operation({
  label: "slot.whoami",
  depends: { store },
  run: ({ store }) => store.id,
});

test("a resource slot arrives built", async () => {
  const scope = createScope({ tags: [store(sqlite)] });
  await scope.ready;

  expect(scope.run(whoami)).toBe("sqlite");
  await scope.close();
});

test("a preset on the resource in a slot reaches the unit that reads the slot", async () => {
  const scope = createScope({
    tags: [store(sqlite)],
    presets: [preset(sqlite, (): Store => ({ id: "fake" }))],
  });
  await scope.ready;

  expect(scope.run(whoami)).toBe("fake");
  await scope.close();
});

test("an operation slot arrives as a subflow to call", async () => {
  const shout = operation({
    label: "slot.shout",
    input: (raw: unknown) => String(raw),
    run: (_, { input }) => input.toUpperCase(),
  });
  const say = tag<Operation.Handle<string, string>>({ label: "slot.say" });
  const greet = operation({
    label: "slot.greet",
    depends: { say },
    run: ({ say }) => say.run({ input: "hi" }),
  });
  const scope = createScope({ tags: [say(shout)] });
  await scope.ready;

  expect(await scope.run(greet)).toBe("HI");
  await scope.close();
});

test("a cell slot arrives as its value, and a write reaches the next read", async () => {
  const count = data({ label: "slot.count", initial: 1 });
  const held = tag<Data.Cell<number>>({ label: "slot.cell" });
  const read = operation({ label: "slot.read", depends: { n: held }, run: ({ n }) => n });
  const scope = createScope({ tags: [held(count)] });
  await scope.ready;

  expect(scope.run(read)).toBe(1);
  scope.controller(count).set(2);
  expect(scope.run(read)).toBe(2);
  await scope.close();
});

test("a list slot gives each unit as depends delivers it, in the order the tag holds them", async () => {
  const pg = resource({ label: "slot.pg", factory: (): Store => ({ id: "pg" }) });
  const stores = tag<Resource.Handle<Store>>({ label: "slot.stores" });
  const ids = operation({
    label: "slot.ids",
    depends: { all: stores.all },
    run: ({ all }) => all.map((one) => one.id),
  });
  const scope = createScope({ tags: [stores(pg), stores(sqlite)] });
  await scope.ready;

  const bound = scope.resolve(stores.all).map((one) => (one === pg ? "pg" : "sqlite"));

  expect(scope.run(ids)).toEqual(bound);
  await scope.close();
});

test("an optional slot gives the value when bound and absence when not", async () => {
  const maybe = operation({
    label: "slot.maybe",
    depends: { found: store.optional },
    run: ({ found }) => (found.present ? found.value.id : "none"),
  });
  const bound = createScope({ tags: [store(sqlite)] });
  await bound.ready;
  const empty = createScope();
  await empty.ready;

  expect(bound.run(maybe)).toBe("sqlite");
  expect(empty.run(maybe)).toBe("none");
  await bound.close();
  await empty.close();
});

test("scope.resolve and a start hook's config read the handle as bound", async () => {
  const lib = capsule({
    label: "slot.lib",
    config: { store },
    hooks: {
      start: async ({ config, load }) => ({
        same: config.store === sqlite,
        got: await load(config.store, { role: "state", explain: "Holds the records" }),
      }),
    },
  });
  const scope = createScope({ capsules: [lib({ store: sqlite })] });
  await scope.ready;

  expect(scope.resolve(store)).toBe(sqlite);
  expect(scope.resolve(store.optional)).toEqual({ present: true, value: sqlite });
  expect(scope.resolve(lib)).toEqual({ same: true, got: { id: "sqlite" } });
  await scope.close();
});

test("a session resource in a slot ends with the session, as a direct dep does", async () => {
  const ended: string[] = [];
  const conn = resource({
    label: "slot.conn",
    target: "session",
    factory: (_, { defer }): Store => {
      defer((end) => void ended.push(end.status));
      return { id: "conn" };
    },
  });
  const slot = tag<Resource.Handle<Store>>({ label: "slot.session" });
  const viaSlot = operation({ label: "slot.viaSlot", depends: { c: slot }, run: ({ c }) => c.id });
  const direct = operation({ label: "slot.direct", depends: { c: conn }, run: ({ c }) => c.id });
  const scope = createScope({ tags: [slot(conn)] });
  await scope.ready;

  for (const read of [viaSlot, direct]) {
    const session = scope.createSession();
    expect(await session.run(read)).toBe("conn");
    await session.close();
  }

  expect(ended).toEqual(["cancelled", "cancelled"]);
  await scope.close();
});

test("a plain tag value arrives as is", async () => {
  const from = tag<string>({ label: "slot.from" });
  const read = operation({ label: "slot.from.read", depends: { from }, run: ({ from }) => from });
  const scope = createScope({ tags: [from("ops")] });
  await scope.ready;

  expect(scope.run(read)).toBe("ops");
  await scope.close();
});

test("a cell slot's controller edge gives get, set and watch on the cell it holds", async () => {
  const count = data({ label: "slot.ctl.count", initial: 1 });
  const held = tag<Data.Cell<number>>({ label: "slot.ctl.cell" });
  const bump = operation({
    label: "slot.ctl.bump",
    depends: { n: held.controller },
    run: ({ n }) => n.set(n.get() + 1),
  });
  const scope = createScope({ tags: [held(count)] });
  await scope.ready;

  scope.run(bump);

  expect(scope.resolve(count)).toBe(2);
  await scope.close();
});

test("an operation slot's controller edge gives that operation's controller", async () => {
  const twice = operation({
    label: "slot.ctl.twice",
    input: (raw: unknown) => Number(raw),
    run: (_, { input }) => input * 2,
  });
  const held = tag<Operation.Handle<number, number>>({ label: "slot.ctl.op" });
  const call = operation({
    label: "slot.ctl.call",
    depends: { op: held.controller },
    run: ({ op }) => op.run({ input: 4 }),
  });
  const scope = createScope({ tags: [held(twice)] });
  await scope.ready;

  expect(await scope.run(call)).toBe(8);
  await scope.close();
});

test("a resource slot has no controller edge, as a bare resource has none", () => {
  const edge: never = store.controller;

  expect(edge).toMatchObject({ kind: "controller" });
});

test("an async resource in a slot arrives built, in a resource and in an operation", async () => {
  const slow = resource({
    label: "slot.slow",
    factory: async (): Promise<Store> => ({ id: "slow" }),
  });
  const held = tag<Resource.Handle<Promise<Store>>>({ label: "slot.async" });
  const wrap = resource({
    label: "slot.wrap",
    depends: { s: held },
    factory: ({ s }) => `wrapped ${s.id}`,
  });
  const read = operation({ label: "slot.async.read", depends: { s: held }, run: ({ s }) => s.id });
  const scope = createScope({ tags: [held(slow)] });
  await scope.ready;

  expect(await scope.run(read)).toBe("slow");
  expect(await scope.resolve(wrap)).toBe("wrapped slow");
  await scope.close();
});

test("an async resource in a list slot arrives built", async () => {
  const slow = resource({
    label: "slot.slow.all",
    factory: async (): Promise<Store> => ({ id: "slow" }),
  });
  const held = tag<Resource.Handle<Promise<Store>>>({ label: "slot.async.all" });
  const ids = operation({
    label: "slot.async.ids",
    depends: { all: held.all, one: held.optional },
    run: ({ all, one }) => [...all.map((s) => s.id), one.present ? one.value.id : "none"],
  });
  const scope = createScope({ tags: [held(slow)] });
  await scope.ready;

  expect(await scope.run(ids)).toEqual(["slow", "slow"]);
  await scope.close();
});

test("a resource that reads a slot rebuilds when the resource in the slot is released", async () => {
  let builds = 0;
  const base = resource({ label: "slot.base", factory: () => `b${++builds}` });
  const slot = tag<Resource.Handle<string>>({ label: "slot.base.held" });
  const listSlot = tag<Resource.Handle<string>>({ label: "slot.base.list" });
  const viaSlot = resource({
    label: "slot.viaSlot",
    depends: { s: slot, all: listSlot.all },
    factory: ({ s, all }) => `${s}:${all.join()}`,
  });
  const scope = createScope({ tags: [slot(base), listSlot(base)] });
  await scope.ready;

  expect(scope.resolve(viaSlot)).toBe("b1:b1");
  await scope.release(base);
  expect(scope.resolve(viaSlot)).toBe("b2:b2");
  await scope.close();
});

test("scope.resolve of a slot's controller edge gives the controller", async () => {
  const count = data({ label: "slot.res.count", initial: 1 });
  const held = tag<Data.Cell<number>>({ label: "slot.res.cell" });
  const scope = createScope({ tags: [held(count)] });
  await scope.ready;

  const control = scope.resolve(held.controller as never) as { set(n: number): void };
  control.set(5);

  expect(scope.resolve(count)).toBe(5);
  await scope.close();
});

test("a plain value in a required slot of a resource arrives as is, null too", async () => {
  const wasm = tag<string | null>({ label: "slot.wasm" });
  const loader = resource({
    label: "slot.loader",
    depends: { wasm: wasm.required },
    factory: ({ wasm }) => wasm ?? "none",
  });
  const scope = createScope({ tags: [wasm(null)] });
  await scope.ready;

  expect(scope.resolve(loader)).toBe("none");
  await scope.close();
});

test("a resource that reads one slot through .all, .optional or .required rebuilds on release", async () => {
  let builds = 0;
  const base = resource({ label: "slot.edge.base", factory: () => `b${++builds}` });
  const viaAll = tag<Resource.Handle<string>>({ label: "slot.edge.all" });
  const viaOptional = tag<Resource.Handle<string>>({ label: "slot.edge.optional" });
  const viaRequired = tag<Resource.Handle<string>>({ label: "slot.edge.required" });

  const readers = [
    resource({
      label: "slot.edge.readAll",
      depends: { s: viaAll.all },
      factory: ({ s }) => s.join(),
    }),
    resource({
      label: "slot.edge.readOptional",
      depends: { s: viaOptional.optional },
      factory: ({ s }) => (s.present ? s.value : "none"),
    }),
    resource({
      label: "slot.edge.readRequired",
      depends: { s: viaRequired.required },
      factory: ({ s }) => s,
    }),
  ];

  for (const reader of readers) {
    builds = 0;
    const scope = createScope({ tags: [viaAll(base), viaOptional(base), viaRequired(base)] });
    await scope.ready;

    expect(scope.resolve(reader)).toBe("b1");
    await scope.release(base);
    expect(scope.resolve(reader)).toBe("b2");
    await scope.close();
  }
});

test("a cell that holds a promise arrives as that promise; only a resource or a slot waits", async () => {
  const held = Promise.resolve(7);
  const pending = data<Promise<number>>({ label: "slot.park.cell", initial: held });
  const slow = resource({ label: "slot.park.slow", factory: async () => 1 });
  const both = resource({
    label: "slot.park.both",
    depends: { pending, slow },
    factory: async ({ pending, slow }) => ({ pending, slow }),
  });
  const scope = createScope();
  await scope.ready;

  const got = await scope.resolve(both);

  expect(got.pending).toBe(held);
  expect(got.slow).toBe(1);
  await scope.close();
});

test("a derived that reads a cell slot through .required gets the cell's value", async () => {
  const count = data({ label: "slot.derived.count", initial: 3 });
  const held = tag<Data.Cell<number>>({ label: "slot.derived.cell" });
  const doubled = derived({
    label: "slot.derived.doubled",
    depends: { n: held.required },
    factory: ({ n }) => n * 2,
  });
  const scope = createScope({ tags: [held(count)] });
  await scope.ready;

  expect(scope.resolve(doubled).get()).toBe(6);
  await scope.close();
});
