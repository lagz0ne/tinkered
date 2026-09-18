import { resource, tag, type Data, type Resource, type Tag } from "@tinker/core";
import type {
  CanUseTool,
  Options,
  PermissionResult,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { raise } from "./errors.ts";
import type { Harness } from "./index.ts";

export declare namespace ClaudeCode {
  /** The seam: the SDK module's shape the adapter calls. The real module is assignable —
   * its `query` takes a wider prompt type and returns a `Query`, an AsyncIterable of SDKMessage. */
  export type Sdk = {
    query(params: { prompt: string; options?: Options }): AsyncIterable<SDKMessage>;
  };
  /** A v1 turn: a string prompt. The SDK also accepts an async iterable of user messages — later. */
  export type Turn = { readonly prompt: string };
  /** A v1 result: the SDK's own result message, delivered untouched. */
  export type Result = SDKResultMessage;
  /** One permission request as the SDK's `canUseTool` hands it over: the tool, its input, and
   * the SDK's own options (signal, suggestions, blocked path, tool-use id). The approval
   * operation's input. */
  export type Approval = {
    readonly toolName: string;
    readonly input: Record<string, unknown>;
    readonly options: Parameters<CanUseTool>[2];
  };
  /** An approval's answer: the SDK's own `PermissionResult` (allow with optional updated input
   * and permissions, or deny with a message). */
  export type Decision = PermissionResult;
  /** What userland may answer during a Claude turn: an approval. Tools come with t04. */
  export type Calls = {
    readonly approval: { readonly request: Approval; readonly decision: Decision };
    readonly tool: never;
  };
  /** The Claude Code adapter: options are the SDK's own `Options`, continuity is by session id,
   * and `sdk` is the lazy module resource tests preset with a fake `query`. */
  export type Adapter = Harness.Adapter<Options, Turn, Result, Calls> & {
    readonly sdk: Resource.Handle<Promise<Sdk>>;
    readonly approval: Data.Parse<Approval>;
  };
}

/** The lazy SDK module, as a resource: declaring the harness loads nothing; tests preset this
 * with a fake `query` that yields recorded fixtures. */
const sdk: Resource.Handle<Promise<ClaudeCode.Sdk>> = resource({
  label: "claudeCode.sdk",
  target: "scope",
  factory: (): Promise<ClaudeCode.Sdk> => import("@anthropic-ai/claude-agent-sdk"),
});

/** The Claude Code adapter's own options tag: the SDK's `Options`, bound at scope or session. */
const options: Tag.Handle<Partial<Options>> = tag<Partial<Options>>({
  label: "claudeCode.options",
});

/** Merge one `.all` options list, nearest first: nearer bindings win per key, and
 * `includePartialMessages: true` is forced on (the frame needs text deltas). */
function merge(bindings: readonly Partial<Options>[]): Options {
  const merged: Options = {};
  for (let i = bindings.length - 1; i >= 0; i -= 1) Object.assign(merged, bindings[i]);
  merged.includePartialMessages = true;
  return merged;
}

/** Fold the session's `resume` binding into the SDK's own `resume` option: the SDK takes
 * `resume` in `Options`, so this is a spread. */
function readOpened(options: Options, hooks: Harness.Hooks): Options {
  if (hooks.resume === undefined) return options;
  return { ...options, resume: hooks.resume };
}

/** The smallest stable shape of a permission request: a tool name and an input record. */
function isApproval(raw: unknown): raw is ClaudeCode.Approval {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "toolName" in raw &&
    typeof raw.toolName === "string" &&
    "input" in raw &&
    typeof raw.input === "object" &&
    raw.input !== null
  );
}

/** The parse an `approve` operation declares as its `input`: it types the op's input as the
 * SDK's own request (the frame hands the request in pre-typed, so the parse only runs for a
 * `rawInput` call) and admits a raw value by its smallest stable shape. */
function approval(raw: unknown): ClaudeCode.Approval {
  if (isApproval(raw)) return raw;
  raise("InvalidApproval", { harness: "claudeCode" });
}

/** The Claude Code adapter resource: awaits the lazy module, then opens threads on it. */
const adapterResource: Resource.Handle<
  Promise<Harness.Backend<Options, ClaudeCode.Turn, ClaudeCode.Result, ClaudeCode.Calls>>
> = resource({
  label: "claudeCode",
  target: "scope",
  depends: { sdk },
  factory: async ({ sdk: module }) => {
    const start: Harness.Backend<
      Options,
      ClaudeCode.Turn,
      ClaudeCode.Result,
      ClaudeCode.Calls
    >["start"] = (opened, hooks) =>
      startClaude(module.query.bind(module), readOpened(opened, hooks), hooks);
    return { start };
  },
});

/** The Claude Code adapter: options are the SDK's own `Options`, turns are `{ prompt }`,
 * results are the SDK's result messages. Continuity is by session id: the session's `resume`
 * binding opens the first turn on it, each `run` after the first resumes the last session,
 * so one thread is one conversation.
 * `includePartialMessages: true` is forced at merge — the frame needs the text deltas. */
export const claudeCode: ClaudeCode.Adapter = {
  label: "claudeCode",
  sdk,
  options,
  merge,
  resource: adapterResource,
  approval,
};

/** Start a Claude thread on merged options and hooks: each `run({ prompt })` opens one `query`,
 * feeds every message to `mapClaudeMessage`, and resolves with the result message; later runs
 * resume the last session id. The thread stops when its own aborter fires — wired to the
 * session's signal BEFORE the turn starts, since a defer runs after the turn settled. */
