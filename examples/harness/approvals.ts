import { createScope, operation, tag } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";

function parsePrompt(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("bad prompt");
  return raw;
}

/** A per-session policy the approval reads: the session decides, not the tool. */
const policy = tag<"allow" | "deny">({ label: "policy", default: "deny" });

const approve = operation({
  label: "approve",
  input: claudeCode.approval,
  depends: { policy },
  run: ({ policy }, ctx): ClaudeCode.Decision =>
    policy === "allow" || ctx.input.toolName === "Read"
      ? { behavior: "allow" }
      : { behavior: "deny", message: "denied by policy" },
});

const coder = harness({ label: "coder", adapter: claudeCode, approve });
const ask = operation({
  label: "coder.ask",
  input: parsePrompt,
  depends: { send: coder.send },
  run: async ({ send }, ctx) => {
    const result = await send.run({ input: { prompt: ctx.input } });
    return result;
  },
});

/** The real adapter (needs Claude Code auth — not run by tests).
 * Every tool call asks `approve`.
 * Units are declared once at module level (ADR 0057); `tour` only wires a scope and runs them. */
export async function tour(): Promise<string> {
  const scope = createScope({ tags: [claudeCode.options({ cwd: process.cwd() })] });
  const session = scope.createSession({ tags: [policy("allow")] });
  await session.run(ask, { input: "list the files here" });
  const decisions = session.resolve(coder.items).filter((item) => item.kind === "approval");
  await scope.close();
  return decisions.map((item) => item.status).join(",");
}
