import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";

import { play } from "@/play";
import { addFile, back, closeFile, follow, forward, open, renameFile, track } from "@/play/ops";
import { library } from "@/play/sources";
import { files, nav, starter } from "@/play/state";

// Go to definition and history, at the seam: TypeScript's language service over the tabs and
// Core's and React's real sources. Ported from the playground's navigation tests; where the old
// hand-made resolver gave no link (a shadowing local, a declaration's own name), TypeScript's
// answer stands.

const start = async () => {
  const store = { getItem: () => null, setItem: () => undefined };
  const app = createScope({
    capsules: [play({ storage: store, debounce: 5, wasm: null, inbox: new EventTarget() })],
  });
  return app.ready;
};

const text = (name: string) => [...starter, ...library].find((s) => s.name === name)?.content ?? "";

/** The offset of the `nth` (from 0) `word` in `content`. */
const at = (content: string, word: string, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = content.indexOf(word, i + 1);
  return i;
};

const core = "@tinker/core/index.ts";

/** `createScope` has overloads: TypeScript names the one the call picks. */
const overloads = [...text(core).matchAll(/export function createScope/g)].map((m) => m.index + 16);

const isCreateScope = (to: unknown) => {
  const p = to as { file: string; offset: number };
  return p.file === core && overloads.includes(p.offset);
};

test("the library lists Core and React sources, read only beside the tabs", () => {
  const names = library.map((s) => s.name);
  expect(names).toContain("@tinker/core/main.ts");
  expect(names).toContain("@tinker/react/index.ts");
  expect(text(core)).toContain("export function createScope");
});

test("an imported name, and a use of it, lead to Core's own declaration", async () => {
  const scope = await start();
  const main = text("main.tsx");
  const via = (offset: number) => scope.run(follow, { input: { file: "main.tsx", offset } });

  expect(isCreateScope(await via(at(main, "createScope")))).toBe(true);
  expect(isCreateScope(await via(at(main, "createScope", 1)))).toBe(true);
  expect(isCreateScope(scope.controller(nav).get().place)).toBe(true);
});

test("a relative import leads across the project's own tabs", async () => {
  const scope = await start();
  const scene = text("Scene.tsx");
  const poke = { file: "draw.ts", offset: at(text("draw.ts"), "poke = operation") };

  expect(
    await scope.run(follow, { input: { file: "Scene.tsx", offset: at(scene, "poke") } }),
  ).toEqual(poke);
  expect(
    await scope.run(follow, { input: { file: "Scene.tsx", offset: at(scene, "poke", 1) } }),
  ).toEqual(poke);
});

test("an aliased import and a React re-export reach the original declaration", async () => {
  const scope = await start();
  const fixture = `import { createScope as makeScope } from "@tinker/core";
import { isError } from "@tinker/react";
export const go = () => makeScope();
export const ok = (v: unknown) => isError(v, "NoProvider");
`;
  scope.controller(files).set([{ name: "fixture.ts", content: fixture }]);
  const via = (offset: number) => scope.run(follow, { input: { file: "fixture.ts", offset } });
  const errors = "@tinker/react/errors.ts";

  expect(isCreateScope(await via(at(fixture, "makeScope", 1)))).toBe(true);
  expect(await via(at(fixture, "isError", 1))).toEqual({
    file: errors,
    offset: at(text(errors), "function isError") + 9,
  });
});

test("inside Core, an import leads to the module that declares it", async () => {
  const scope = await start();
  const errors = "@tinker/core/errors.ts";
  expect(
    await scope.run(follow, { input: { file: core, offset: at(text(core), "raise }") } }),
  ).toEqual({ file: errors, offset: at(text(errors), "function raise") + 9 });
});

test("a comment, a string or a browser global gives no jump, and the place stays", async () => {
  const scope = await start();
  const noise = `import { createScope } from "@tinker/core";
// createScope runs a scope.
export const title = "createScope";
export const go = () => console.log("ready");
`;
  scope.controller(files).set([{ name: "noise.ts", content: noise }]);

  const before = scope.controller(nav).get();
  for (const offset of [
    at(noise, "createScope", 1),
    at(noise, "createScope", 2),
    at(noise, "console"),
  ]) {
    expect(await scope.run(follow, { input: { file: "noise.ts", offset } })).toBeNull();
  }
  expect(scope.controller(nav).get()).toBe(before);
});

test("a local that shadows an import leads to the local", async () => {
  const scope = await start();
  const shadow = `import { createScope } from "@tinker/core";
export const viaParam = (createScope: () => object) => createScope();
`;
  scope.controller(files).set([{ name: "shadow.ts", content: shadow }]);
  expect(
    await scope.run(follow, { input: { file: "shadow.ts", offset: at(shadow, "createScope", 2) } }),
  ).toEqual({ file: "shadow.ts", offset: at(shadow, "createScope", 1) });
});

test("an edit reaches the next jump", async () => {
  const scope = await start();
  scope.controller(files).set([{ name: "a.ts", content: "export const x = 1;\nx;" }]);
  expect(await scope.run(follow, { input: { file: "a.ts", offset: 21 } })).toEqual({
    file: "a.ts",
    offset: 13,
  });

  scope.controller(files).set([{ name: "a.ts", content: "\n\nexport const x = 1;\nx;" }]);
  expect(await scope.run(follow, { input: { file: "a.ts", offset: 23 } })).toEqual({
    file: "a.ts",
    offset: 15,
  });
});

test("back and forward walk the history to the exact file and offset", async () => {
  const scope = await start();
  scope.run(track, { input: { file: "main.tsx", offset: 7 } });
  scope.run(open, { input: { file: "state.ts", offset: 30 } });
  scope.run(open, { input: { file: core, offset: 100 } });

  expect(scope.run(back)).toEqual({ file: "state.ts", offset: 30 });
  expect(scope.run(back)).toEqual({ file: "main.tsx", offset: 7 });
  expect(scope.run(back)).toBeNull();
  expect(scope.run(forward)).toEqual({ file: "state.ts", offset: 30 });

  scope.run(open, { input: { file: "engine.ts", offset: 0 } });
  expect(scope.run(forward)).toBeNull();
  expect(scope.controller(nav).get().back.at(-1)).toEqual({ file: "state.ts", offset: 30 });
});

test("a file that is neither a tab nor a library source is refused; a bad place fails at the door", async () => {
  const scope = await start();
  expect(scope.run(open, { input: { file: "nowhere.ts", offset: 0 } })).toBe(false);
  expect(() => scope.run(open, { rawInput: { file: "main.tsx", offset: -1 } })).toThrow();
});

test("tabs carry the history: add opens, close prunes, rename rewrites", async () => {
  const scope = await start();
  scope.run(open, { input: { file: "state.ts", offset: 5 } });
  expect(scope.run(addFile)).toBe("Untitled1.tsx");
  expect(scope.controller(nav).get().place).toEqual({ file: "Untitled1.tsx", offset: 0 });

  scope.run(renameFile, { input: { from: "state.ts", to: "cells.ts" } });
  expect(scope.controller(nav).get().back.at(-1)).toEqual({ file: "cells.ts", offset: 5 });

  scope.run(closeFile, { input: "cells.ts" });
  scope.run(closeFile, { input: "Untitled1.tsx" });
  const n = scope.controller(nav).get();
  expect(n.back.some((p) => p.file === "cells.ts")).toBe(false);
  expect(
    scope
      .controller(files)
      .get()
      .some((f) => f.name === n.place.file),
  ).toBe(true);
});
