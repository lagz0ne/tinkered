import { expect, test } from "vite-plus/test";
import { createScope, operation, preset, type Observe } from "@tinker/core";
import { tool } from "@tinker/mcp";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { claudeCode, harness, type ClaudeCode } from "../src/index.ts";
import {
  parsePrompt,
  readResult,
  readSystemInit,
  readToolResult,
  readToolSdk,
  readToolUse,
  readScript,
  type Script,
} from "./fixtures.ts";

/** A fake SDK module: each `query` records its call, then yields the next script's messages —
 * checking the call's abort signal before every yield, so a forced close lands mid-turn. */
function fakeSdk(scripts: Script[], seen: string[]): ClaudeCode.Sdk {
  return {
    ...readToolSdk(),
    query: ({ prompt, options }: { prompt: string; options?: Options }) => {
      seen.push(prompt);
      const messages = scripts.shift()?.messages ?? [];
      const signal = options?.abortController?.signal;
      return (async function* (): AsyncGenerator<SDKMessage> {
        for (const message of messages) {
          if (signal?.aborted === true) throw signal.reason;
          yield message;
        }
      })();
    },
  };
}

const coder = harness({ label: "coder", adapter: claudeCode });

/** The author's own operation: it depends on `send` and reads the result itself. */
const ask = operation({
  label: "coder.ask",
  input: parsePrompt,
  depends: { send: coder.send },
  run: async ({ send }, ctx) => {
    const result = await send.run({ input: { prompt: ctx.input } });
    return result.subtype === "success" ? result.result : "error";
  },
});

/** The operation tree as `parent > child` lines, deepest last, in start order: the graph's
 * own steps (the session `thread` resource and the adapter's lazy modules nest beside them
 * — asserted separately — so the tree reads without them). */
function shape(spans: readonly Observe.Span[]): string[] {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const ops = spans.filter((span) => span.kind === "operation");
  const ids = new Set(ops.map((span) => span.id));
  const opDepth = (span: Observe.Span): number => {
    let n = 0;
    for (let at = span.parentId; at !== undefined; at = byId.get(at)?.parentId) {
      if (ids.has(at)) n += 1;
    }
    return n;
  };
  return ops.sort((a, b) => a.id - b.id).map((span) => `${"  ".repeat(opDepth(span))}${span.name}`);
}

test("the graph produces the trace: the author's op over the frame's send", async () => {
  const scope = createScope({
    observe: { history: 20 },
    presets: [preset(claudeCode.sdk, async () => fakeSdk([readScript("Hello")], []))],
  });
  const result = await scope.createSession().run(ask, { input: "hello" });
  expect(result).toBe("Hello");
  expect(shape(scope.spans())).toEqual(["coder.ask", "  coder.send"]);
  const spans = scope.spans();
  const send = spans.find((span) => span.name === "coder.send");
  const thread = spans.find((span) => span.name === "coder.thread");
  expect(thread?.parentId).toBe(send?.id);
  await scope.close();
});

/** One tool the turn calls: a plain-value op with `tool` meta. */
const search = operation({
  label: "search",
  input: z.object({ q: z.string() }),
  meta: [tool({ description: "find things", schema: { q: z.string() } })],
  run: (_deps, ctx) => `hit:${(ctx.input as { q: string }).q}`,
});

test("the graph produces the trace: the tool nests under the send", async () => {
  const seen: {
    servers: {
      name: string;
      tools: Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"];
    }[];
    results: CallToolResult[];
  } = { servers: [], results: [] };
  const sdk: ClaudeCode.Sdk = {
    tool: (name, description, schema, handler) => ({
      name,
      description,
      inputSchema: schema,
      handler,
    }),
    createSdkMcpServer: ({ name, tools }) => {
      seen.servers.push({ name, tools });
      return { type: "stdio", command: "fake" };
    },
    query: ({ options }) => readToolStream(options, seen),
  };
  const withTools = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const askTools = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: withTools.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result.subtype === "success" ? result.result : "error";
    },
  });
  const scope = createScope({
    observe: { history: 30 },
    presets: [preset(claudeCode.sdk, async () => sdk)],
  });
  const result = await scope.createSession().run(askTools, { input: "hello" });
  expect(result).toBe("Hello");
  expect(shape(scope.spans())).toEqual(["coder.ask", "  coder.send", "    search"]);
  await scope.close();
});

/** The recorded turn with the model's tool call answered through the registered server. */
async function* readToolStream(
  options: Options | undefined,
  seen: {
    servers: {
      name: string;
      tools: Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"];
    }[];
    results: CallToolResult[];
  },
): AsyncGenerator<SDKMessage> {
  yield readSystemInit();
  const server = seen.servers[seen.servers.length - 1];
  const registered = options?.mcpServers?.coder === undefined ? undefined : server?.tools[0];
  if (registered !== undefined) seen.results.push(await registered.handler({ q: "x" }, {}));
  yield readToolUse();
  yield readToolResult();
  yield readResult("Hello");
}
