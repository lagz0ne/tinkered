import { expect, test } from "vite-plus/test";
import { createScope, isError } from "@tinker/core";
import {
  addFile,
  closeFile,
  editFile,
  renameFile,
  reset,
  selectFile,
  setTheme,
} from "@/actions.ts";
import { isError as isPlaygroundError } from "@/errors.ts";
import { DEFAULT_FILES, ENTRY } from "@/lib/files.ts";
import { activeCell, dirtyCell, filesCell, themeCell } from "@/state.ts";

const names = (files: readonly { name: string }[]) => files.map((f) => f.name);

test("addFile opens an empty Untitled1.tsx tab and makes it active", () => {
  const scope = createScope();
  const name = scope.run(addFile);
  expect(name).toBe("Untitled1.tsx");
  expect(scope.resolve(filesCell).at(-1)).toEqual({ name: "Untitled1.tsx", content: "" });
  expect(scope.resolve(activeCell)).toBe("Untitled1.tsx");
  expect(scope.resolve(dirtyCell)).toBe(true);
});

test("closeFile refuses the last open tab", () => {
  const scope = createScope();
  scope.controller(filesCell).set([{ name: "only.tsx", content: "" }]);
  expect(scope.run(closeFile, { input: "only.tsx" })).toBe(false);
  expect(names(scope.resolve(filesCell))).toEqual(["only.tsx"]);
  expect(scope.resolve(dirtyCell)).toBe(false);
});

test("closing the active tab hands the editor to its neighbour", () => {
  const scope = createScope();
  scope.run(selectFile, { input: "state.ts" });
  expect(scope.run(closeFile, { input: "state.ts" })).toBe(true);
  expect(names(scope.resolve(filesCell))).toEqual(["main.tsx", "engine.ts", "Tile.tsx", "App.tsx"]);
  expect(scope.resolve(activeCell)).toBe("engine.ts");
});

test("renameFile refuses a name another tab already has", () => {
  const scope = createScope();
  expect(scope.run(renameFile, { input: { from: "main.tsx", to: "App.tsx" } })).toBe(false);
  expect(names(scope.resolve(filesCell))).toEqual(names(DEFAULT_FILES));
  expect(scope.resolve(dirtyCell)).toBe(false);
});

test("editFile replaces one file's content and marks the session dirty", () => {
  const scope = createScope();
  scope.run(editFile, { input: { name: "state.ts", content: "export const x = 1;" } });
  const files = scope.resolve(filesCell);
  expect(files.find((f) => f.name === "state.ts")?.content).toBe("export const x = 1;");
  const [starter] = DEFAULT_FILES;
  expect(files.find((f) => f.name === "main.tsx")).toBe(starter);
  expect(scope.resolve(dirtyCell)).toBe(true);
});

test("reset restores the starter project and clears dirty", () => {
  const scope = createScope();
  scope.run(editFile, { input: { name: "main.tsx", content: "" } });
  scope.run(addFile);
  scope.run(reset);
  expect(scope.resolve(filesCell)).toEqual([...DEFAULT_FILES]);
  expect(scope.resolve(activeCell)).toBe(ENTRY);
  expect(scope.resolve(dirtyCell)).toBe(false);
});

test("setTheme rejects an unknown theme at the door", () => {
  const scope = createScope();
  try {
    scope.run(setTheme, { rawInput: "neon" });
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "DataValidationFailed")) throw error;
    expect(error.payload.label).toBe("setTheme");
    const { cause } = error.payload;
    if (!isPlaygroundError(cause, "InvalidInput")) throw cause;
    expect(cause.payload).toEqual({ operation: "setTheme", reason: "unknown theme" });
  }
  expect(scope.resolve(themeCell)).toBe("github-light");
});
