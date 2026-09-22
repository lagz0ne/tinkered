import { data, operation } from "@tinker/core";
import { raise } from "@/errors.ts";
import { resolveDefinition, type Place } from "@/lib/definitions.ts";
import { sourceFiles, type Source } from "@/lib/sources.ts";
import { filesCell } from "@/state.ts";

/** Where navigation stands: `place` is the spot shown now (absent until the first open), `back`
 * holds where it came from, newest last; `forward` holds what a back-jump would undo, newest last.
 * A new jump appends to `back` and clears `forward`; `trackCursor` moves `place` alone. */
export type Navigation = { place?: Place; back: readonly Place[]; forward: readonly Place[] };

/** The navigation state: current place plus the two history stacks. */
export const navigationCell = data<Navigation>({
  label: "navigation",
  initial: { back: [], forward: [] },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const placeInput =
  (operation: string) =>
  (raw: unknown): Place => {
    if (
      isRecord(raw) &&
      typeof raw.file === "string" &&
      typeof raw.offset === "number" &&
      Number.isInteger(raw.offset) &&
      raw.offset >= 0
    )
      return { file: raw.file, offset: raw.offset };
    raise("InvalidInput", { operation, reason: "expected { file, offset }" });
  };

function sourceOf(sources: readonly Source[], place: Place, operation: string): Source {
  const found = sources.find((source) => source.name === place.file);
  return found ?? raise("InvalidInput", { operation, reason: "unknown file" });
}

function landed(current: Navigation, place: Place): Navigation {
  return {
    place,
    back: current.place ? [...current.back, current.place] : current.back,
    forward: [],
  };
}

/** Open `input`, record where navigation came from, and clear the forward history. */
export const openSource = operation({
  label: "openSource",
  input: placeInput("openSource"),
  depends: { nav: navigationCell.controller, files: filesCell.controller },
  run: ({ nav, files }, { input }) => {
    sourceOf(sourceFiles(files.get()), input, "openSource");
    nav.set(landed(nav.get(), input));
  },
});

/** Jump to the declaration `input` points at and record where it came from; `undefined` means
 * nothing to follow, and then the state stays put. */
export const followDefinition = operation({
  label: "followDefinition",
  input: placeInput("followDefinition"),
  depends: { nav: navigationCell.controller, files: filesCell.controller },
  run: ({ nav, files }, { input }) => {
    const sources = sourceFiles(files.get());
    const from = sourceOf(sources, input, "followDefinition");
    const target = resolveDefinition(sources, from, input.offset);
    if (!target) return undefined;
    nav.set(landed(nav.get(), target));
    return target;
  },
});

/** Step back to the most recent place — file and exact offset — or `undefined` with no history. */
export const goBack = operation({
  label: "goBack",
  depends: { nav: navigationCell.controller },
  run: ({ nav }) => {
    const current = nav.get();
    const target = current.back.at(-1);
    if (!target) return undefined;
    nav.set({
      place: target,
      back: current.back.slice(0, -1),
      forward: current.place ? [...current.forward, current.place] : current.forward,
    });
    return target;
  },
});

/** Step forward to the most recent place a back-jump undid, or `undefined` with nothing to redo. */
export const goForward = operation({
  label: "goForward",
  depends: { nav: navigationCell.controller },
  run: ({ nav }) => {
    const current = nav.get();
    const target = current.forward.at(-1);
    if (!target) return undefined;
    nav.set({
      place: target,
      back: current.place ? [...current.back, current.place] : current.back,
      forward: current.forward.slice(0, -1),
    });
    return target;
  },
});

/** Remember exactly where the cursor sits so a later back-jump returns to this spot. */
export const trackCursor = operation({
  label: "trackCursor",
  input: placeInput("trackCursor"),
  depends: { nav: navigationCell.controller, files: filesCell.controller },
  run: ({ nav, files }, { input }) => {
    sourceOf(sourceFiles(files.get()), input, "trackCursor");
    nav.set({ ...nav.get(), place: input });
  },
});
