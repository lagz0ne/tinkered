import { expect, test } from "vite-plus/test";
import { createScope, operation, preset } from "@tinker/core";
import { tool } from "@tinker/mcp";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { claudeCode, harness, type ClaudeCode } from "../src/index.ts";
import { parsePrompt, readResult, readSystemInit } from "./fixtures.ts";

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

/** A fake SDK whose turn calls the frame's tool once and, like the SDK's own MCP server, catches
 * a rejected handler and keeps the error it reports to the model, then ends the turn. */
function reportingSdk(reported: unknown[]): ClaudeCode.Sdk {
  const handlers: Handler[] = [];
  return {
    tool: (name, description, schema, handler) => {
      handlers.push(handler);
      return { name, description, inputSchema: schema, handler };
    },
    createSdkMcpServer: () => ({ type: "stdio", command: "fake" }),
    async *query(): AsyncGenerator<SDKMessage> {
      yield readSystemInit();
      try {
        await handlers[0]({ q: "x" }, {});
      } catch (error: unknown) {
        reported.push(error);
      }
      yield readResult("Hello");
    },
  };
}

const searchShape = { q: z.string() };
const parseSearch = (raw: unknown): { q: string } => z.object(searchShape).parse(raw);
const meta = [tool({ description: "find things", schema: searchShape })];

const panics = operation({
  label: "search",
  input: parseSearch,
  meta,
  run: (): string => {
    throw new Error("index down");
  },
});

const raises = operation({
  label: "search",
  input: parseSearch,
  meta,
  run: (_deps, ctx): string => ctx.raise("SearchDown", { q: ctx.input.q }),
});

const failures = [
  { failure: "a panic", op: panics, kind: "panic" },
  { failure: "a managed error", op: raises, kind: "error" },
];

test.each(failures)(
  "a tool op that fails with $failure is reported to the model; the turn and session succeed",
  async ({ op }) => {
    const reported: unknown[] = [];
    const coder = harness({ label: "coder", adapter: claudeCode, tools: [op] });
    const scope = createScope({
      presets: [preset(claudeCode.sdk, async () => reportingSdk(reported))],
    });
    const session = scope.createSession();
    const result = await session.run(coder.send, { input: { prompt: "hello" } });
    expect(result.subtype === "success" ? result.result : undefined).toBe("Hello");
    expect(reported).toHaveLength(1);
    expect((await session.close({ graceful: true })).status).toBe("success");
    await scope.close();
  },
);

test.each(failures)(
  "a tool failure ($failure) is received at the tool call: rethrown later, its origin stays the tool",
  async ({ op, kind }) => {
    const reported: unknown[] = [];
    const coder = harness({ label: "coder", adapter: claudeCode, tools: [op] });
    const ask = operation({
      label: "coder.ask",
      input: parsePrompt,
      depends: { send: coder.send },
      run: async ({ send }, ctx) => send.run({ input: { prompt: ctx.input } }),
    });
    const relay = operation({
      label: "relay",
      run: (): string => {
        throw reported[0];
      },
    });
    const scope = createScope({
      presets: [preset(claudeCode.sdk, async () => reportingSdk(reported))],
    });
    const session = scope.createSession();
    await session.run(ask, { input: "hello" });
    expect(session.settle(relay)).toMatchObject({
      status: "failed",
      kind,
      origin: { label: "search", path: ["search"] },
    });
    await scope.close();
  },
);
