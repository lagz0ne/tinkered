import { data, isError as isCoreError, operation, readMany, tag } from "@tinker/core";
import type { Data, Many, Operation, Scope, Tag } from "@tinker/core";
import { HttpRequest, send } from "@tinker/http";
import type { HttpResponse } from "@tinker/http";
import { z } from "zod";
import { isError, raise } from "./errors.ts";
import type { Errors } from "./errors.ts";
import { bash, bashDescription, bashInput } from "./tools/bash.ts";
import { edit, editDescription, editInput } from "./tools/edit.ts";
import { cwd, read, readDescription, readInput } from "./tools/read.ts";
import { write, writeDescription, writeInput } from "./tools/write.ts";

export { bash, cwd, edit, read, write };
export { persist, restore } from "./persist.ts";

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
  /** One streamed piece of a tool call: the first piece for an `index` carries `id` and the
   * name, later pieces only more of `function.arguments`. */
  export type ToolCallDelta = {
    readonly index: number;
    readonly id?: string;
    readonly type?: string;
    readonly function?: { readonly name?: string; readonly arguments?: string };
  };
  /** One streamed chunk, as far as the loop reads it. */
  export type Chunk = {
    readonly choices?: readonly {
      readonly delta?: {
        readonly content?: string | null;
        readonly tool_calls?: readonly ToolCallDelta[];
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
  /** A gate's answer: allow the tool call, or block it with a reason the model sees. */
  export type Decision =
    | { readonly allow: true }
    | { readonly allow: false; readonly reason: string };
  /** What a gate decides about: the tool's wire name, its parsed arguments, the current mode, and
   * the raw wire call. A gate is an ordinary operation, so it may read cells, ask a human through a
   * driver, or apply a policy — the frame only runs it and reads its `Decision` (ADR 0053). */
  export type GateRequest = {
    readonly name: string;
    readonly args: unknown;
    readonly mode: Mode;
    readonly call: ToolCall;
  };
  /** The gate slot: an operation from a request to a decision. */
  export type Gate = Operation.Handle<Decision | Promise<Decision>, GateRequest>;
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
  /** What a step's model/options come from: the provider fields on `settings.options`. */
  export type Options = Settings["options"];
  /** One pending user entry. `queue` waits until the model would stop; `steer` interrupts the
   * step in flight. `mode` and `options` patch `settings` when the entry is consumed. */
  export type Entry = {
    readonly kind: "queue" | "steer";
    readonly content: string;
    readonly mode?: Mode;
    readonly options?: Partial<Options>;
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
    readonly inbox: Data.Cell<readonly Entry[]>;
    readonly tools: readonly Tool[];
  };
}

/** The empty inbox: one frozen array shared as the initial value. */
const noEntries: readonly Tinkerer.Entry[] = Object.freeze([]);

/** A steer entry: interrupts the step in flight, delivered before the next step. */
export function steer(
  content: string,
  patch?: Omit<Tinkerer.Entry, "kind" | "content">,
): Tinkerer.Entry {
  return { kind: "steer", content, ...patch };
}

/** A queue entry: waits until the model would stop, then continues the turn. */
export function queue(
  content: string,
  patch?: Omit<Tinkerer.Entry, "kind" | "content">,
): Tinkerer.Entry {
  return { kind: "queue", content, ...patch };
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

/** The shipped `edit` tool as a row: needs `workspace-write`. */
export const editTool: Tinkerer.Tool = tool(edit, {
  description: editDescription,
  schema: editInput,
  mode: "workspace-write",
});

/** The shipped `write` tool as a row: needs `workspace-write`. */
export const writeTool: Tinkerer.Tool = tool(write, {
  description: writeDescription,
  schema: writeInput,
  mode: "workspace-write",
});

/** The shipped `bash` tool as a row: needs `full-access`. */
export const bashTool: Tinkerer.Tool = tool(bash, {
  description: bashDescription,
  schema: bashInput,
  mode: "full-access",
});

/** The four shipped rows, pi's set: `tinkerer({ label, tools: shippedTools })`. */
export const shippedTools: readonly Tinkerer.Tool[] = [readTool, editTool, writeTool, bashTool];

/** Declare one graph for a set of tools and a gate. Use namespaces for parallel coders. */
export function tinkerer(
  config: {
    label?: string;
    tools?: Many<Tinkerer.Tool>;
    gate?: Tinkerer.Gate;
  } = {},
): Tinkerer.Frame {
  const label = config.label ?? "tinkerer";
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
  const inbox = data<readonly Tinkerer.Entry[]>({ label: `${label}.inbox`, initial: noEntries });
  const step: Tinkerer.Frame["step"] = operation({
    label: `${label}.http.step`,
    depends: { send },
    run: async ({ send: sendIt }, ctx: Operation.Ctx<Tinkerer.StepInput>) => {
      const res = await sendIt.run({
        input: HttpRequest.post(ctx.input.url, {
          headers: ctx.input.headers,
          body: HttpRequest.bodyJson(ctx.input.body),
        }),
      });
      return res.sse();
    },
  });
  const toolDeps = readToolDeps(rows);
  const gateDeps: { gate?: Tinkerer.Gate } = config.gate === undefined ? {} : { gate: config.gate };
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
      inbox: inbox.controller,
      ...toolDeps,
      ...gateDeps,
    },
    run: async (deps, ctx) => {
      const prompt = ctx.input;
      const merged = mergeConfigs(deps.configs);
      const seen = readRequired(merged, label);
      seedSystem(deps.messages, seen.system);
      seedSettings(deps.settings, deps.mode, seen);
      try {
        openTurn(deps, prompt);
        return await runLoop(deps, ctx, { label, seen, merged, rows });
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
    inbox,
    tools: rows,
  };
}

/** The `depends` slots of the frame's tools, one per row under `tool:<name>`, spread into the
 * turn's own `depends` so each tool op is a subflow of the turn. */
type ToolDeps = Record<`tool:${string}`, Operation.Handle<unknown, unknown>>;

/** The controllers those slots deliver, read back by the same keys. */
type ToolSlots = Record<`tool:${string}`, Scope.OperationController<unknown, unknown>>;

function readToolDeps(rows: readonly Tinkerer.Tool[]): ToolDeps {
  const deps: ToolDeps = {};
  for (const row of rows) deps[`tool:${rowName(row)}`] = row.op;
  return deps;
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

/** A steered fold drops the calls it accrued: the loop re-enters before it reads them, so only
 * the unsteered branch carries them. */
type FoldedStep =
  | { readonly finish: string | undefined; readonly steered: true }
  | {
      readonly finish: string | undefined;
      readonly calls: readonly AccruedCall[];
      readonly steered: false;
    };

async function foldStep(
  events: AsyncIterable<HttpResponse.SseEvent>,
  deps: Pick<TurnCells, "text" | "usage">,
  inbox: Scope.DataController<readonly Tinkerer.Entry[]>,
): Promise<FoldedStep> {
  const parts = new Map<number, { id: string; name: string; args: string }>();
  let finish: string | undefined;
  for await (const event of events) {
    if (event.data !== "[DONE]")
      finish = foldChunk(JSON.parse(event.data) as Tinkerer.Chunk, deps, parts, finish);
    if (steerPending(inbox)) return { finish, steered: true };
  }
  return { finish, calls: [...parts.values()], steered: false };
}

/** Whether the inbox holds a steer entry: read between stream events, so leaving the loop (and
 * its `return`, which cancels the stream) always happens with the generator suspended at a yield,
 * never mid-read. */
function steerPending(inbox: Scope.DataController<readonly Tinkerer.Entry[]>): boolean {
  return inbox.get().some((entry) => entry.kind === "steer");
}

function foldChunk(
  chunk: Tinkerer.Chunk,
  deps: Pick<TurnCells, "text" | "usage">,
  parts: Map<number, { id: string; name: string; args: string }>,
  finish: string | undefined,
): string | undefined {
  const head = chunk.choices?.[0];
  if (head?.delta !== undefined) foldDelta(head.delta, deps.text, parts);
  recordUsage(deps.usage, chunk.usage);
  const reason = head?.finish_reason;
  return typeof reason === "string" ? reason : finish;
}

/** One delta: its text goes to `text`, its tool-call pieces accrue by index. */
function foldDelta(
  delta: NonNullable<NonNullable<Tinkerer.Chunk["choices"]>[number]["delta"]>,
  text: Scope.DataController<string>,
  parts: Map<number, { id: string; name: string; args: string }>,
): void {
  appendDelta(text, delta.content);
  for (const entry of delta.tool_calls ?? []) accrueCall(parts, entry);
}

function accrueCall(
  parts: Map<number, { id: string; name: string; args: string }>,
  entry: Tinkerer.ToolCallDelta,
): void {
  const seen = parts.get(entry.index) ?? { id: "", name: "", args: "" };
  parts.set(entry.index, {
    id: entry.id ?? seen.id,
    name: entry.function?.name ?? seen.name,
    args: seen.args + (entry.function?.arguments ?? ""),
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
): Extract<Tinkerer.Message, { role: "assistant" }> {
  const answered: Extract<Tinkerer.Message, { role: "assistant" }> =
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
  return answered;
}

const modeRank: Record<Tinkerer.Mode, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "full-access": 2,
};

/** The optional gate controller, delivered as a subflow when the frame carries a gate. */
type GateSlot = {
  readonly gate?: Scope.OperationController<
    Tinkerer.Decision | Promise<Tinkerer.Decision>,
    Tinkerer.GateRequest
  >;
};

type CallDeps = {
  readonly settings: Scope.DataController<Tinkerer.Settings | undefined>;
  readonly messages: Scope.DataController<readonly Tinkerer.Message[]>;
};

async function runCalls(
  deps: CallDeps & ToolSlots & GateSlot,
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
  deps: CallDeps & ToolSlots & GateSlot,
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

/** Ask the gate, then run the tool through `settle` (ADR 0067): its value, a managed error, a panic,
 * or a cancel all become the text the model sees. A tool may be sync or async, so its Result is
 * awaited through `Promise.resolve`. */
async function runRow(
  deps: CallDeps & ToolSlots & GateSlot,
  ctx: Operation.Ctx<string>,
  row: Tinkerer.Tool,
  call: AccruedCall,
  raw: unknown,
): Promise<string> {
  const declined = await askGate(deps, ctx, call, raw);
  if (declined !== undefined) return declined;
  const settled = await Promise.resolve(deps[`tool:${rowName(row)}`].settle({ rawInput: raw }));
  if (settled.status === "success") return logTool(ctx, call, true, readValue(settled.value));
  const failure = settled.status === "failed" ? settled.error : settled.reason;
  return logTool(ctx, call, false, `Tool ${call.name} failed: ${readFailure(failure)}`);
}

/** Run the gate (when present) for one call: its `Decision` allows or blocks. A block answers the
 * model with `Tool <name> was declined: <reason>` and the tool never runs; one `tinkerer gate` log
 * line either way. Returns the block result, or `undefined` when there is no gate or it allowed. */
async function askGate(
  deps: CallDeps & GateSlot,
  ctx: Operation.Ctx<string>,
  call: AccruedCall,
  raw: unknown,
): Promise<string | undefined> {
  const gate = deps.gate;
  if (gate === undefined) return undefined;
  const decision = await gate.run({
    input: gateRequest(call, raw, readMode((deps as CallDeps).settings)),
  });
  ctx.log("tinkerer gate", { name: call.name, allow: decision.allow });
  if (decision.allow) return undefined;
  return `Tool ${call.name} was declined: ${decision.reason}`;
}

function gateRequest(call: AccruedCall, raw: unknown, mode: Tinkerer.Mode): Tinkerer.GateRequest {
  return {
    name: call.name,
    args: raw,
    mode,
    call: { id: call.id, type: "function", function: { name: call.name, arguments: call.args } },
  };
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
  message: Extract<Tinkerer.Message, { role: "assistant" }>,
): Tinkerer.Reply {
  deps.status.set("done");
  const done = deps.usage.get();
  ctx.log("tinkerer turn", { finish, input: prompt, output: done.output });
  return { message, usage: done, finish };
}

/** What the loop reads once per turn: the endpoint address and the tool rows. */
type TurnConfig = {
  readonly label: string;
  readonly seen: RequiredConfig;
  readonly merged: MergedConfig;
  readonly rows: readonly Tinkerer.Tool[];
};

/** Everything the loop reads and writes: the ambient cells, the inbox, the step, the tool slots. */
type LoopDeps = TurnCells & {
  readonly settings: Scope.DataController<Tinkerer.Settings | undefined>;
  readonly inbox: Scope.DataController<readonly Tinkerer.Entry[]>;
  readonly step: Scope.OperationController<
    Promise<AsyncIterable<HttpResponse.SseEvent>>,
    Tinkerer.StepInput
  >;
} & ToolSlots;

/** The ReAct loop: step, fold (racing a steer), then tool calls or a stop. A steer interrupts the
 * step and re-enters as a user message; queued entries continue the turn when the model would stop. */
async function runLoop(
  deps: LoopDeps,
  ctx: Operation.Ctx<string>,
  cfg: TurnConfig,
): Promise<Tinkerer.Reply> {
  for (;;) {
    drainInbox(deps, steerOnly);
    deps.text.set("");
    const settings = readSettings(deps.settings, cfg.label);
    const events = await deps.step.run({
      input: readStepInput(cfg, settings, deps.messages.get()),
    });
    const folded = await foldStep(events, deps, deps.inbox);
    if (folded.steered) {
      keepPartial(deps.messages, deps.text.get());
      continue;
    }
    const assistant = pushAssistant(deps.messages, deps.text.get(), folded.calls);
    if (folded.calls.length === 0) {
      if (drainInbox(deps, steerAndQueue)) continue;
      if (folded.finish === undefined)
        ctx.raise("StreamEnded", { label: cfg.label } satisfies Errors.Payload<"StreamEnded">);
      return closeTurn(deps, ctx, cfg.label, folded.finish, assistant);
    }
    await runCalls(deps, ctx, cfg.rows, folded.calls, folded.finish);
  }
}

const steerOnly: ReadonlySet<Tinkerer.Entry["kind"]> = new Set(["steer"]);
const steerAndQueue: ReadonlySet<Tinkerer.Entry["kind"]> = new Set(["steer", "queue"]);

function readStepInput(
  cfg: TurnConfig,
  settings: Tinkerer.Settings,
  transcript: readonly Tinkerer.Message[],
): Tinkerer.StepInput {
  return {
    url: `${cfg.seen.baseUrl}/chat/completions`,
    headers: { "content-type": "application/json", ...cfg.merged.headers },
    body: stepBody(settings, transcript, cfg.rows),
  };
}

/** A steered step keeps its streamed text as an assistant message (partial tool calls dropped);
 * an empty text adds nothing, so an untouched transcript stays clean. */
function keepPartial(
  messages: Scope.DataController<readonly Tinkerer.Message[]>,
  text: string,
): void {
  if (text.length > 0) messages.update((list) => [...list, { role: "assistant", content: text }]);
}

/** Take the inbox entries of the wanted kinds, inject each as a user message, patch settings from
 * each; the remaining kinds stay queued. Returns whether any entry was consumed. */
function drainInbox(deps: LoopDeps, keep: ReadonlySet<Tinkerer.Entry["kind"]>): boolean {
  const taken = deps.inbox.get().filter((entry) => keep.has(entry.kind));
  if (taken.length === 0) return false;
  deps.inbox.update((list) => list.filter((entry) => !keep.has(entry.kind)));
  for (const entry of taken) injectEntry(deps, entry);
  return true;
}

function injectEntry(deps: LoopDeps, entry: Tinkerer.Entry): void {
  deps.messages.update((list) => [...list, { role: "user", content: entry.content }]);
  patchSettings(deps.settings, entry);
}

function patchSettings(
  settings: Scope.DataController<Tinkerer.Settings | undefined>,
  entry: Tinkerer.Entry,
): void {
  if (entry.mode === undefined && entry.options === undefined) return;
  const current = settings.get();
  if (current === undefined) return;
  settings.set({
    mode: entry.mode ?? current.mode,
    options: { ...current.options, ...entry.options },
  });
}

export { isError };
export type { Errors };
