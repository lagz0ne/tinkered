import { createScope, operation, tag } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "../src/index.ts";

/** A per-session policy the approval reads: the session decides, not the tool. */
const policy = tag<"allow" | "deny">({ label: "policy", default: "deny" });

/** The approval operation: the SDK's request in, the SDK's decision out; reads are always fine. */
const approve = operation({
  label: "approve",
  input: claudeCode.approval,
  depends: { policy },
  run: ({ policy }, ctx): ClaudeCode.Decision =>
    policy === "allow" || ctx.input.toolName === "Read"
      ? { behavior: "allow" }
      : { behavior: "deny", message: "denied by policy" },
});

/** The real adapter (needs Claude Code auth — not run by tests): every tool call asks `approve`. */
export async function tour(): Promise<string> {
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ tags: [claudeCode.options({ cwd: process.cwd() })] });
  const session = scope.createSession({ tags: [policy("allow")] });
  await session.run(ask, { input: "list the files here" });
  const decisions = session.resolve(coder.items).filter((item) => item.kind === "approval");
  await scope.close();
  return decisions.map((item) => item.status).join(",");
}
