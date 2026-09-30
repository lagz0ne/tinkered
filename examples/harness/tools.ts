import { createScope, operation, tag } from "@tinker/core";
import { expose } from "@tinker/mcp";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { claudeCode, harness } from "@tinker/harness";
import { checkClosed } from "./errors.ts";

/** Which index a session searches: a per-session binding the tool reads. */
const index = tag<string>({ label: "index", default: "docs" });

const searchShape = { q: z.string() };

/** A tool is an ordinary operation plus a row with its facts: the model calls `search`, the
 * op runs inside the turn; the same row serves the MCP driver. */
const search = operation({
  label: "search",
  input: z.object(searchShape),
  depends: { index },
  run: ({ index }, ctx): CallToolResult => ({
    content: [{ type: "text", text: `${index}: ${ctx.input.q}` }],
  }),
});
const searchTool = expose(search, {
  description: "find a phrase in the current index",
  schema: searchShape,
});

const coder = harness({ label: "coder", adapter: claudeCode, tools: [searchTool] });
const ask = operation({
  label: "coder.ask",
  input: z.string().trim().min(1),
  depends: { send: coder.send },
  run: ({ send }, ctx) => send.run({ input: { prompt: ctx.input } }),
});

/** Requires Claude Code auth; the tool reads the session's index tag. */
export async function tour(cwd: string): Promise<string> {
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [claudeCode.options({ cwd, allowedTools: ["mcp__coder__search"] })],
  });
  let completed = false;
  try {
    await root.ready;
    const session = root.createSession({ tags: [index("code")] });
    await session.run(ask, { input: "search for the word harness" });
    const result = session.resolve(coder.text);
    completed = true;
    return result;
  } finally {
    stop.abort();
    const result = await root.closed;
    if (completed) checkClosed(result);
  }
}

if (import.meta.main) process.stdout.write(`${await tour(process.cwd())}\n`);
