import { expect, test } from "vite-plus/test";
import { createScope, isError } from "@tinker/core";
import {
  followDefinition,
  goBack,
  goForward,
  navigationCell,
  openSource,
  PACKAGE_SOURCES,
  sourceFiles,
  trackCursor,
} from "../src/index.ts";
import { isError as isPlaygroundError, raise } from "@/errors.ts";
import { DEFAULT_FILES } from "@/lib/files.ts";
import { filesCell } from "@/state.ts";

/** Text of a starter file or bundled package source, so a test can pick an exact offset. */
const contentOf = (name: string): string => {
  const found =
    DEFAULT_FILES.find((f) => f.name === name) ?? PACKAGE_SOURCES.find((s) => s.name === name);
  return found
    ? found.content
    : raise("InvalidInput", { operation: "contentOf", reason: "unknown source" });
};

/** An offset just inside the `which`-th occurrence of `needle` (the first when `which` is 0). */
const at = (content: string, needle: string, which = 0): number => {
  let index = -1;
  for (let i = 0; i <= which; i++) index = content.indexOf(needle, index + 1);
  return index + 1;
};

/** Run an operation expected to fail and hand back the registry error it raised. */
const raised = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return isError(error, "DataValidationFailed") ? error.payload.cause : error;
  }
  return undefined;
};

const coreCreateScope = {
  file: "@tinker/core/index.ts",
  offset: contentOf("@tinker/core/index.ts").indexOf("function createScope") + 9,
};

test("sourceFiles lists the session files with the read-only package sources", () => {
  const scope = createScope();
  const sources = sourceFiles(scope.resolve(filesCell));
  expect(sources.map((s) => s.name)).toEqual([
    ...DEFAULT_FILES.map((f) => f.name),
    "@tinker/core/index.ts",
    "@tinker/core/errors.ts",
    "@tinker/react/index.ts",
    "@tinker/react/errors.ts",
  ]);
  expect(sources.filter((s) => !s.editable).map((s) => s.name)).toEqual([
    "@tinker/core/index.ts",
    "@tinker/core/errors.ts",
    "@tinker/react/index.ts",
    "@tinker/react/errors.ts",
  ]);
});

test("opening a package source leaves the editable session untouched", () => {
  const scope = createScope();
  scope.run(openSource, { input: { file: "@tinker/core/index.ts", offset: 41 } });
  expect(scope.resolve(filesCell)).toEqual([...DEFAULT_FILES]);
  expect(scope.resolve(navigationCell).place).toEqual({
    file: "@tinker/core/index.ts",
    offset: 41,
  });
});

test("following an imported name lands on the library's declaration", () => {
  const scope = createScope();
  const main = contentOf("main.tsx");
  expect(
    scope.run(followDefinition, { input: { file: "main.tsx", offset: at(main, "createScope") } }),
  ).toEqual(coreCreateScope);
});

test("following a use of an imported name lands on the library's declaration", () => {
  const scope = createScope();
  const main = contentOf("main.tsx");
  expect(
    scope.run(followDefinition, {
      input: { file: "main.tsx", offset: at(main, "createScope", 1) },
    }),
  ).toEqual(coreCreateScope);
});

test("following a module path opens that source at its start", () => {
  const scope = createScope();
  const main = contentOf("main.tsx");
  expect(
    scope.run(followDefinition, {
      input: { file: "main.tsx", offset: at(main, '"@tinker/core"') + 1 },
    }),
  ).toEqual({ file: "@tinker/core/index.ts", offset: 0 });
});

test("a relative import links across the session's own files", () => {
  const scope = createScope();
  const tile = contentOf("Tile.tsx");
  const idle = { file: "state.ts", offset: contentOf("state.ts").indexOf("IDLE") };
  expect(
    scope.run(followDefinition, { input: { file: "Tile.tsx", offset: at(tile, "IDLE") } }),
  ).toEqual(idle);
  expect(
    scope.run(followDefinition, { input: { file: "Tile.tsx", offset: at(tile, "IDLE", 1) } }),
  ).toEqual(idle);
});

