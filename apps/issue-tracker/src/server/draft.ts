import { operation, type Scope } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode, type Harness } from "@tinker/harness";
import { fail } from "../errors.ts";
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
  /** What the run hands its caller: the final outcome plus the live text. */
  export type Done = {
    readonly status: Draft.Status;
    readonly draft: string;
  };
}

/** Run one draft turn in its own child session of the owning scope. The
 * caller borrows the owner, watches `notify` for transient text/status, and
 * aborts `signal` to cancel: the runner closes that session first, joins
 * the turn, removes its watchers, then reports the terminal outcome through
 * the returned `Done` — never by writing into the sealed session. Reads
 * only; it holds no DB transaction and saves nothing. */
export async function runDraft(
  owner: Scope.Handle,
  input: { readonly id: string; readonly prompt: string },
  notify: (event: Draft.Event) => void,
  signal: AbortSignal,
): Promise<RunDraft.Done> {
  const session = owner.createSession({ tags: [draftGuardrails] });
  const seen = { text: "", status: "" as Harness.Status };
  const unText = session.controller(triage.text).watch((next) => {
    if (next.length > seen.text.length) notify({ kind: "text", text: next.slice(seen.text.length) });
    seen.text = next;
  });
  const unStatus = session.controller(triage.status).watch((next) => {
    seen.status = next;
    if (next === "running" || next === "done" || next === "failed") {
      notify({ kind: "status", status: next });
    }
  });
  const onAbort = (): void => {
    ignoreResult(session.close());
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const draft = await session.run(draftTurn, { input });
    notify({ kind: "done", draft });
    return { status: "done", draft };
  } catch (error: unknown) {
    if (signal.aborted) return { status: "cancelled", draft: seen.text };
    return { status: "failed", draft: seen.text };
  } finally {
    signal.removeEventListener("abort", onAbort);
    unText();
    unStatus();
    await readClosed(session);
  }
}

function ignoreResult(promise: Promise<unknown>): void {
  promise.then(settledResult, settledResult);
}

function settledResult(): void {}

async function readClosed(session: Scope.Handle): Promise<void> {
  const end = await session.close({ graceful: true });
  if (end.status === "failed") throw end.error;
}
