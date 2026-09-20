import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeCode } from "../src/index.ts";
import type { ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk";

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

/** A recorded assistant message with no tool call: no tool item lands in `items`. */
export function readAssistantText(text: string): SDKAssistantMessage {
  return {
    type: "assistant",
    message: {
      id: "msg-2",
      type: "message",
      role: "assistant",
      model: "m",
      content: [{ type: "text", text, citations: null }],
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

/** One recorded Codex turn: the events a fake `runStreamed` yields for it. */
export type CodexScript = { readonly events: readonly ThreadEvent[] };

/** The usage block every Codex fixture completion carries: 10 in, 2 cached, 5 out. */
function readCodexUsage(): Usage {
  return {
    input_tokens: 10,
    cached_input_tokens: 2,
    cache_write_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 1,
  };
}

/** One recorded agent message item carrying the turn text so far. */
function readAgentMessage(id: string, text: string): ThreadItem {
  return { id, type: "agent_message", text };
}

/** One recorded command item: `ls`, still running or done with its output. */
function readCommand(status: "in_progress" | "completed"): ThreadItem {
  if (status === "in_progress")
    return { id: "c-1", type: "command_execution", command: "ls", aggregated_output: "", status };
  return {
    id: "c-1",
    type: "command_execution",
    command: "ls",
    aggregated_output: "a\n",
    exit_code: 0,
    status,
  };
}

/** A recorded Codex turn: started, an agent message growing Hel → Hello, a command, completion. */
export function readCodexScript(): CodexScript {
  return {
    events: [
      { type: "thread.started", thread_id: "t-1" },
      { type: "turn.started" },
      { type: "item.started", item: readAgentMessage("m-1", "") },
      { type: "item.updated", item: readAgentMessage("m-1", "Hel") },
      { type: "item.updated", item: readAgentMessage("m-1", "Hello") },
      { type: "item.started", item: readCommand("in_progress") },
      { type: "item.completed", item: readCommand("completed") },
      { type: "item.completed", item: readAgentMessage("m-1", "Hello") },
      { type: "turn.completed", usage: readCodexUsage() },
    ],
  };
}

/** A recorded Codex turn that fails: started, then `turn.failed` with the reason. */
export function readCodexFailure(): CodexScript {
  return {
    events: [
      { type: "thread.started", thread_id: "t-1" },
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "boom" } },
    ],
  };
}

/** The two tool members of the Claude seam for a fake that never registers tools: `tool` keeps
 * the definition, `createSdkMcpServer` returns a stdio config (a legit `McpServerConfig`). */
export function readToolSdk(): Pick<ClaudeCode.Sdk, "tool" | "createSdkMcpServer"> {
  return {
    tool: (name, description, schema, handler) => ({
      name,
      description,
      inputSchema: schema,
      handler,
    }),
    createSdkMcpServer: () => ({ type: "stdio", command: "fake" }),
  };
}
