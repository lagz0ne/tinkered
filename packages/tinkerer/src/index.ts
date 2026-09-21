import { data, isError as isCoreError, operation, readMany, tag } from "@tinker/core";
import type { Data, Many, Operation, Scope, Tag } from "@tinker/core";
import { httpClient, HttpRequest } from "@tinker/http";
import type { HttpResponse } from "@tinker/http";
import { z } from "zod";
import { isError, raise } from "./errors.ts";
import type { Errors } from "./errors.ts";
import { cwd, read, readDescription, readInput } from "./tools/read.ts";

export { cwd, read };

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
      readonly delta?: {
        readonly content?: string | null;
        readonly tool_calls?: readonly {
          readonly index: number;
          readonly id?: string;
          readonly type?: string;
          readonly function?: { readonly name?: string; readonly arguments?: string };
        }[];
      };
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
  /** The least mode a tool call needs: read-only < workspace-write < full-access. */
  export type Mode = "read-only" | "workspace-write" | "full-access";
  /** One wiring row: the operation plus its tool facts. The wire name is
   * `meta.name ?? op.label`; `sequential` runs a reply's calls one at a time. */
  export type Tool = {
    readonly op: Operation.Handle<unknown, unknown>;
    readonly meta: {
      readonly description: string;
      readonly schema: { readonly [key: string]: z.ZodType };
      readonly name?: string;
      readonly mode?: Mode;
      readonly sequential?: boolean;
    };
  };
  /** The live per-call values: our mode plus the provider's own request fields.
   * Seeded from the tags at turn start, read at every step and every tool call. */
  export type Settings = {
    readonly mode: Mode;
    readonly options: {
      readonly model: string;
      readonly reasoning_effort?: "low" | "medium" | "high";
      readonly max_completion_tokens?: number;
    };
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
    readonly mode: Tag.Handle<Mode>;
    readonly settings: Data.Cell<Settings | undefined>;
    readonly tools: readonly Tool[];
  };
}

/** Name one tool row: the operation plus its tool facts. */
export function tool(
  op: Operation.Handle<unknown, unknown>,
  meta: Tinkerer.Tool["meta"],
): Tinkerer.Tool {
  return { op, meta };
}

/** The shipped `read` tool as a row, ready to pass: `tinkerer({ label, tools: [readTool] })`. */
export const readTool: Tinkerer.Tool = tool(read, {
  description: readDescription,
  schema: readInput,
  mode: "read-only",
});

