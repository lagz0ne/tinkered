import { createScope, tag } from "@tinker/core";
import { z } from "zod";
import { claudeCode, harness } from "../src/index.ts";

/** Which index a session searches: a per-session binding the tool reads. */
const index = tag<string>({ label: "index", default: "docs" });

/** An in-process tool: the model calls `search`, the operation runs inside the turn. */
const search = claudeCode.tool({
  name: "search",
  description: "find a phrase in the current index",
  schema: { q: z.string() },
  depends: { index },
  run: ({ index }, ctx) => ({ content: [{ type: "text", text: `${index}: ${ctx.input.q}` }] }),
});

/** The real adapter (needs Claude Code auth — not run by tests): the model may call `search`. */
export async function tour(): Promise<string> {
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    tags: [claudeCode.options({ cwd: process.cwd(), allowedTools: ["mcp__coder__search"] })],
  });
  const session = scope.createSession({ tags: [index("code")] });
  await session.run(ask, { input: "search for the word harness" });
  const answer = session.resolve(coder.text);
  await scope.close();
  return answer;
}
