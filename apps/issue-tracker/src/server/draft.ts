import { operation } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";
import { parseDraftInput } from "../shared/draft.ts";
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

/** One draft turn: reads the issue through the frame's tools, answers plain text. */
export const draftTurn = triage.turn({
  label: "draft",
  input: parseDraftInput,
  request: (input) => ({ prompt: readPrompt(input) }),
  response: (result) => (result.subtype === "success" ? result.result : ""),
});
