import { createScope, operation, tag } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";
import { z } from "zod";
import { checkClosed } from "./errors.ts";

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
  input: z.string().trim().min(1),
  depends: { send: coder.send },
  run: ({ send }, ctx) => send.run({ input: { prompt: ctx.input } }),
});

/** Requires Claude Code auth; the deny policy still permits the Read tool. */
export async function tour(cwd: string): Promise<string> {
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [claudeCode.options({ cwd })],
  });
  let completed = false;
  try {
    await root.ready;
    const session = root.createSession({ tags: [policy("deny")] });
    await session.run(ask, { input: "list the files here" });
    const decisions = session.resolve(coder.items).filter((item) => item.kind === "approval");
    const result = decisions.map((item) => item.status).join(",");
    completed = true;
    return result;
  } finally {
    stop.abort();
    const result = await root.closed;
    if (completed) checkClosed(result);
  }
}

if (import.meta.main) process.stdout.write(`${await tour(process.cwd())}\n`);