test("an aliased import links every way to the original declaration", () => {
  const scope = createScope();
  const aliased = `import { createScope as makeScope } from "@tinker/core";
export const start = () => makeScope();
`;
  scope.controller(filesCell).set([{ name: "aliased.ts", content: aliased }]);
  expect(
    scope.run(followDefinition, {
      input: { file: "aliased.ts", offset: at(aliased, "createScope") },
    }),
  ).toEqual(coreCreateScope);
  expect(
    scope.run(followDefinition, {
      input: { file: "aliased.ts", offset: at(aliased, "makeScope") },
    }),
  ).toEqual(coreCreateScope);
  expect(
    scope.run(followDefinition, {
      input: { file: "aliased.ts", offset: at(aliased, "makeScope", 1) },
    }),
  ).toEqual(coreCreateScope);
});

test("a package's own import links to its errors module", () => {
  const scope = createScope();
  const core = contentOf("@tinker/core/index.ts");
  expect(
    scope.run(followDefinition, {
      input: { file: "@tinker/core/index.ts", offset: at(core, "raise } from") },
    }),
  ).toEqual({
    file: "@tinker/core/errors.ts",
    offset: contentOf("@tinker/core/errors.ts").indexOf("function raise") + 9,
  });
});

test("a package reexport links to the module that declares it", () => {
  const scope = createScope();
  const fixture = `import { isError } from "@tinker/react";
export const ok = (value: unknown) => isError(value, "NoProvider");
`;
  scope.controller(filesCell).set([{ name: "reexport.ts", content: fixture }]);
  const errors = {
    file: "@tinker/react/errors.ts",
    offset: contentOf("@tinker/react/errors.ts").indexOf("function isError") + 9,
  };
  expect(
    scope.run(followDefinition, { input: { file: "reexport.ts", offset: at(fixture, "isError") } }),
  ).toEqual(errors);
  expect(
    scope.run(followDefinition, {
      input: { file: "reexport.ts", offset: at(fixture, "isError", 1) },
    }),
  ).toEqual(errors);
});

test("a use of a top-level local declaration links to its definition", () => {
  const scope = createScope();
  const main = contentOf("main.tsx");
  expect(
    scope.run(followDefinition, { input: { file: "main.tsx", offset: at(main, "Engine", 1) } }),
  ).toEqual({ file: "main.tsx", offset: main.indexOf("function Engine") + 9 });
});

test("positions that are not a reference to a declared name give no link", () => {
  const scope = createScope();
  const noise = `import { createScope } from "@tinker/core";
// createScope runs a scope.
export const title = "createScope";
export const table = { createScope: 1 };
export const held = table.createScope;
export const go = () => console.log("ready");
`;
  scope.controller(filesCell).set([{ name: "noise.ts", content: noise }]);
  const positions = [
    at(noise, "title"),
    at(noise, "createScope", 1),
    at(noise, "createScope", 2),
    at(noise, "createScope", 3),
    at(noise, "createScope", 4),
    at(noise, "console"),
  ];
  for (const offset of positions) {
    expect(scope.run(followDefinition, { input: { file: "noise.ts", offset } })).toBeUndefined();
  }
});

test("a local that shadows an import gives no link", () => {
  const scope = createScope();
  const shadow = `import { createScope } from "@tinker/core";
export const viaParam = (createScope: () => object) => createScope();
export function viaLocal() {
  const createScope = () => ({});
  return createScope();
}
`;
  scope.controller(filesCell).set([{ name: "shadow.ts", content: shadow }]);
  expect(
    scope.run(followDefinition, {
      input: { file: "shadow.ts", offset: at(shadow, "createScope", 2) },
    }),
  ).toBeUndefined();
  expect(
    scope.run(followDefinition, {
      input: { file: "shadow.ts", offset: at(shadow, "createScope", 4) },
    }),
  ).toBeUndefined();
});