export function tinkerer(config: { label: string; tools?: Many<Tinkerer.Tool> }): Tinkerer.Frame {
  const { label } = config;
  const rows = readMany(config.tools);
  checkDuplicateTools(label, rows);
  const configTag = tag<Partial<Tinkerer.Config>>({ label: `${label}.config` });
  const mode = tag<Tinkerer.Mode>({ label: `${label}.mode` });
  const messages = data<readonly Tinkerer.Message[]>({ label: `${label}.messages`, initial: [] });
  const status = data<Tinkerer.Status>({ label: `${label}.status`, initial: "idle" });
  const text = data<string>({ label: `${label}.text`, initial: "" });
  const usage = data<Tinkerer.Usage>({
    label: `${label}.usage`,
    initial: { input: 0, cached: 0, output: 0 },
  });
  const settings = data<Tinkerer.Settings | undefined>({
    label: `${label}.settings`,
    initial: undefined,
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
  const toolDeps = Object.fromEntries(rows.map((row) => [`tool:${rowName(row)}`, row.op]));
  const turn = operation({
    label: `${label}.turn`,
    input: readPrompt(label),
    depends: {
      configs: configTag.all,
      mode: mode.optional,
      step,
      messages: messages.controller,
      status: status.controller,
      text: text.controller,
      usage: usage.controller,
      settings: settings.controller,
      ...toolDeps,
    },
    run: async (deps, ctx) => {
      const prompt = ctx.input;
      const merged = mergeConfigs(deps.configs);
      const seen = readRequired(merged, label);
      seedSystem(deps.messages, seen.system);
      seedSettings(deps.settings, deps.mode, seen);
      try {
        openTurn(deps, prompt);
        for (;;) {
          deps.text.set("");
          const current = readSettings(deps.settings, label);
          const events = await deps.step.run({
            input: {
              url: `${seen.baseUrl}/chat/completions`,
              headers: { "content-type": "application/json", ...merged.headers },
              body: stepBody(current, deps.messages.get(), rows),
            },
          });
          const folded = await foldStep(events, deps);
          pushAssistant(deps.messages, deps.text.get(), folded.calls);
          if (folded.calls.length === 0) {
            if (folded.finish === undefined) raise("StreamEnded", { label });
            return closeTurn(deps, ctx, prompt, folded.finish);
          }
          await runCalls(deps, ctx, rows, folded.calls, folded.finish);
        }
      } catch (error) {
        if (!ctx.signal.aborted) deps.status.set("failed");
        throw error;
      }
    },
  });
  return {
    label,
    config: configTag,
    messages,
    status,
    text,
    usage,
    step,
    turn,
    mode,
    settings,
    tools: rows,
  };
}

function rowName(row: Tinkerer.Tool): string {
  return row.meta.name ?? row.op.label;
}

function checkDuplicateTools(label: string, rows: readonly Tinkerer.Tool[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const name = rowName(row);
    if (seen.has(name)) raise("DuplicateTool", { label, name });
    seen.add(name);
  }
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

function seedSettings(
  settings: Scope.DataController<Tinkerer.Settings | undefined>,
  mode: Tag.Presence<Tinkerer.Mode>,
  seen: RequiredConfig,
): void {
  const options: {
    model: string;
    reasoning_effort?: "low" | "medium" | "high";
    max_completion_tokens?: number;
  } = { model: seen.model };
  if (seen.reasoning_effort !== undefined) options.reasoning_effort = seen.reasoning_effort;
  if (seen.max_completion_tokens !== undefined)
    options.max_completion_tokens = seen.max_completion_tokens;
  settings.set({ mode: mode.present ? mode.value : "read-only", options });
}

function readSettings(
  settings: Scope.DataController<Tinkerer.Settings | undefined>,
  label: string,
): Tinkerer.Settings {
  const current = settings.get();
  if (current === undefined) raise("MissingConfig", { label, key: "settings" });
  return current;
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
  settings: Tinkerer.Settings,
  transcript: readonly Tinkerer.Message[],
  rows: readonly Tinkerer.Tool[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.options.model,
    messages: transcript,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (settings.options.reasoning_effort !== undefined)
    body.reasoning_effort = settings.options.reasoning_effort;
  if (settings.options.max_completion_tokens !== undefined)
    body.max_completion_tokens = settings.options.max_completion_tokens;
  if (rows.length > 0)
    body.tools = rows.map((row) => ({
      type: "function",
      function: {
        name: rowName(row),
        description: row.meta.description,
        parameters: toolParameters(row.meta.schema),
      },
    }));
  return body;
}

function toolParameters(schema: Tinkerer.Tool["meta"]["schema"]): Record<string, unknown> {
  const { $schema: _omit, ...parameters } = z.toJSONSchema(z.object(schema));
  return parameters;
}

type AccruedCall = { readonly id: string; readonly name: string; readonly args: string };

type FoldedStep = { readonly finish: string | undefined; readonly calls: readonly AccruedCall[] };

async function foldStep(
  events: AsyncIterable<HttpResponse.SseEvent>,
  deps: Pick<TurnCells, "text" | "usage">,
): Promise<FoldedStep> {
  const parts = new Map<number, { id: string; name: string; args: string }>();
  let finish: string | undefined;
  for await (const event of events) {
    if (event.data === "[DONE]") continue;
    finish = foldChunk(JSON.parse(event.data) as Tinkerer.Chunk, deps, parts, finish);
  }
  return { finish, calls: [...parts.values()] };
}

function foldChunk(
  chunk: Tinkerer.Chunk,
  deps: Pick<TurnCells, "text" | "usage">,
  parts: Map<number, { id: string; name: string; args: string }>,
  finish: string | undefined,
): string | undefined {
  const head = chunk.choices?.[0];
  appendDelta(deps.text, head?.delta?.content);
  for (const entry of head?.delta?.tool_calls ?? []) accrueCall(parts, entry);
  recordUsage(deps.usage, chunk.usage);
  const reason = head?.finish_reason;
  return typeof reason === "string" ? reason : finish;
}

function accrueCall(
  parts: Map<number, { id: string; name: string; args: string }>,
  entry: NonNullable<
    NonNullable<NonNullable<Tinkerer.Chunk["choices"]>[number]["delta"]>["tool_calls"]
  >[number],
): void {
  const piece = entry.function?.arguments ?? "";
  const seen = parts.get(entry.index);
  if (seen === undefined) {
    parts.set(entry.index, {
      id: entry.id ?? "",
      name: entry.function?.name ?? "",
      args: piece,
    });
    return;
  }
  parts.set(entry.index, {
    id: entry.id ?? seen.id,
    name: entry.function?.name ?? seen.name,
    args: seen.args + piece,
  });
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

function pushAssistant(
  messages: Scope.DataController<readonly Tinkerer.Message[]>,
  text: string,
  calls: readonly AccruedCall[],
): void {
  const answered: Tinkerer.Message =
    calls.length === 0
      ? { role: "assistant", content: text }
      : {
          role: "assistant",
          content: text.length > 0 ? text : null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.args },
          })),
        };
  messages.update((list) => [...list, answered]);
}

const modeRank: Record<Tinkerer.Mode, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "full-access": 2,
};

