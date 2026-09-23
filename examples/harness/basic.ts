import { createScope, namespace, operation, preset } from "@tinker/core";
import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";

/** One recorded turn: words streamed one delta at a time, plus the final reply. */
type Script = { readonly words: readonly string[]; readonly reply: string };

const uuid = "11111111-2222-4333-8444-555555555555";

function readUsage(): SDKResultMessage["usage"] {
  return {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    fallback_credit: { status: { type: "redeemed" } },
    inference_geo: "none",
    iterations: [],
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: "standard",
    speed: "standard",
  };
}

function readDelta(word: string, id: string): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: word } },
    parent_tool_use_id: null,
    uuid,
    session_id: id,
  };
}

function readResult(reply: string, id: string): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: reply,
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: readUsage(),
    modelUsage: {},
    permission_denials: [],
    uuid,
    session_id: id,
  };
}

async function* readTurn(script: Script, id: string): AsyncGenerator<SDKMessage> {
  for (const word of script.words) yield readDelta(word, id);
  yield readResult(script.reply, id);
}

const noScript: Script = { words: [], reply: "" };

/** One graph for both agents, declared once; namespaces hold their separate conversations. */
const coder = harness({ adapter: claudeCode });
const a = namespace({ tags: [claudeCode.options({ cwd: "/work", model: "a" })] });
const b = namespace({ tags: [claudeCode.options({ cwd: "/work", model: "b" })] });
const relay = operation({
  label: "relay",
  depends: { send: coder.send },
  run: async ({ send }) => {
    const first = await send.run({ input: { prompt: "first" }, ns: a });
    if (first.subtype !== "success") throw new Error("A failed");
    const second = await send.run({ input: { prompt: first.result }, ns: b });
    if (second.subtype !== "success") throw new Error("B failed");
    return second.result;
  },
});

/** The relay sends A's answer to B; each agent has its own watcher, id, and thread. */
export async function tour(): Promise<string> {
  const seen: string[] = [];
  const scripts: Script[] = [
    { words: ["Hello"], reply: "Hello" },
    { words: ["Hi", "again"], reply: "Hi again" },
  ];
  const fake: ClaudeCode.Sdk = {
    tool: (name, description, schema, handler) => ({
      name,
      description,
      inputSchema: schema,
      handler,
    }),
    createSdkMcpServer: () => ({ type: "stdio", command: "fake" }),
    query: ({ prompt, options }) => {
      seen.push(prompt);
      const script = scripts.shift();
      const id = options?.model === "a" ? "agent-a" : "agent-b";
      return readTurn(script === undefined ? noScript : script, id);
    },
  };
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fake)] });
  const session = scope.createSession();
  const textA: string[] = [];
  const textB: string[] = [];
  session.controller(coder.text, { ns: a }).watch((next) => textA.push(next));
  session.controller(coder.text, { ns: b }).watch((next) => textB.push(next));
  const answer = await session.run(relay);
  const first = session.resolve(coder.text, { ns: a });
  const second = session.resolve(coder.text, { ns: b });
  const idA = session.resolve(coder.id, { ns: a });
  const idB = session.resolve(coder.id, { ns: b });
  await scope.close();
  return [answer, first, second, idA, idB, textA.join("|"), textB.join("|"), seen.join("|")].join(
    ";",
  );
}
