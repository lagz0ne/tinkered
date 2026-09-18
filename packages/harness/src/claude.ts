import { resource, tag, type Resource, type Tag } from "@tinker/core";
import type {
  Options,
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
  /** The Claude Code adapter: options are the SDK's own `Options`, continuity is by session id,
   * and `sdk` is the lazy module resource tests preset with a fake `query`. */
  export type Adapter = Harness.Adapter<Options, Turn, Result> & {
    readonly sdk: Resource.Handle<Promise<Sdk>>;
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

/** The Claude Code adapter resource: awaits the lazy module, then opens threads on it. */
const adapterResource: Resource.Handle<
  Promise<Harness.Backend<Options, ClaudeCode.Turn, ClaudeCode.Result>>
> = resource({
  label: "claudeCode",
  target: "scope",
  depends: { sdk },
  factory: async ({ sdk: pending }) => {
    const module: ClaudeCode.Sdk = await pending;
    const start: Harness.Backend<Options, ClaudeCode.Turn, ClaudeCode.Result>["start"] = (
      opened,
      hooks,
    ) => startClaude(module.query.bind(module), readOpened(opened, hooks), hooks);
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
};

/** Start a Claude thread on merged options and hooks: each `run({ prompt })` opens one `query`,
 * feeds every message to `mapClaudeMessage`, and resolves with the result message; later runs
 * resume the last session id. The thread stops when its own aborter fires — wired to the
 * session's signal BEFORE the turn starts, since a defer runs after the turn settled. */
function startClaude(
  query: ClaudeCode.Sdk["query"],
  options: Options,
  hooks: Harness.Hooks,
): Harness.Thread<ClaudeCode.Turn, ClaudeCode.Result> {
  const aborter = new AbortController();
  if (hooks.signal.aborted) aborter.abort(hooks.signal.reason);
  else
    hooks.signal.addEventListener("abort", () => aborter.abort(hooks.signal.reason), {
      once: true,
    });
  let lastId: string | undefined;
  return {
    run: async (turn) => {
      const opened: Options =
        lastId === undefined
          ? { ...options, abortController: aborter }
          : { ...options, resume: lastId, abortController: aborter };
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
