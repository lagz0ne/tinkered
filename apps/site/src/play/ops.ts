import { operation } from "@tinker/core";
import { z } from "zod";

import { active, dirty, entry, files, renaming, starter, view } from "./state";

// Every visitor action is an operation: the input is parsed at the door, the cells it writes are
// its declared deps, and a test runs it just as the button does.

const name = z.string().min(1);

/** Typing in a tab: the file takes the new text, and the project is dirty. */
export const editFile = operation({
  label: "play.edit",
  input: z.object({ name, content: z.string() }),
  depends: { files: files.controller, dirty: dirty.controller },
  run: ({ files, dirty }, { input }) => {
    dirty.set(true);
    files.update((list) =>
      list.map((f) => (f.name === input.name ? { ...f, content: input.content } : f)),
    );
  },
});

/** A new empty tab, `UntitledN.tsx` with the first free N, on screen. Returns its name. */
export const addFile = operation({
  label: "play.add",
  depends: { files: files.controller, active: active.controller, dirty: dirty.controller },
  run: ({ files, active, dirty }) => {
    const taken = new Set(files.get().map((f) => f.name));
    let n = 1;
    while (taken.has(`Untitled${n}.tsx`)) n++;

    const added = `Untitled${n}.tsx`;
    dirty.set(true);
    files.update((list) => [...list, { name: added, content: "" }]);
    active.set(added);
    return added;
  },
});

/** Closes a tab; its neighbour takes the screen. The last tab stays. Returns whether it closed. */
export const closeFile = operation({
  label: "play.close",
  input: name,
  depends: { files: files.controller, active: active.controller, dirty: dirty.controller },
  run: ({ files, active, dirty }, { input }) => {
    const names = files.get().map((f) => f.name);
    const at = names.indexOf(input);
    if (at < 0 || names.length < 2) return false;

    const left = names.filter((n) => n !== input);
    dirty.set(true);
    files.update((list) => list.filter((f) => f.name !== input));
    if (active.get() === input) active.set(left[Math.min(at, left.length - 1)]!);
    return true;
  },
});

/** Renames a tab. A name already taken is refused: returns false. */
export const renameFile = operation({
  label: "play.rename",
  input: z.object({ from: name, to: name }),
  depends: { files: files.controller, active: active.controller, dirty: dirty.controller },
  run: ({ files, active, dirty }, { input: { from, to } }) => {
    if (files.get().some((f) => f.name === to)) return false;

    dirty.set(true);
    files.update((list) => list.map((f) => (f.name === from ? { ...f, name: to } : f)));
    if (active.get() === from) active.set(to);
    return true;
  },
});

export const selectFile = operation({
  label: "play.select",
  input: name,
  depends: { active: active.controller },
  run: ({ active }, { input }) => active.set(input),
});

export const setView = operation({
  label: "play.view.set",
  input: z.enum(["play", "code"]),
  depends: { view: view.controller },
  run: ({ view }, { input }) => view.set(input),
});

/** Back to the starter project. The session is clean again, so a newer starter replaces it. */
export const reset = operation({
  label: "play.reset",
  depends: { files: files.controller, active: active.controller, dirty: dirty.controller },
  run: ({ files, active, dirty }) => {
    dirty.set(false);
    files.set([...starter]);
    active.set(entry);
  },
});

/** Opens the rename box on a tab, or closes it with null. */
export const setRenaming = operation({
  label: "play.renaming.set",
  input: name.nullable(),
  depends: { renaming: renaming.controller },
  run: ({ renaming }, { input }) => renaming.set(input),
});