type CallDeps = {
  readonly settings: Scope.DataController<Tinkerer.Settings | undefined>;
  readonly messages: Scope.DataController<readonly Tinkerer.Message[]>;
};

async function runCalls(
  deps: CallDeps & Record<string, Scope.OperationController<unknown, unknown>>,
  ctx: Operation.Ctx<string>,
  rows: readonly Tinkerer.Tool[],
  calls: readonly AccruedCall[],
  finish: string | undefined,
): Promise<void> {
  const byName = new Map(rows.map((row) => [rowName(row), row]));
  const runOne = (call: AccruedCall): Promise<string> =>
    settleCall(deps, ctx, byName.get(call.name), call, finish);
  const sequential = calls.some((call) => byName.get(call.name)?.meta.sequential === true);
  const results = sequential
    ? await runInOrder(calls, runOne)
    : await Promise.all(calls.map(runOne));
  calls.forEach((call, index) => pushToolResult(deps.messages, call, results[index] ?? ""));
}

async function runInOrder(
  calls: readonly AccruedCall[],
  runOne: (call: AccruedCall) => Promise<string>,
): Promise<string[]> {
  const out: string[] = [];
  for (const call of calls) out.push(await runOne(call));
  return out;
}

function settleCall(
  deps: CallDeps & Record<string, Scope.OperationController<unknown, unknown>>,
  ctx: Operation.Ctx<string>,
  row: Tinkerer.Tool | undefined,
  call: AccruedCall,
  finish: string | undefined,
): Promise<string> {
  if (finish === "length") return Promise.resolve(logTool(ctx, call, false, lengthResult(call)));
  if (row === undefined)
    return Promise.resolve(logTool(ctx, call, false, `Tool ${call.name} not found`));
  let raw: unknown;
  try {
    raw = JSON.parse(call.args) as unknown;
  } catch (error) {
    return Promise.resolve(
      logTool(ctx, call, false, `Tool ${call.name}: arguments are not JSON: ${readMessage(error)}`),
    );
  }
  const needed = row.meta.mode ?? "read-only";
  const current = readMode(deps.settings);
  if (modeRank[current] < modeRank[needed])
    return Promise.resolve(
      logTool(
        ctx,
        call,
        false,
        `Tool ${call.name} is blocked: mode is ${current}, it needs ${needed}`,
      ),
    );
  return runRow(deps, ctx, row, call, raw);
}

async function runRow(
  deps: CallDeps & Record<string, Scope.OperationController<unknown, unknown>>,
  ctx: Operation.Ctx<string>,
  row: Tinkerer.Tool,
  call: AccruedCall,
  raw: unknown,
): Promise<string> {
  try {
    const value = await deps[`tool:${rowName(row)}`].run({ rawInput: raw });
    return logTool(ctx, call, true, readValue(value));
  } catch (error) {
    return logTool(ctx, call, false, `Tool ${call.name} failed: ${readFailure(error)}`);
  }
}

function lengthResult(call: AccruedCall): string {
  return (
    `Tool call "${call.name}" was not executed: the reply hit the token limit, ` +
    `so its arguments may be cut. Re-issue the call with complete arguments.`
  );
}

function readMode(settings: Scope.DataController<Tinkerer.Settings | undefined>): Tinkerer.Mode {
  const current = settings.get();
  if (current === undefined) return "read-only";
  return current.mode;
}

function readMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFailure(error: unknown): string {
  if (isCoreError(error, "DataValidationFailed") && error.payload.cause instanceof Error)
    return error.payload.cause.message;
  return readMessage(error);
}

function readValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function logTool(
  ctx: Operation.Ctx<string>,
  call: AccruedCall,
  ok: boolean,
  content: string,
): string {
  ctx.log("tinkerer tool", { name: call.name, ok });
  return content;
}

function pushToolResult(
  messages: Scope.DataController<readonly Tinkerer.Message[]>,
  call: AccruedCall,
  content: string,
): void {
  const answered: Tinkerer.Message = { role: "tool", tool_call_id: call.id, content };
  messages.update((list) => [...list, answered]);
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
