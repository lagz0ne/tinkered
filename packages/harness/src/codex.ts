import { resource, tag, type Resource, type Tag } from "@tinker/core";
import type {
  CodexOptions,
  Input,
  ItemCompletedEvent,
  ItemStartedEvent,
  ItemUpdatedEvent,
  RunResult as CodexTurn,
  ThreadEvent,
  ThreadItem,
  ThreadOptions,
  TurnOptions,
  Usage,
} from "@openai/codex-sdk";
import { raise } from "./errors.ts";
import type { Harness } from "./index.ts";

export declare namespace OpenAiCodex {
  /** The seam: the SDK module's shape the adapter calls. The real module is assignable —
   * its `Codex` class constructor and methods are wider than this narrow thread. */
  export type Sdk = {
    Codex: new (options?: CodexOptions) => {
      startThread(options?: ThreadOptions): Thread;
      resumeThread(id: string, options?: ThreadOptions): Thread;
    };
  };
  /** The narrow thread the adapter runs turns on: one `codex exec` process per `runStreamed`. */
  export type Thread = {
    runStreamed(
      input: Input,
      turnOptions?: TurnOptions,
    ): Promise<{ events: AsyncIterable<ThreadEvent> }>;
  };
  /** A v1 turn: the SDK's own input plus its per-turn output schema. */
  export type Turn = { readonly input: Input; readonly outputSchema?: unknown };
  /** A v1 result: the SDK's own turn, delivered untouched. */
  export type Result = CodexTurn;
  /** What userland may answer during a Codex turn: nothing — the SDK offers only the
   * `approvalPolicy` string and MCP config for external processes (ADR 0043), so the frame
   * rejects an `approve` op for this adapter at compile time. */
  export type Calls = { readonly approval: never; readonly tool: never };
  /** The Codex adapter: options are the SDK's own `CodexOptions & ThreadOptions`, continuity
   * is by thread id (`resumeThread` on `hooks.resume`), and `sdk` is the lazy module
   * resource tests preset with a fake `Codex`. */
  export type Adapter = Harness.Adapter<Options, Turn, Result, Calls> & {
    readonly sdk: Resource.Handle<Promise<Sdk>>;
  };
  /** The Codex adapter's options: the SDK's own `CodexOptions & ThreadOptions`. */
  export type Options = CodexOptions & ThreadOptions;
}

/** The lazy SDK module, as a resource: declaring the harness loads nothing; tests preset this
 * with a fake `Codex` that streams recorded fixtures. */
const sdk: Resource.Handle<Promise<OpenAiCodex.Sdk>> = resource({
  label: "codex.sdk",
  target: "scope",
  factory: (): Promise<OpenAiCodex.Sdk> => import("@openai/codex-sdk"),
});

/** The Codex adapter's own options tag: the SDK's `CodexOptions & ThreadOptions`. */
const options: Tag.Handle<Partial<OpenAiCodex.Options>> = tag<Partial<OpenAiCodex.Options>>({
  label: "codex.options",
});

/** Merge one `.all` options list, nearest first: nearer bindings win per key. */
function merge(bindings: readonly Partial<OpenAiCodex.Options>[]): OpenAiCodex.Options {
  const merged: OpenAiCodex.Options = {};
  for (let i = bindings.length - 1; i >= 0; i -= 1) Object.assign(merged, bindings[i]);
  return merged;
}

/** Read the `Codex` constructor's own keys off merged options; only present keys are copied. */
function readCodexOptions(options: OpenAiCodex.Options): CodexOptions {
  const read: CodexOptions = {};
  if (options.codexPathOverride !== undefined) read.codexPathOverride = options.codexPathOverride;
  if (options.baseUrl !== undefined) read.baseUrl = options.baseUrl;
  if (options.apiKey !== undefined) read.apiKey = options.apiKey;
  if (options.config !== undefined) read.config = options.config;
  if (options.configOverrides !== undefined) read.configOverrides = options.configOverrides;
  if (options.env !== undefined) read.env = options.env;
  return read;
}

/** Read the thread's own keys off merged options; only present keys are copied. */
function readThreadOptions(options: OpenAiCodex.Options): ThreadOptions {
  const read: ThreadOptions = {};
  readThreadModel(options, read);
  readThreadPolicy(options, read);
  return read;
}

/** Copy the thread's model and directory keys; only present keys are copied. */
function readThreadModel(options: OpenAiCodex.Options, read: ThreadOptions): void {
  if (options.model !== undefined) read.model = options.model;
  if (options.threadSource !== undefined) read.threadSource = options.threadSource;
  if (options.sandboxMode !== undefined) read.sandboxMode = options.sandboxMode;
  if (options.workingDirectory !== undefined) read.workingDirectory = options.workingDirectory;
  if (options.skipGitRepoCheck !== undefined) read.skipGitRepoCheck = options.skipGitRepoCheck;
  if (options.modelReasoningEffort !== undefined)
    read.modelReasoningEffort = options.modelReasoningEffort;
}

/** Copy the thread's access keys; only present keys are copied. */
function readThreadPolicy(options: OpenAiCodex.Options, read: ThreadOptions): void {
  if (options.networkAccessEnabled !== undefined)
    read.networkAccessEnabled = options.networkAccessEnabled;
  if (options.webSearchMode !== undefined) read.webSearchMode = options.webSearchMode;
  if (options.webSearchEnabled !== undefined) read.webSearchEnabled = options.webSearchEnabled;
  if (options.approvalPolicy !== undefined) read.approvalPolicy = options.approvalPolicy;
  if (options.additionalDirectories !== undefined)
    read.additionalDirectories = options.additionalDirectories;
}

