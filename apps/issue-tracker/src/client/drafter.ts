import { resource, type Scope } from "@tinker/core";
import { isError as isHttpError } from "@tinker/http";
import { pumpLines, readLine, type Draft } from "../shared/draft.ts";
import { isError } from "../errors.ts";
import { draftRun, selectedId, type DraftRun } from "./state.ts";
import { openDraft } from "./api.ts";

/** The drafter's handle: the in-flight draft stream's three controls. `start` resolves when the
 * run lands; `cancel` stops the run but keeps its text; `discard` resets to quiet. */
export type Drafter = {
  start(id: string, prompt: string): Promise<void>;
  cancel(): void;
  discard(): void;
};

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
  factory: ({ open, run, selected }, { defer }): Drafter => {
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
        landThrown(mine, owned, error);
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
    function landThrown(
      mine: number,
      owned: ReadableStreamDefaultReader<Uint8Array> | null,
      error: unknown,
    ): void {
      if (mine !== epoch) return;
      if (isStaleCancel(error)) {
        run.update((prev) => (prev.view === "running" ? { ...prev, view: "cancelled" } : prev));
        return;
      }
      owned?.cancel().then(undefined, () => undefined);
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
            landThrown(mine, null, error);
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
