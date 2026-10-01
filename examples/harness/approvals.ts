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

if (import.meta.main) {
  const requestStop = new AbortController();
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [claudeCode.options({ cwd: process.cwd() })],
  });
  let output: string | undefined;
  let completed = false;
  const onStop = () => requestStop.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  try {
    await root.ready;
    if (!requestStop.signal.aborted) {
      const session = root.createSession({ tags: [policy("deny")] });
      await session.run(ask, { input: "list the files here" });
      if (!requestStop.signal.aborted) {
        const decisions = session.resolve(coder.items).filter((item) => item.kind === "approval");
        output = decisions.map((item) => item.status).join(",");
      }
    }
    completed = true;
  } finally {
    stop.abort();
    const result = await root.closed;
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
    if (completed) checkClosed(result);
  }
  if (output !== undefined) process.stdout.write(`${output}\n`);
}
