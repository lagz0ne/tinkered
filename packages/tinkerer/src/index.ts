import { data, operation, tag } from "@tinker/core";
import type { Data, Operation, Scope, Tag } from "@tinker/core";
import { httpClient, HttpRequest } from "@tinker/http";
import type { HttpResponse } from "@tinker/http";
import { isError, raise } from "./errors.ts";
import type { Errors } from "./errors.ts";

export declare namespace Tinkerer {
  /** The provider's own request fields plus our two: baseUrl (e.g. "https://api.meta.ai/v1")
   * and headers (authorization goes here) reach the step; system seeds the transcript. */
  export type Config = {
    readonly model: string;
    readonly baseUrl: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly system?: string;
    readonly reasoning_effort?: "low" | "medium" | "high";
    readonly max_completion_tokens?: number;
  };
  /** Chat-completions message objects, the wire shape, as sent and received. */
  export type Message =
    | { readonly role: "system"; readonly content: string }
    | { readonly role: "user"; readonly content: string }
    | {
        readonly role: "assistant";
        readonly content: string | null;
        readonly tool_calls?: readonly ToolCall[];
      }
    | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };
  export type ToolCall = {
    readonly id: string;
    readonly type: "function";
    readonly function: { readonly name: string; readonly arguments: string };
  };
  export type Status = "idle" | "running" | "done" | "failed";
  export type Usage = { readonly input: number; readonly cached: number; readonly output: number };
  /** What one step sends: the URL, headers, and the request body as the provider takes it. */
  export type StepInput = {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Record<string, unknown>;
  };
  /** One streamed chunk, as far as the loop reads it. */
  export type Chunk = {
    readonly choices?: readonly {
      readonly delta?: { readonly content?: string | null };
      readonly finish_reason?: string | null;
    }[];
    readonly usage?: {
      readonly prompt_tokens: number;
      readonly completion_tokens: number;
      readonly prompt_tokens_details?: { readonly cached_tokens?: number };
    };
  };
  /** What a turn delivers: the final assistant message and the turn's usage. */
  export type Reply = {
    readonly message: Extract<Message, { role: "assistant" }>;
    readonly usage: Usage;
    readonly finish: string;
  };
  export type Frame = {
    readonly label: string;
    readonly config: Tag.Handle<Partial<Config>>;
    readonly messages: Data.Cell<readonly Message[]>;
    readonly status: Data.Cell<Status>;
    readonly text: Data.Cell<string>;
    readonly usage: Data.Cell<Usage>;
    readonly step: Operation.Handle<Promise<AsyncIterable<HttpResponse.SseEvent>>, StepInput>;
    readonly turn: Operation.Handle<Promise<Reply>, string>;
  };
}

export function tinkerer(config: { label: string }): Tinkerer.Frame {
  const { label } = config;
  const configTag = tag<Partial<Tinkerer.Config>>({ label: `${label}.config` });
  const messages = data<readonly Tinkerer.Message[]>({ label: `${label}.messages`, initial: [] });
  const status = data<Tinkerer.Status>({ label: `${label}.status`, initial: "idle" });
  const text = data<string>({ label: `${label}.text`, initial: "" });
  const usage = data<Tinkerer.Usage>({
    label: `${label}.usage`,
    initial: { input: 0, cached: 0, output: 0 },
  });
  const http = httpClient({ label: `${label}.http` });
  const step = http.operation({
    label: "step",
    request: (input: Tinkerer.StepInput) =>
      HttpRequest.post(input.url, {
        headers: input.headers,
        body: HttpRequest.bodyJson(input.body),
      }),
    response: (res) => res.sse(),
  });
  const turn = operation({
    label: `${label}.turn`,
    input: readPrompt(label),
    depends: {
      configs: configTag.all,
      step,
      messages: messages.controller,
      status: status.controller,
      text: text.controller,
      usage: usage.controller,
    },
    run: async (deps, ctx) => {
      const prompt = ctx.input;
      const merged = mergeConfigs(deps.configs);
      const seen = readRequired(merged, label);
      seedSystem(deps.messages, seen.system);
      try {
        openTurn(deps, prompt);
        const body = stepBody(seen, deps.messages.get());
        const events = await deps.step.run({
          input: {
            url: `${seen.baseUrl}/chat/completions`,
            headers: { "content-type": "application/json", ...merged.headers },
            body,
          },
        });
        const folded = await foldStream(events, deps);
        if (folded.finish === undefined) raise("StreamEnded", { label });
        return closeTurn(deps, ctx, prompt, folded.finish);
      } catch (error) {
        if (!ctx.signal.aborted) deps.status.set("failed");
        throw error;
      }
    },
  });
  return { label, config: configTag, messages, status, text, usage, step, turn };
}

function readPrompt(label: string): (raw: unknown) => string {
  return (raw: unknown) => {
    if (typeof raw !== "string" || raw.length === 0) raise("EmptyPrompt", { label });
    return raw;
  };
}