function startClaude(
  query: ClaudeCode.Sdk["query"],
  options: Options,
  hooks: Harness.Hooks,
): Harness.Thread<ClaudeCode.Turn, ClaudeCode.Result, ClaudeCode.Calls> {
  const aborter = new AbortController();
  if (hooks.signal.aborted) aborter.abort(hooks.signal.reason);
  else
    hooks.signal.addEventListener("abort", () => aborter.abort(hooks.signal.reason), {
      once: true,
    });
  let lastId: string | undefined;
  return {
    run: async (turn, calls) => {
      const opened = readTurnOptions(options, lastId, aborter, calls, hooks);
      for await (const message of query({ prompt: turn.prompt, options: opened })) {
        const result = mapClaudeMessage(message, hooks);
        if (result !== undefined) {
          lastId = result.session_id;
          return result;
        }
      }
      if (hooks.signal.aborted) throw hooks.signal.reason;
      raise("TurnEnded", { harness: "claudeCode" });
    },
    close: () => {
      aborter.abort();
    },
  };
}

/** The options one `query` opens with: the merged options, the last session id to resume, the
 * thread's aborter, and — when the frame was built with an `approve` op — a `canUseTool` that
 * answers through it (overriding a `canUseTool` bound in `claudeCode.options`; without an
 * `approve` op a bound one still applies). */
function readTurnOptions(
  options: Options,
  lastId: string | undefined,
  aborter: AbortController,
  calls: Harness.TurnCalls<ClaudeCode.Calls>,
  hooks: Harness.Hooks,
): Options {
  const opened: Options =
    lastId === undefined
      ? { ...options, abortController: aborter }
      : { ...options, resume: lastId, abortController: aborter };
  if (calls.approve !== undefined) opened.canUseTool = readCanUseTool(calls.approve, hooks);
  return opened;
}

/** Answer the SDK's permission prompt through the approval subflow: the request goes in as the
 * op's input, the op's decision goes back as the SDK's `PermissionResult`, and the decision lands
 * in `items` (`kind: "approval"`, `status` = the behavior, the SDK's tool-use id when it gives
 * one, `source` = request + result). */
function readCanUseTool(
  approve: NonNullable<Harness.TurnCalls<ClaudeCode.Calls>["approve"]>,
  hooks: Harness.Hooks,
): CanUseTool {
  return async (toolName, input, options) => {
    const request: ClaudeCode.Approval = { toolName, input, options };
    const result = await approve.run({ input: request });
    hooks.item({
      kind: "approval",
      id: options.toolUseID,
      status: result.behavior,
      source: { request, result },
    });
    return result;
  };
}

/** Map one SDK message onto hook calls; returns the result message when the turn is over, else
 * undefined. Pure — proven through the seam with recorded fixtures. Emits every message raw,
 * forwards text deltas, records tool starts and completions, and reads usage, cost, and id off
 * the result (the `system` init sets the id early too). */
function mapClaudeMessage(message: SDKMessage, hooks: Harness.Hooks): SDKResultMessage | undefined {
  hooks.emit(message);
  if (message.type === "stream_event" || message.type === "assistant" || message.type === "user") {
    readConversationMessage(message, hooks);
    return undefined;
  }
  if (message.type === "system") {
    if (message.subtype === "init") hooks.id(message.session_id);
    return undefined;
  }
  if (message.type === "result") return readResultMessage(message, hooks);
  return undefined;
}

/** Map a conversation message (delta, tool call, tool answer) onto its hook calls. */
function readConversationMessage(
  message: SDKPartialAssistantMessage | SDKAssistantMessage | SDKUserMessage,
  hooks: Harness.Hooks,
): void {
  if (message.type === "stream_event") {
    const delta = readTextDelta(message);
    if (delta !== undefined) hooks.text(delta);
    return;
  }
  if (message.type === "assistant") {
    for (const block of readToolUses(message))
      hooks.item({ kind: "tool_use", id: block.id, status: "started", source: message });
    return;
  }
  for (const toolUseId of readToolResultIds(message))
    hooks.item({ kind: "tool_result", id: toolUseId, status: "completed", source: message });
}

/** Record usage, cost, and id off a result message, then hand it back as the turn's answer. */
function readResultMessage(message: SDKResultMessage, hooks: Harness.Hooks): SDKResultMessage {
  hooks.usage({
    input: message.usage.input_tokens,
    cached: message.usage.cache_read_input_tokens,
    output: message.usage.output_tokens,
    cost: message.total_cost_usd,
  });
  hooks.id(message.session_id);
  return message;
}

/** The text of a raw stream event when it is a text delta, else undefined. */
function readTextDelta(message: SDKPartialAssistantMessage): string | undefined {
  const event = message.event;
  if (event.type !== "content_block_delta") return undefined;
  if (event.delta.type !== "text_delta") return undefined;
  return event.delta.text;
}

/** The `tool_use` blocks of an assistant message. */
function readToolUses(message: SDKAssistantMessage): readonly { readonly id: string }[] {
  const found: { readonly id: string }[] = [];
  for (const block of message.message.content) {
    if (block.type === "tool_use") found.push({ id: block.id });
  }
  return found;
}

/** The `tool_use_id` of every `tool_result` block in a user message. */
function readToolResultIds(message: SDKUserMessage): readonly string[] {
  const content = message.message.content;
  if (typeof content === "string") return [];
  const found: string[] = [];
  for (const block of content) {
    if (block.type === "tool_result") found.push(block.tool_use_id);
  }
  return found;
}
