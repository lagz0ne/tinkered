import { operation } from "@tinker/core";
import { navigationCell } from "@/navigation.ts";
import { raise } from "@/errors.ts";
import { DEFAULT_FILES, ENTRY } from "@/lib/files.ts";
import { THEMES, type ThemeId } from "@/lib/themes.ts";
import {
  activeCell,
  dirtyCell,
  filesCell,
  pickerOpenCell,
  searchCell,
  themeCell,
  type View,
  viewCell,
} from "@/state.ts";

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

/** Add an empty `UntitledN.tsx` and make it active. Returns its name. The navigation place opens
 * the new file, so the editor shows what was just created and Back returns to the previous spot. */
export const addFile = operation({
  label: "addFile",
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    dirty: dirtyCell.controller,
    nav: navigationCell.controller,
  },
  run: ({ files, active, dirty, nav }) => {
    const name = untitled(files.get().map((f) => f.name));
    dirty.set(true);
    files.update((prev) => [...prev, { name, content: "" }]);
    active.set(name);
    const prev = nav.get();
    nav.set({
      place: { file: name, offset: 0 },
      back: prev.place ? [...prev.back, prev.place] : prev.back,
      forward: [],
    });
    return name;
  },
});

/** Close a tab; if it was active, the neighbour takes over. The last tab cannot be closed. The
 * navigation place follows: a closed file cannot stay on screen (its edits would throw). */
export const closeFile = operation({
  label: "closeFile",
  input: string("closeFile"),
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    dirty: dirtyCell.controller,
    nav: navigationCell.controller,
  },
  run: ({ files, active, dirty, nav }, { input: name }) => {
    const names = files.get().map((f) => f.name);
    const idx = names.indexOf(name);
    if (idx < 0 || names.length < 2) return false;
    const next = names.filter((n) => n !== name);
    dirty.set(true);
    files.update((prev) => prev.filter((f) => f.name !== name));
    const [first] = next;
    if (active.get() === name) active.set(next[idx] ?? next[idx - 1] ?? first);
    if (nav.get().place?.file === name)
      nav.update((n) => ({ ...n, place: { file: active.get(), offset: 0 } }));
    return true;
  },
});

/** Rename a tab. Refused (returns false) when the target name is taken. A renamed file that is on
 * screen keeps its place under the new name, so the editor never shows a ghost. */
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
    nav: navigationCell.controller,
  },
  run: ({ files, active, dirty, nav }, { input: { from, to } }) => {
    if (files.get().some((f) => f.name === to)) return false;
    dirty.set(true);
    files.update((prev) => prev.map((f) => (f.name === from ? { ...f, name: to } : f)));
    if (active.get() === from) active.set(to);
    if (nav.get().place?.file === from)
      nav.update((n) => ({ ...n, place: { file: to, offset: n.place?.offset ?? 0 } }));
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
    raw === "play" || raw === "editor" || raw === "bench"
      ? raw
      : raise("InvalidInput", { operation: "setView", reason: "unknown view" }),
  depends: { view: viewCell.controller },
  run: ({ view }, { input }) => view.set(input),
});

/** Set the Code view's file-search text. */
export const setSearch = operation({
  label: "setSearch",
  input: string("setSearch"),
  depends: { search: searchCell.controller },
  run: ({ search }, { input }) => search.set(input),
});

/** Show or hide the Code view's file-picker list. */
export const setPickerOpen = operation({
  label: "setPickerOpen",
  input: (raw): boolean =>
    typeof raw === "boolean"
      ? raw
      : raise("InvalidInput", { operation: "setPickerOpen", reason: "open or closed" }),
  depends: { picker: pickerOpenCell.controller },
  run: ({ picker }, { input }) => picker.set(input),
});

/** Back to the starter project; the session is no longer dirty, so a future default replaces it.
 * Navigation restarts at the entry file: the restored project is where a fresh session opens. */
export const reset = operation({
  label: "reset",
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    dirty: dirtyCell.controller,
    nav: navigationCell.controller,
  },
  run: ({ files, active, dirty, nav }) => {
    dirty.set(false);
    files.set([...DEFAULT_FILES]);
    active.set(ENTRY);
    nav.set({ place: { file: ENTRY, offset: 0 }, back: [], forward: [] });
  },
});