type MergedConfig = {
  model?: string;
  baseUrl?: string;
  system?: string;
  reasoning_effort?: "low" | "medium" | "high";
  max_completion_tokens?: number;
  headers: Record<string, string>;
};

function mergeConfigs(all: readonly Partial<Tinkerer.Config>[]): MergedConfig {
  const merged: MergedConfig = { headers: {} };
  for (const binding of all) takeBinding(merged, binding);
  return merged;
}

function takeBinding(merged: MergedConfig, binding: Partial<Tinkerer.Config>): void {
  if (merged.model === undefined) merged.model = binding.model;
  if (merged.baseUrl === undefined) merged.baseUrl = binding.baseUrl;
  if (merged.system === undefined) merged.system = binding.system;
  if (merged.reasoning_effort === undefined) merged.reasoning_effort = binding.reasoning_effort;
  if (merged.max_completion_tokens === undefined)
    merged.max_completion_tokens = binding.max_completion_tokens;
  mergeHeaders(merged.headers, binding.headers);
}

function mergeHeaders(
  into: Record<string, string>,
  headers: Partial<Tinkerer.Config>["headers"],
): void {
  if (headers === undefined) return;
  for (const key of Object.keys(headers)) {
    if (into[key] === undefined) into[key] = headers[key];
  }
}

type RequiredConfig = { model: string; baseUrl: string; system?: string } & Pick<
  MergedConfig,
  "reasoning_effort" | "max_completion_tokens"
>;

function readRequired(merged: MergedConfig, label: string): RequiredConfig {
  const model = merged.model;
  if (model === undefined) raise("MissingConfig", { label, key: "model" });
  const baseUrl = merged.baseUrl;
  if (baseUrl === undefined) raise("MissingConfig", { label, key: "baseUrl" });
  return {
    model,
    baseUrl,
    system: merged.system,
    reasoning_effort: merged.reasoning_effort,
    max_completion_tokens: merged.max_completion_tokens,
  };
}

function seedSystem(
  messages: Scope.DataController<readonly Tinkerer.Message[]>,
  system: string | undefined,
): void {
  if (messages.get().length > 0 || system === undefined) return;
  const seed: Tinkerer.Message = { role: "system", content: system };
  messages.update((list) => [...list, seed]);
}

type TurnCells = {
  readonly messages: Scope.DataController<readonly Tinkerer.Message[]>;
  readonly status: Scope.DataController<Tinkerer.Status>;
  readonly text: Scope.DataController<string>;
  readonly usage: Scope.DataController<Tinkerer.Usage>;
};

function openTurn(deps: TurnCells, prompt: string): void {
  const asked: Tinkerer.Message = { role: "user", content: prompt };
  deps.messages.update((list) => [...list, asked]);
  deps.status.set("running");
  deps.text.set("");
}

function stepBody(
  seen: RequiredConfig,
  transcript: readonly Tinkerer.Message[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: seen.model,
    messages: transcript,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (seen.reasoning_effort !== undefined) body.reasoning_effort = seen.reasoning_effort;
  if (seen.max_completion_tokens !== undefined)
    body.max_completion_tokens = seen.max_completion_tokens;
  return body;
}

type Folded = { finish: string | undefined };

async function foldStream(
  events: AsyncIterable<HttpResponse.SseEvent>,
  deps: Pick<TurnCells, "text" | "usage">,
): Promise<Folded> {
  let finish: string | undefined;
  for await (const event of events) {
    if (event.data === "[DONE]") continue;
    finish = foldChunk(JSON.parse(event.data) as Tinkerer.Chunk, deps, finish);
  }
  return { finish };
}

function foldChunk(
  chunk: Tinkerer.Chunk,
  deps: Pick<TurnCells, "text" | "usage">,
  finish: string | undefined,
): string | undefined {
  const head = chunk.choices?.[0];
  appendDelta(deps.text, head?.delta?.content);
  recordUsage(deps.usage, chunk.usage);
  const reason = head?.finish_reason;
  return typeof reason === "string" ? reason : finish;
}

function appendDelta(text: Scope.DataController<string>, content: string | null | undefined): void {
  if (typeof content === "string") text.update((current) => current + content);
}

function recordUsage(
  usage: Scope.DataController<Tinkerer.Usage>,
  metered: Tinkerer.Chunk["usage"],
): void {
  if (metered === undefined) return;
  usage.set({
    input: metered.prompt_tokens,
    cached: metered.prompt_tokens_details?.cached_tokens ?? 0,
    output: metered.completion_tokens,
  });
}

function closeTurn(
  deps: TurnCells,
  ctx: Operation.Ctx<string>,
  prompt: string,
  finish: string,
): Tinkerer.Reply {
  const answered: Extract<Tinkerer.Message, { role: "assistant" }> = {
    role: "assistant",
    content: deps.text.get(),
  };
  deps.messages.update((list) => [...list, answered]);
  deps.status.set("done");
  const done = deps.usage.get();
  ctx.log("tinkerer turn", { finish, input: prompt, output: done.output });
  return { message: answered, usage: done, finish };
}

export { isError };
export type { Errors };
