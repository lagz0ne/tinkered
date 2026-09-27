import { resource } from "@tinker/core";
import { issueList, type Issues } from "../shared/issues.ts";
import { markOf, sameMark, selectedId, type RowMark } from "./state.ts";
import { checkCapability, loadDetail } from "./actions.ts";

/** Check the draft helper once at boot: the capability cell answers on, off, or failed.
 * The view reruns `checkCapability` by hand on Retry. The run is left to the scope, not
 * settled: `checkCapability` rejects only on a panic, and a dropped panic fails the layer,
 * where a `settle` here would recover it (ADR 0067). */
export const capability = resource({
  label: "capability",
  depends: { check: checkCapability },
  factory: ({ check }) => {
    void check.run();
    return { checking: true };
  },
});

/** Reload the detail when the selection moves or the selected row changes on the wire: a
 * change to its `revision`/`updatedAt` in the list reruns the load, even when the shown
 * detail already names the issue (a comment bumps `updatedAt` without touching the draft).
 * The load is the race loser by design: it writes nothing once the selection moved on or a
 * newer snapshot landed first. `loadDetail` shows its own failures, so the run is left to the
 * scope: only a panic rejects it, and that fails the layer (ADR 0067). */
export const detailRefresh = resource({
  label: "detailRefresh",
  depends: {
    selected: selectedId.controller,
    list: issueList.controller,
    load: loadDetail,
  },
  factory: ({ selected, list, load }, { defer }) => {
    let seen: { readonly id: string; readonly mark: RowMark } | null = null;
    const refresh = (saved: readonly Issues.Issue[]): void => {
      const id = selected.get();
      if (id === null) {
        seen = null;
        return;
      }
      const mark = markOf(saved, id);
      if (mark === null) return;
      if (seen !== null && seen.id === id && sameMark(mark, seen.mark)) return;
      seen = { id, mark };
      void load.run({ input: id });
    };
    const stopSelection = selected.watch(() => refresh(list.get()));
    const stopList = list.watch(refresh);
    defer(stopSelection);
    defer(stopList);
    refresh(list.get());
    return { watching: true };
  },
});
