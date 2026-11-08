import { expect, expectTypeOf, test } from "vite-plus/test";

import { capsule, createScope, data, operation, type Data, type Operation } from "@/index";

const draft = data({ label: "talk.draft", initial: "" });

const clear = operation({
  label: "talk.clear",
  depends: { draft: draft.controller },
  run: ({ draft }) => draft.set(""),
});

/** A stand-in for a React component: Core only sees a function. */
function Panel(props: { readonly title: string }): string {
  return props.title;
}

const talk = capsule({ label: "talk", exports: { draft, clear, Panel } });

test("F1 a foreign export is the same object on the handle and on each binding, typed", () => {
  expect(talk.Panel).toBe(Panel);
  expect(talk().Panel).toBe(Panel);

  expectTypeOf(talk.Panel).toEqualTypeOf<typeof Panel>();
});

test("F2 a foreign export leaves the other exports their own types", () => {
  expectTypeOf(talk.draft).toEqualTypeOf<Data.View<string>>();
  expectTypeOf(talk.clear).toEqualTypeOf<Operation.Handle<void, void>>();
});

test("F2b a cell's controller edge is not a foreign export: no writable path leaves the capsule", () => {
  const leak = (): unknown =>
    // @ts-expect-error an edge is not a foreign value (ADR 0123)
    capsule({ label: "leak", exports: { ctl: draft.controller } });

  expect(typeof leak).toBe("function");
});

test("F3 a frozen foreign export is copied as is: the capsule does not change it", () => {
  const View = Object.freeze({ render: (): string => "view" });

  const lib = capsule({ label: "frozen", exports: { View } });

  expect(lib.View).toBe(View);
  expect(Object.keys(View)).toEqual(["render"]);
});

test("F4 a scope installs a capsule with a foreign export, and its units still work", async () => {
  const scope = createScope({ capsules: [talk] });
  await scope.ready;

  scope.controller(draft).set("hi");
  await scope.run(talk.clear);

  expect(scope.controller(draft).get()).toBe("");
  expect(scope.capsules[0]?.exports).toEqual(["draft", "clear", "Panel"]);

  await scope.close();
});