test("a destructured parameter or loop local shadows the import", () => {
  const scope = createScope();
  const fixture = `import { createScope } from "@tinker/core";
export const viaDestructured = ({ createScope }: { createScope: number }) => createScope + 1;
export const viaLoop = () => {
  for (const createScope of [1]) return createScope;
};
`;
  scope.controller(filesCell).set([{ name: "shadowed.ts", content: fixture }]);
  expect(
    scope.run(followDefinition, {
      input: { file: "shadowed.ts", offset: at(fixture, "createScope", 3) },
    }),
  ).toBeUndefined();
  expect(
    scope.run(followDefinition, {
      input: { file: "shadowed.ts", offset: at(fixture, "createScope", 5) },
    }),
  ).toBeUndefined();
});

test("back and forward walk history and restore the exact file and offset", () => {
  const scope = createScope();
  const main = contentOf("main.tsx");
  scope.run(openSource, { input: { file: "main.tsx", offset: 10 } });
  scope.run(trackCursor, { input: { file: "main.tsx", offset: 55 } });
  scope.run(followDefinition, {
    input: { file: "main.tsx", offset: at(main, "createScope", 1) },
  });
  expect(scope.resolve(navigationCell)).toEqual({
    place: coreCreateScope,
    back: [{ file: "main.tsx", offset: 55 }],
    forward: [],
  });
  expect(scope.run(goBack)).toEqual({ file: "main.tsx", offset: 55 });
  expect(scope.resolve(navigationCell).forward).toEqual([coreCreateScope]);
  expect(scope.run(goForward)).toEqual(coreCreateScope);
  expect(scope.run(goBack)).toEqual({ file: "main.tsx", offset: 55 });
  expect(scope.run(goBack)).toBeUndefined();
  expect(scope.resolve(navigationCell).place).toEqual({ file: "main.tsx", offset: 55 });
});

test("history walks the most recent place, and a new jump clears the forward stack", () => {
  const scope = createScope();
  scope.run(openSource, { input: { file: "main.tsx", offset: 10 } });
  scope.run(openSource, { input: { file: "state.ts", offset: 20 } });
  scope.run(openSource, { input: { file: "Tile.tsx", offset: 30 } });
  expect(scope.resolve(navigationCell)).toEqual({
    place: { file: "Tile.tsx", offset: 30 },
    back: [
      { file: "main.tsx", offset: 10 },
      { file: "state.ts", offset: 20 },
    ],
    forward: [],
  });
  expect(scope.run(goBack)).toEqual({ file: "state.ts", offset: 20 });
  expect(scope.run(goBack)).toEqual({ file: "main.tsx", offset: 10 });
  expect(scope.run(goBack)).toBeUndefined();
  expect(scope.run(goForward)).toEqual({ file: "state.ts", offset: 20 });
  expect(scope.run(goForward)).toEqual({ file: "Tile.tsx", offset: 30 });
  expect(scope.run(goForward)).toBeUndefined();
  expect(scope.run(goBack)).toEqual({ file: "state.ts", offset: 20 });
  scope.run(openSource, { input: { file: "engine.ts", offset: 40 } });
  expect(scope.resolve(navigationCell)).toEqual({
    place: { file: "engine.ts", offset: 40 },
    back: [
      { file: "main.tsx", offset: 10 },
      { file: "state.ts", offset: 20 },
    ],
    forward: [],
  });
  expect(scope.run(goBack)).toEqual({ file: "state.ts", offset: 20 });
});

test("a navigation input that is not { file, offset } is refused", () => {
  const scope = createScope();
  const error = raised(() => scope.run(followDefinition, { rawInput: { file: 3, offset: 0 } }));
  if (!isPlaygroundError(error, "InvalidInput")) throw error;
  expect(error.payload).toEqual({
    operation: "followDefinition",
    reason: "expected { file, offset }",
  });
});

test("navigating to a file the sources do not have is refused", () => {
  const scope = createScope();
  const error = raised(() =>
    scope.run(followDefinition, { rawInput: { file: "ghost.ts", offset: 0 } }),
  );
  if (!isPlaygroundError(error, "InvalidInput")) throw error;
  expect(error.payload).toEqual({ operation: "followDefinition", reason: "unknown file" });
});
