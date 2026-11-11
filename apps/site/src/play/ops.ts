import { operation } from "@tinker/core";
import { z } from "zod";

import { definition } from "./language";
import { library } from "./sources";
import { dirty, entry, files, nav, renaming, starter, theme, view } from "./state";
import type { Place } from "./state";

// Every visitor action is an operation: the input is parsed at the door, the cells it writes are
// its declared deps, and a test runs it just as the button or the key does.

const name = z.string().min(1);
const place = z.object({ file: name, offset: z.number().int().min(0) });

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

/**
 * Opens a place, a tab or a library source, and keeps where the editor came from; the forward
 * history goes. A file that is neither is refused: returns false.
 */
export const open = operation({
  label: "play.open",
  input: place,
  depends: { nav: nav.controller, files: files.controller },
  run: ({ nav, files }, { input }) => {
    const names = [...files.get(), ...library].map((s) => s.name);
    if (!names.includes(input.file)) return false;

    const was = nav.get();
    nav.set({ place: input, back: [...was.back, was.place], forward: [] });
    return true;
  },
});

/** Keeps where the cursor is, so a step back returns to this spot. No history moves. */
export const track = operation({
  label: "play.track",
  input: place,
  depends: { nav: nav.controller },
  run: ({ nav }, { input }) => nav.update((n) => ({ ...n, place: input })),
});

/** Jumps to where the name at a place is declared. Returns the place, or null for no jump. */
export const follow = operation({
  label: "play.follow",
  input: place,
  depends: { definition: definition.controller, open: open.controller },
  run: async ({ definition, open }, { input }) => {
    const to = await definition.run({ input });
    if (to) open.run({ input: to });
    return to;
  },
});

/** One step back, to the exact file and offset. Returns where it went, or null at the start. */
export const back = operation({
  label: "play.back",
  depends: { nav: nav.controller },
  run: ({ nav }): Place | null => {
    const n = nav.get();
    const to = n.back.at(-1);
    if (!to) return null;

    nav.set({ place: to, back: n.back.slice(0, -1), forward: [...n.forward, n.place] });
    return to;
  },
});

/** One step forward, undoing a step back. Returns where it went, or null with nothing to redo. */
export const forward = operation({
  label: "play.forward",
  depends: { nav: nav.controller },
  run: ({ nav }): Place | null => {
    const n = nav.get();
    const to = n.forward.at(-1);
    if (!to) return null;

    nav.set({ place: to, back: [...n.back, n.place], forward: n.forward.slice(0, -1) });
    return to;
  },
});

/** A new empty tab, `UntitledN.tsx` with the first free N, opened. Returns its name. */
export const addFile = operation({
  label: "play.add",
  depends: { files: files.controller, dirty: dirty.controller, open: open.controller },
  run: ({ files, dirty, open }) => {
    const taken = new Set(files.get().map((f) => f.name));
    let n = 1;
    while (taken.has(`Untitled${n}.tsx`)) n++;

    const added = `Untitled${n}.tsx`;
    dirty.set(true);
    files.update((list) => [...list, { name: added, content: "" }]);
    open.run({ input: { file: added, offset: 0 } });
    return added;
  },
});

/**
 * Closes a tab. The last tab stays: returns false. A closed file leaves the history too, and if
 * it was on screen, its neighbour takes the screen.
 */
export const closeFile = operation({
  label: "play.close",
  input: name,
  depends: { files: files.controller, dirty: dirty.controller, nav: nav.controller },
  run: ({ files, dirty, nav }, { input }) => {
    const names = files.get().map((f) => f.name);
    const at = names.indexOf(input);
    if (at < 0 || names.length < 2) return false;

    const left = names.filter((n) => n !== input);
    dirty.set(true);
    files.update((list) => list.filter((f) => f.name !== input));

    const n = nav.get();
    const shown = n.place.file === input;
    nav.set({
      place: shown ? { file: left[Math.min(at, left.length - 1)]!, offset: 0 } : n.place,
      back: n.back.filter((p) => p.file !== input),
      forward: n.forward.filter((p) => p.file !== input),
    });
    return true;
  },
});

/** Renames a tab; its history follows it. A name already taken is refused: returns false. */
export const renameFile = operation({
  label: "play.rename",
  input: z.object({ from: name, to: name }),
  depends: { files: files.controller, dirty: dirty.controller, nav: nav.controller },
  run: ({ files, dirty, nav }, { input: { from, to } }) => {
    if ([...files.get(), ...library].some((f) => f.name === to)) return false;

    dirty.set(true);
    files.update((list) => list.map((f) => (f.name === from ? { ...f, name: to } : f)));
    nav.update((n) => ({
      place: n.place.file === from ? { ...n.place, file: to } : n.place,
      back: n.back.map((p) => (p.file === from ? { ...p, file: to } : p)),
      forward: n.forward.map((p) => (p.file === from ? { ...p, file: to } : p)),
    }));
    return true;
  },
});

export const setView = operation({
  label: "play.view.set",
  input: z.enum(["play", "code"]),
  depends: { view: view.controller },
  run: ({ view }, { input }) => view.set(input),
});

export const setTheme = operation({
  label: "play.theme.set",
  input: z.enum(["github-light", "github-dark", "one-dark"]),
  depends: { theme: theme.controller },
  run: ({ theme }, { input }) => theme.set(input),
});

/** Opens the rename box on a tab, or closes it with null. */
export const setRenaming = operation({
  label: "play.renaming.set",
  input: name.nullable(),
  depends: { renaming: renaming.controller },
  run: ({ renaming }, { input }) => renaming.set(input),
});

/** Back to the starter project, at its entry, with no history. The session is clean again. */
export const reset = operation({
  label: "play.reset",
  depends: { files: files.controller, dirty: dirty.controller, nav: nav.controller },
  run: ({ files, dirty, nav }) => {
    dirty.set(false);
    files.set([...starter]);
    nav.set({ place: { file: entry, offset: 0 }, back: [], forward: [] });
  },
});
