import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/** One recorded turn: the messages a fake `query` yields for it. */
export type Script = { readonly messages: readonly SDKMessage[] };

/** A recorded session id shared by every fixture message of one turn. */
const sessionId = "s-1";

/** A recorded client uuid shared by every fixture message that carries one. */
const uuid = "11111111-2222-4333-8444-555555555555";

/** The usage block every fixture result carries: 10 in, 2 cached, 5 out. */
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

/** A recorded `system` init: the session id lands as soon as the turn opens. */
export function readSystemInit(): SDKSystemMessage {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "0.0.0",
    cwd: "/x",
    tools: [],
    mcp_servers: [],
    model: "m",
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid,
    session_id: sessionId,
  };
}

/** A recorded text delta inside its stream event. */
export function readTextDelta(text: string): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
    uuid,
    session_id: sessionId,
  };
}

/** A recorded assistant message carrying one `tool_use` block. */
export function readToolUse(): SDKAssistantMessage {
  return {
    type: "assistant",
    message: {
      id: "msg-1",
      type: "message",
      role: "assistant",
      model: "m",
      content: [{ type: "tool_use", id: "tu-1", name: "Read", input: {} }],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        fallback_credit: null,
        inference_geo: null,
        iterations: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: null,
        speed: null,
      },
      container: null,
      context_management: null,
      diagnostics: null,
      stop_details: null,
    },
    parent_tool_use_id: null,
    uuid,
    session_id: sessionId,
  };
}

/** A recorded user message carrying the tool's answer. */
export function readToolResult(): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }],
    },
    parent_tool_use_id: null,
  };
}

/** A recorded success result: the fixture text, 10/2/5 usage, cost 0.01, id `s-1`. */
export function readResult(text: string): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: text,
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: readUsage(),
    modelUsage: {},
    permission_denials: [],
    uuid,
    session_id: sessionId,
  };
}

/** A recorded turn: init, two text deltas, a tool call and its answer, then the result. */
export function readScript(text: string): Script {
  return {
    messages: [
      readSystemInit(),
      readTextDelta("Hel"),
      readTextDelta("lo"),
      readToolUse(),
      readToolResult(),
      readResult(text),
    ],
  };
}
