import { createScope, preset } from "@tinker/core";
import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeCode, harness, type ClaudeCode } from "../src/index.ts";

/** One recorded turn: the words streamed one delta at a time, plus the final reply. */
type Script = { readonly words: readonly string[]; readonly reply: string };

/** A recorded client uuid shared by every message built below. */
const uuid = "11111111-2222-4333-8444-555555555555";

/** The usage block every result built below carries. */
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

/** One text delta inside its stream event. */
function readDelta(word: string): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: word } },
    parent_tool_use_id: null,
    uuid,
    session_id: "s-1",
  };
}

/** One success result carrying the turn reply. */
function readResult(reply: string): SDKResultMessage {
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
    session_id: "s-1",
  };
}

/** The messages of one recorded turn: one delta per word, then the result. */
async function* readTurn(script: Script): AsyncGenerator<SDKMessage> {
  for (const word of script.words) yield readDelta(word);
  yield readResult(script.reply);
}

/** An empty turn for a prompt with no recorded script left. */
const noScript: Script = { words: [], reply: "" };

/** A cast-free tour of the frame with a fake `query`: two turns, recorded calls, the `text`
 * cell watched while each turn runs. Every value type is inferred. */
export async function tour(): Promise<string> {
  const seen: string[] = [];
  const scripts: Script[] = [
    { words: ["Hello"], reply: "Hello" },
    { words: ["Hi", "again"], reply: "Hi again" },
  ];
  const fake: ClaudeCode.Sdk = {
    query: ({ prompt }) => {
      seen.push(prompt);
      const script = scripts.shift();
      return readTurn(script === undefined ? noScript : script);
    },
  };

  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    tags: [claudeCode.options({ cwd: "/work" })],
    presets: [preset(claudeCode.sdk, async () => fake)],
  });
  const session = scope.createSession();
  const textSeen: string[] = [];
  session.controller(coder.text).watch((next) => textSeen.push(next));

  await session.run(ask, { input: "first" });
  const first = session.resolve(coder.text);
  await session.run(ask, { input: "second" });
  const second = session.resolve(coder.text);
  await scope.close();
  return [first, second, textSeen.join("|"), seen.join("|")].join(";");
}
