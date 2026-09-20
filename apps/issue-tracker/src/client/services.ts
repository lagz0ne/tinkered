import { resource } from "@tinker/core";
import { issueList, type Issues } from "../shared/issues.ts";
import {
  connection,
  markOf,
  sameMark,
  selectedId,
  type Connection,
  type RowMark,
} from "./state.ts";
import { loadDetail } from "./actions.ts";
import { wire, type WireStatus } from "./connection.ts";

/** Read one wire status as the connection cell the tab renders. */
function readConnection(status: WireStatus): Connection {
  if (status === "live") return { live: true, pending: false, failed: false, closedBadly: false };
  if (status === "connecting")
    return { live: false, pending: true, failed: false, closedBadly: false };
  if (status === "failed") return { live: false, pending: false, failed: true, closedBadly: false };
  return { live: false, pending: false, failed: false, closedBadly: false };
}

/** Watch the wire's status and write the connection cell: the tab's only view of the drop.
 * A reconnect's own pending write is kept: the wire flips `connecting` first, so the resource
 * only answers drops and failures, never a reconnect in flight. */
export const liveness = resource({
  label: "liveness",
  depends: { line: wire.required, link: connection.controller },
  factory: ({ line, link }, { defer }) => {
    link.set(readConnection(line.status()));
    const stopStatus = line.onStatus((status) => {
      if (status === "connecting") return;
      link.set(readConnection(status));
    });
    defer(stopStatus);
    return { watching: true };
  },
});

/** Reload the detail when the selection moves or the selected row changes on the wire: a
 * change to its `revision`/`updatedAt` in the list reruns the load, even when the shown
 * detail already names the issue (a comment bumps `updatedAt` without touching the draft).
 * The load is the race loser by design: it writes nothing once the selection moved on or a
 * newer snapshot landed first. */
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
      load.run({ input: id });
    };
    const stopSelection = selected.watch(() => refresh(list.get()));
    const stopList = list.watch(refresh);
    defer(stopSelection);
    defer(stopList);
    refresh(list.get());
    return { watching: true };
  },
});
