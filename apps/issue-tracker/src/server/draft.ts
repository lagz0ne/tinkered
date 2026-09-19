import { operation, type Scope } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";
import { fail, isError } from "../errors.ts";
import { parseDraftInput, type Draft } from "../shared/draft.ts";
import { getRemote, listRemote } from "../tools/issues.ts";

/** Deny every permission prompt: the run may call only the two declared read tools. */
const denyUnexpected = operation({
  label: "denyUnexpected",
  input: claudeCode.approval,
  run: (): ClaudeCode.Decision => ({ behavior: "deny", message: "only issue reads are allowed" }),
});

/** The triage helper: one frame whose turns read issues through the existing
 * remote get/list tools. The server owns every write; this frame only reads. */
export const triage = harness({
  label: "triage",
  adapter: claudeCode,
  approve: denyUnexpected,
  tools: [listRemote, getRemote],
});

/** The SDK guardrails: no built-in tools, no filesystem settings, no outside
 * MCP config; only the frame's two in-process read tools auto-run. */
export const draftGuardrails = claudeCode.options({
  tools: [],
  allowedTools: ["mcp__triage__list", "mcp__triage__get"],
  settingSources: [],
  strictMcpConfig: true,
});

function readPrompt(input: { readonly id: string; readonly prompt: string }): string {
  const ask = input.prompt.trim().length > 0 ? input.prompt : "summarize it and suggest next steps";
  return `Read issue ${input.id} with the get tool, then ${ask}. Reply with a short summary or next steps as plain text.`;
}

/** One draft turn: reads the issue through the frame's tools, answers plain text.
 * A non-success SDK result is a managed DraftFailed, never an empty success. */
export const draftTurn = triage.turn({
  label: "draft",
  input: parseDraftInput,
  request: (input) => ({ prompt: readPrompt(input) }),
  response: (result) => {
    if (result.subtype === "success") return result.result;
    throw fail("DraftFailed", { reason: "the draft run did not finish" });
  },
});

export declare namespace RunDraft {
  /** What the run hands its caller, after the session closes. */
  export type Done = {
    readonly status: Draft.Outcome;
    readonly draft: string;
  };
}

/** Read a scope close result as one terminal draft outcome: any teardown
 * error makes the run failed, on every status; then any failure or
 * cancellation means the run did not finish. Root shutdown can cancel the
 * child even when the caller's signal is live. */
function readClosed(end: Scope.Result): Draft.Outcome {
  if (end.teardownErrors !== undefined && end.teardownErrors.length > 0) return "failed";
  if (end.status !== "success") return end.status === "cancelled" ? "cancelled" : "failed";
  return "done";
}

/** Run one draft turn in its own child session of the owning scope. The
 * caller borrows the owner, watches `notify` for transient text/status, and
 * aborts `signal` to cancel. An already-aborted signal runs nothing and
 * reports cancelled. Otherwise the runner starts a forced close on abort,
 * joins the turn and that same close, removes its watchers, inspects the
 * close result (failure, cancellation, teardown errors), and only then
 * emits and returns the terminal outcome — never by writing into the
 * sealed session. Reads only; it holds no DB transaction and saves nothing. */
export async function runDraft(
  owner: Scope.Handle,
  input: { readonly id: string; readonly prompt: string },
  notify: (event: Draft.Event) => void,
  signal: AbortSignal,
): Promise<RunDraft.Done> {
  if (signal.aborted) return { status: "cancelled", draft: "" };
  const session = owner.createSession({ tags: [draftGuardrails] });
  let live = "";
  const unText = session.controller(triage.text).watch((next) => {
    if (next.length > live.length) notify({ kind: "text", text: next.slice(live.length) });
    live = next;
  });
  const unStatus = session.controller(triage.status).watch((next) => {
    if (next === "running" || next === "done" || next === "failed") {
      notify({ kind: "status", status: next });
    }
  });
  let closing: Promise<Scope.Result> | undefined;
  const onAbort = (): void => {
    closing ??= session.close();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let outcome: { readonly finished: boolean; readonly draft: string };
  let thrown: unknown;
  try {
    outcome = await settleRun(session, input, signal);
  } catch (error: unknown) {
    outcome = { finished: false, draft: "" };
    thrown = error;
  } finally {
    unText();
    unStatus();
    signal.removeEventListener("abort", onAbort);
  }
  const closed = readClosed(await (closing ?? session.close({ graceful: true })));
  if (closed === "cancelled") return { status: "cancelled", draft: outcome.draft };
  if (closed === "failed") return { status: "failed", draft: outcome.draft };
  if (thrown !== undefined) throw thrown;
  const status = readOutcome(outcome, closed);
  if (status === "done") notify({ kind: "done", draft: outcome.draft });
  return { status, draft: outcome.draft };
}

/** Join one turn: its draft text on success, empty text otherwise. A
 * DraftFailed from the turn body is a model failure, not a throwaway. */
async function settleRun(
  session: Scope.Handle,
  input: { readonly id: string; readonly prompt: string },
  signal: AbortSignal,
): Promise<{ readonly finished: boolean; readonly draft: string }> {
  try {
    const draft = await session.run(draftTurn, { input });
    return { finished: true, draft };
  } catch (error: unknown) {
    if (signal.aborted) return { finished: false, draft: "" };
    if (isError(error, "DraftFailed")) return { finished: false, draft: "" };
    throw error;
  }
}

/** Combine the turn join with the close inspection: a close failure,
 * cancellation, or teardown error overrides an advertised success. */
function readOutcome(
  outcome: { readonly finished: boolean; readonly draft: string },
  closed: Draft.Outcome,
): Draft.Outcome {
  if (closed !== "done") return closed;
  if (outcome.finished) return "done";
  return "failed";
}
