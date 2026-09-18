import { createScope, operation, tag } from "@tinker/core";
import { tool } from "@tinker/mcp";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { claudeCode, harness } from "../src/index.ts";

/** Which index a session searches: a per-session binding the tool reads. */
const index = tag<string>({ label: "index", default: "docs" });

const searchShape = { q: z.string() };

/** A tool is an ordinary operation with `tool` meta: the model calls `search`, the op runs
 * inside the turn; the same declaration serves the MCP driver. */
const search = operation({
  label: "search",
  input: (raw: unknown) => z.object(searchShape).parse(raw),
  depends: { index },
  meta: [tool({ description: "find a phrase in the current index", schema: searchShape })],
  run: ({ index }, ctx): CallToolResult => ({
    content: [{ type: "text", text: `${index}: ${ctx.input.q}` }],
  }),
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