/** The Codex adapter resource: awaits the lazy module, then opens threads on it. */
const adapterResource: Resource.Handle<
  Promise<
    Harness.Backend<OpenAiCodex.Options, OpenAiCodex.Turn, OpenAiCodex.Result, OpenAiCodex.Calls>
  >
> = resource({
  label: "codex",
  target: "scope",
  depends: { sdk },
  factory: async ({ sdk: module }) => {
    const start: Harness.Backend<
      OpenAiCodex.Options,
      OpenAiCodex.Turn,
      OpenAiCodex.Result,
      OpenAiCodex.Calls
    >["start"] = (opened, hooks) => startCodex(module, opened, hooks);
    return { start };
  },
});

/** The Codex adapter: options are the SDK's own `CodexOptions & ThreadOptions`, turns carry
 * the SDK's input plus its per-turn output schema, results are the SDK's turns. Continuity is
 * by thread id: `start` resumes `hooks.resume` when the session bound one, so one thread is
 * one conversation. */
export const codex: OpenAiCodex.Adapter = {
  label: "codex",
  sdk,
  options,
  merge,
  resource: adapterResource,
};

/** One turn's running fold: items pushed on `item.completed`, the final text and usage read
 * off their events, a `turn.failed` error kept for the throw after the stream ends. */
type Fold = {
  items: ThreadItem[];
  finalResponse: string;
  usage: Usage | null;
  failure?: { readonly message: string };
  agentText: string;
};

/** Start a Codex thread on merged options and hooks: each `run` streams one turn's events to
 * `mapCodexEvent` and resolves with the SDK's own turn shape. The thread stops when its own
 * aborter fires — wired to the session's signal BEFORE the turn starts, since a defer runs
 * after the turn settled. */
function startCodex(
  sdk: OpenAiCodex.Sdk,
  options: OpenAiCodex.Options,
  hooks: Harness.Hooks,
): Harness.Thread<OpenAiCodex.Turn, OpenAiCodex.Result, OpenAiCodex.Calls> {
  const aborter = new AbortController();
  if (hooks.signal.aborted) aborter.abort(hooks.signal.reason);
  else
    hooks.signal.addEventListener("abort", () => aborter.abort(hooks.signal.reason), {
      once: true,
    });
  const client = new sdk.Codex(readCodexOptions(options));
  const threadOptions = readThreadOptions(options);
  const thread =
    hooks.resume === undefined
      ? client.startThread(threadOptions)
      : client.resumeThread(hooks.resume, threadOptions);
  return {
    run: async (turn) => {
      const { events } = await thread.runStreamed(turn.input, {
        outputSchema: turn.outputSchema,
        signal: aborter.signal,
      });
      if (hooks.signal.aborted) throw hooks.signal.reason;
      const fold: Fold = { items: [], finalResponse: "", usage: null, agentText: "" };
      for await (const event of events) {
        const done = mapCodexEvent(event, hooks, fold);
        if (done) break;
      }
      if (fold.failure !== undefined)
        raise("TurnFailed", { harness: "codex", message: fold.failure.message });
      if (fold.usage === null) {
        if (hooks.signal.aborted) throw hooks.signal.reason;
        raise("TurnEnded", { harness: "codex" });
      }
      return { items: fold.items, finalResponse: fold.finalResponse, usage: fold.usage };
    },
    close: () => {
      aborter.abort();
    },
  };
}

/** Map one SDK event onto hook calls; returns true when the turn is over. Pure — proven
 * through the seam with recorded fixtures. Emits every event raw, sets the id off
 * `thread.started`, records items with the item's own status (or the event phase), streams
 * the agent text growth as deltas (Codex reports the whole text so far, not deltas), and
 * reads usage off `turn.completed`. */
function mapCodexEvent(event: ThreadEvent, hooks: Harness.Hooks, fold: Fold): boolean {
  hooks.emit(event);
  if (event.type === "thread.started") {
    hooks.id(event.thread_id);
    return false;
  }
  if (
    event.type === "item.started" ||
    event.type === "item.updated" ||
    event.type === "item.completed"
  ) {
    readThreadItem(event, hooks, fold);
    return false;
  }
  if (event.type === "turn.completed") {
    hooks.usage({
      input: event.usage.input_tokens,
      cached: event.usage.cached_input_tokens,
      output: event.usage.output_tokens,
    });
    fold.usage = event.usage;
    return true;
  }
  if (event.type === "turn.failed") {
    fold.failure = event.error;
    return true;
  }
  return false;
}

/** Record one item event: the cell entry carries the raw event as its source, the agent text
 * growth streams as a delta (Codex reports the whole text so far, not deltas), and on
 * completion the fold keeps the item and the final text. */
function readThreadItem(
  event: ItemStartedEvent | ItemUpdatedEvent | ItemCompletedEvent,
  hooks: Harness.Hooks,
  fold: Fold,
): void {
  const item = event.item;
  hooks.item({
    kind: item.type,
    id: item.id,
    status: readItemStatus(item, event.type),
    source: event,
  });
  if (item.type === "agent_message" && event.type !== "item.started") {
    const delta = item.text.startsWith(fold.agentText)
      ? item.text.slice(fold.agentText.length)
      : item.text;
    if (delta !== "") hooks.text(delta);
    fold.agentText = item.text;
  }
  if (event.type === "item.completed") {
    fold.items.push(item);
    if (item.type === "agent_message") fold.finalResponse = item.text;
  }
}

/** The status one item records: the item's own status when it carries one, else the event phase. */
function readItemStatus(
  item: ThreadItem,
  phase: "item.started" | "item.updated" | "item.completed",
): string {
  if (
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "mcp_tool_call"
  )
    return item.status;
  if (phase === "item.started") return "started";
  if (phase === "item.updated") return "updated";
  return "completed";
}
