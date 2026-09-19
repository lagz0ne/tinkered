import { operation } from "@tinker/core";
import { raise } from "@/errors.ts";
import { DEFAULT_FILES, ENTRY } from "@/lib/files.ts";
import { THEMES, type ThemeId } from "@/lib/themes.ts";
import { activeCell, dirtyCell, filesCell, themeCell, type View, viewCell } from "@/state.ts";

/** Every user action is an operation: typed input admitted at the door, the cells it touches
 * declared as controller deps, and no React in sight — `scope.run(addFile)` in a test does exactly
 * what the button does. `string(op)` is the door for the single-string ones. */
const string = (operation: string) => (raw: unknown) =>
  typeof raw === "string" ? raw : raise("InvalidInput", { operation, reason: "expected a string" });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const untitled = (names: readonly string[]): string => {
  let n = 1;
  while (names.includes(`Untitled${n}.tsx`)) n++;
  return `Untitled${n}.tsx`;
};

/** Replace one file's content. */
export const editFile = operation({
  label: "editFile",
  input: (raw) => {
    if (isRecord(raw) && typeof raw.name === "string" && typeof raw.content === "string")
      return { name: raw.name, content: raw.content };
    raise("InvalidInput", { operation: "editFile", reason: "expected { name, content }" });
  },
  depends: { files: filesCell.controller, dirty: dirtyCell.controller },
  run: ({ files, dirty }, { input }) => {
    dirty.set(true);
    files.update((prev) =>
      prev.map((f) => (f.name === input.name ? { ...f, content: input.content } : f)),
    );
  },
});

/** Add an empty `UntitledN.tsx` and make it active. Returns its name. */
export const addFile = operation({
  label: "addFile",
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    dirty: dirtyCell.controller,
  },
  run: ({ files, active, dirty }) => {
    const name = untitled(files.get().map((f) => f.name));
    dirty.set(true);
    files.update((prev) => [...prev, { name, content: "" }]);
    active.set(name);
    return name;
  },
});

/** Close a tab; if it was active, the neighbour takes over. The last tab cannot be closed. */
export const closeFile = operation({
  label: "closeFile",
  input: string("closeFile"),
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    dirty: dirtyCell.controller,
  },
  run: ({ files, active, dirty }, { input: name }) => {
    const names = files.get().map((f) => f.name);
    const idx = names.indexOf(name);
    if (idx < 0 || names.length < 2) return false;
    const next = names.filter((n) => n !== name);
    dirty.set(true);
    files.update((prev) => prev.filter((f) => f.name !== name));
    const [first] = next;
    if (active.get() === name) active.set(next[idx] ?? next[idx - 1] ?? first);
    return true;
  },
});

/** Rename a tab. Refused (returns false) when the target name is taken. */
export const renameFile = operation({
  label: "renameFile",
  input: (raw) => {
    if (isRecord(raw) && typeof raw.from === "string" && typeof raw.to === "string")
      return { from: raw.from, to: raw.to };
    raise("InvalidInput", { operation: "renameFile", reason: "expected { from, to }" });
  },
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    dirty: dirtyCell.controller,
  },
  run: ({ files, active, dirty }, { input: { from, to } }) => {
    if (files.get().some((f) => f.name === to)) return false;
    dirty.set(true);
    files.update((prev) => prev.map((f) => (f.name === from ? { ...f, name: to } : f)));
    if (active.get() === from) active.set(to);
    return true;
  },
});

export const selectFile = operation({
  label: "selectFile",
  input: string("selectFile"),
  depends: { active: activeCell.controller },
  run: ({ active }, { input }) => active.set(input),
});

export const setTheme = operation({
  label: "setTheme",
  input: (raw): ThemeId => {
    const found = THEMES.find((t) => t.id === raw);
    return found
      ? found.id
      : raise("InvalidInput", { operation: "setTheme", reason: "unknown theme" });
  },
  depends: { theme: themeCell.controller },
  run: ({ theme }, { input }) => theme.set(input),
});

export const setView = operation({
  label: "setView",
  input: (raw): View =>
    raw === "editor" || raw === "bench"
      ? raw
      : raise("InvalidInput", { operation: "setView", reason: "unknown view" }),
  depends: { view: viewCell.controller },
  run: ({ view }, { input }) => view.set(input),
});

/** Back to the starter project; the session is no longer dirty, so a future default replaces it. */
export const reset = operation({
  label: "reset",
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    dirty: dirtyCell.controller,
  },
  run: ({ files, active, dirty }) => {
    dirty.set(false);
    files.set([...DEFAULT_FILES]);
    active.set(ENTRY);
  },
});
