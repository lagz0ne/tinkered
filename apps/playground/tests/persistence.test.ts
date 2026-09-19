import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { editFile, setTheme } from "@/actions.ts";
import { DEFAULT_FILES, ENTRY } from "@/lib/files.ts";
import { persistence } from "@/services.ts";
import { activeCell, dirtyCell, filesCell, type Saved, storage, themeCell } from "@/state.ts";
import { fakeStorage } from "./fixtures.ts";

const edited: Saved = {
  files: [
    { name: "main.tsx", content: 'import "./lib";' },
    { name: "lib.ts", content: "export const x = 1;" },
  ],
  active: "lib.ts",
  theme: "one-dark",
  dirty: true,
};

test("hydrates the cells from a saved session the user had edited", () => {
  const scope = createScope({ tags: [storage(fakeStorage(edited))] });
  expect(scope.resolve(persistence)).toEqual({ restored: true });
  expect(scope.resolve(filesCell)).toEqual(edited.files);
  expect(scope.resolve(activeCell)).toBe("lib.ts");
  expect(scope.resolve(themeCell)).toBe("one-dark");
  expect(scope.resolve(dirtyCell)).toBe(true);
});

test("an unedited saved session yields to the current starter and keeps only its theme", () => {
  const scope = createScope({ tags: [storage(fakeStorage({ ...edited, dirty: false }))] });
  expect(scope.resolve(persistence)).toEqual({ restored: false });
  expect(scope.resolve(filesCell)).toEqual([...DEFAULT_FILES]);
  expect(scope.resolve(activeCell)).toBe(ENTRY);
  expect(scope.resolve(themeCell)).toBe("one-dark");
  expect(scope.resolve(dirtyCell)).toBe(false);
});

test("mirrors every later change back to storage", () => {
  const store = fakeStorage();
  const scope = createScope({ tags: [storage(store)] });
  scope.resolve(persistence);
  expect(store.load()).toBeUndefined();
  scope.run(setTheme, { input: "github-dark" });
  expect(store.load()).toEqual({
    files: [...DEFAULT_FILES],
    active: ENTRY,
    theme: "github-dark",
    dirty: false,
  });
  scope.run(editFile, { input: { name: "main.tsx", content: "" } });
  expect(store.load()?.dirty).toBe(true);
});
