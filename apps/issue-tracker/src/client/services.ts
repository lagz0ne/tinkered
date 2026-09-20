import { resource, type Scope } from "@tinker/core";
import { isError as isHttpError } from "@tinker/http";
import { issueList, type Issues } from "../shared/issues.ts";
import { pumpLines, readLine, type Draft } from "../shared/draft.ts";
import { isError } from "../errors.ts";
import {
  connection,
  draftRun,
  markOf,
  sameMark,
  selectedId,
  type Connection,
  type DraftRun,
  type RowMark,
} from "./state.ts";
import { loadDetail } from "./actions.ts";
import { openDraft } from "./api.ts";
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

/** Read a run's terminal outcome as the view the run lands on. */
function readView(outcome: Draft.Outcome): DraftRun["view"] {
  if (outcome === "done") return "ready";
  if (outcome === "cancelled") return "cancelled";
  return "failed";
}

/** Apply one live event to the run cell: text grows, the finished draft lands whole. */
function applyDraft(run: Scope.DataController<DraftRun>, event: Draft.Event): void {
  if (event.kind === "text") {
    const text = event.text;
    run.update((prev) => ({ ...prev, text: prev.text + text }));
  } else if (event.kind === "done") {
    const draft = event.draft;
    run.update((prev) => ({ ...prev, draft }));
  }
}

/** True when the rejection is the reader's own cancel landing: the pump's generation moved
 * on, so the landing ignores it. */
function isStaleCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Read a thrown stream failure as the failed run the cell keeps: a gone issue names itself,
 * a broken frame says so, everything else is the helper failing. */
function readFailedRun(error: unknown): DraftRun {
  if (isHttpError(error, "ResponseFailed") && error.payload.response.status === 404) {
    return { view: "failed", text: "", draft: "", notice: "That issue is gone." };
  }
  if (
    isError(error, "BadDraftInput") ||
    isError(error, "DraftFailed") ||
    isError(error, "IssueNotFound")
  ) {
    return { view: "failed", text: "", draft: "", notice: readFailedMessage(error) };
  }
  return { view: "failed", text: "", draft: "", notice: "The draft helper failed. Try again." };
}

/** Read the failed run's failure as the plain message the view shows. */
function readFailedMessage(error: unknown): string {
  if (isError(error, "BadDraftInput")) return "That draft update was unreadable. Try again.";
  if (isError(error, "DraftFailed")) return "The draft helper failed. Try again.";
  if (isError(error, "IssueNotFound")) return "That issue is gone.";
  return "The draft helper failed. Try again.";
}

/** The quiet run: what discard resets the cell to. */
const quietRun: DraftRun = { view: "quiet", text: "", draft: "", notice: null };

/** The in-flight draft stream: one reader at a time, pumped through the shared SSE helpers.
 * `start` marks the run, opens the stream through the http client, and pumps lines until the
 * terminal frame or a thrown failure lands; a terminal `failed` also writes its notice. `cancel`
 * stops the reader (the browser closes the connection; the pump lands on the terminal frame
 * when it arrived, else on `cancelled`); `discard` cancels and resets to quiet. A selection
 * change discards; `defer` cancels the reader on close. */
export const drafter = resource({
  label: "drafter",
  depends: { open: openDraft, run: draftRun.controller, selected: selectedId.controller },
  factory: ({ open, run, selected }, { defer }) => {
    let epoch = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const stopSelection = selected.watch(() => {
      stop();
      run.set(quietRun);
    });
    defer(stopSelection);
    defer(() => stop());
    function stop(): void {
      epoch += 1;
      reader?.cancel().then(undefined, () => undefined);
      reader = null;
    }
    async function pump(stream: ReadableStream<Uint8Array>, mine: number): Promise<void> {
      if (mine !== epoch) {
        await stream.cancel().then(undefined, () => undefined);
        return;
      }
      const owned = stream.getReader();
      reader = owned;
      try {
        landFinished(mine, await readOutcome(owned, mine));
      } catch (error: unknown) {
        landThrown(mine, error);
      } finally {
        owned.releaseLock();
        if (reader === owned) reader = null;
      }
    }
    async function readOutcome(
      owned: ReadableStreamDefaultReader<Uint8Array>,
      mine: number,
    ): Promise<Draft.Outcome> {
      const decoder = new TextDecoder();
      const pumpState = {
        tail: "",
        apply: (event: Draft.Event) => {
          if (mine === epoch) applyDraft(run, event);
        },
      };
      let outcome: Draft.Outcome = "failed";
      for (;;) {
        const next = await owned.read();
        if (next.done) break;
        const finished = pumpLines(pumpState, decoder.decode(next.value, { stream: true }));
        if (finished !== undefined) outcome = finished;
      }
      const closing = readLine(pumpState.tail);
      if (closing !== null && closing.kind === "terminal") return closing.status;
      return outcome;
    }
    function landThrown(mine: number, error: unknown): void {
      if (mine !== epoch) return;
      if (isStaleCancel(error)) {
        run.update((prev) => (prev.view === "running" ? { ...prev, view: "cancelled" } : prev));
        return;
      }
      run.set(readFailedRun(error));
    }
    function landFinished(mine: number, outcome: Draft.Outcome): void {
      if (mine !== epoch) return;
      if (outcome === "failed") {
        run.update((prev) => ({
          ...prev,
          view: "failed",
          notice: prev.notice ?? "The draft helper failed. Try again.",
        }));
        return;
      }
      run.update((prev) => ({ ...prev, view: readView(outcome) }));
    }
    return {
      start(id: string, prompt: string): Promise<void> {
        stop();
        const mine = epoch;
        run.set({ view: "running", text: "", draft: "", notice: null });
        return (async () => {
          let stream: ReadableStream<Uint8Array>;
          try {
            stream = await open.run({ input: { id, prompt } });
          } catch (error: unknown) {
            landThrown(mine, error);
            return;
          }
          await pump(stream, mine);
        })();
      },
      cancel(): void {
        stop();
        run.update((prev) => (prev.view === "running" ? { ...prev, view: "cancelled" } : prev));
      },
      discard(): void {
        stop();
        run.set(quietRun);
      },
    };
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
      load.run({ input: id }).then(undefined, () => undefined);
    };
    const stopSelection = selected.watch(() => refresh(list.get()));
    const stopList = list.watch(refresh);
    defer(stopSelection);
    defer(stopList);
    refresh(list.get());
    return { watching: true };
  },
});
