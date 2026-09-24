import { operation, tag } from "@tinker/core";
import { emit } from "@tinker/hono";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";
import { fail, raise } from "../errors.ts";
import { describeError } from "./observe.ts";
import { parseDraftInput, type Draft } from "../shared/draft.ts";
import { getRemote, listRemote } from "../tools/issues.ts";
import { readDetail } from "./operations.ts";

/** Draft helper config: off unless the root binds it on. Read by
 * `readCapability` and by `startDraft`; a test rebinds it on. */
export const draftHelper = tag<{
  readonly enabled: boolean;
  readonly baseUrl: string | undefined;
}>({ label: "draftHelper", default: { enabled: false, baseUrl: undefined } });

/** Read whether the draft helper is on: what the client shows or hides. */
export const readCapability = operation({
  label: "readCapability",
  depends: { draft: draftHelper },
  run: ({ draft }) => ({ enabled: draft.enabled }),
});

const denyUnexpected = operation({
  label: "denyUnexpected",
  input: claudeCode.approval,
  run: (): ClaudeCode.Decision => ({ behavior: "deny", message: "only issue reads are allowed" }),
});

export const triage = harness({
  label: "triage",
  adapter: claudeCode,
  approve: denyUnexpected,
  tools: [listRemote, getRemote],
});

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

export const draftTurn = operation({
  label: "triage.draft",
  input: parseDraftInput,
  depends: { send: triage.send },
  run: async ({ send }, ctx) => {
    const result = await send.run({ input: { prompt: readPrompt(ctx.input) } });
    if (result.subtype === "success") return result.result;
    throw fail("DraftFailed", { reason: "the draft run did not finish" });
  },
});

function draftFrame(event: Draft.Event): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Check the helper and issue before sending headers; hand the checked input
 * to the declared body operation. */
export const startDraft = operation({
  label: "startDraft",
  input: parseDraftInput,
  depends: {
    draft: draftHelper,
    detail: readDetail,
  },
  run: async ({ draft, detail }, ctx) => {
    if (draft.enabled === false) raise("DraftOff", {});
    await detail.run({ input: ctx.input.id });
    return ctx.input;
  },
});

/** Emit text, status, and the terminal frame from the draft's own step.
 * A client disconnect aborts the turn; a failed run logs once. */
export const draftBody = operation({
  label: "draftBody",
  input: parseDraftInput,
  depends: {
    emit: emit.required,
    turn: draftTurn,
    text: triage.text.controller,
    status: triage.status.controller,
  },
  run: async ({ emit, turn, text, status }, { input, signal, log, defer }) => {
    let live = "";
    const unText = text.watch((next) => {
      if (next.length > live.length) {
        emit(draftFrame({ kind: "text", text: next.slice(live.length) }));
        live = next;
      }
    });
    const unStatus = status.watch((next) => {
      if (next === "running") emit(draftFrame({ kind: "status", status: next }));
    });
    defer(() => {
      unText();
      unStatus();
    });
    try {
      const draftText = await turn.run({ input });
      try {
        emit(draftFrame({ kind: "status", status: "done" }));
        emit(draftFrame({ kind: "done", draft: draftText }));
        emit(draftFrame({ kind: "terminal", status: "done", draft: draftText }));
      } catch {
        return;
      }
    } catch (error) {
      const outcome: Draft.Outcome = signal.aborted ? "cancelled" : "failed";
      if (outcome === "failed") log("draft failed", { id: input.id, ...describeError(error) });
      try {
        emit(draftFrame({ kind: "status", status: outcome }));
        emit(draftFrame({ kind: "terminal", status: outcome, draft: "" }));
      } catch {
        return;
      }
    }
  },
});
