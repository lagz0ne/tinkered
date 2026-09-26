import type { Mcp } from "@tinker/mcp";
import {
  data,
  operation,
  resource,
  tag,
  readMany,
  type Data,
  type Many,
  type Operation,
  type Resource,
  type Scope,
  type Tag,
} from "@tinker/core";

export type { Errors } from "./errors.ts";
export { isError } from "./errors.ts";
export { claudeCode } from "./claude.ts";
export type { ClaudeCode } from "./claude.ts";
export { codex } from "./codex.ts";
export type { OpenAiCodex } from "./codex.ts";

export declare namespace Harness {
  /** A thread's lifecycle as the session sees it: quiet, mid-turn, last turn done, last turn failed. */
  export type Status = "idle" | "running" | "done" | "failed";
  /** Token and cost totals once the harness reports them; `cached` is 0 when it reports none. */
  export type Usage = {
    readonly input: number;
    readonly cached: number;
    readonly output: number;
    readonly cost?: number;
  };
  /** One unit of tool activity: `kind` is the harness's own item/tool type string, `source`
   * the raw SDK event it came from. */
  export type Item = {
    readonly kind: string;
    readonly id?: string;
    readonly status?: string;
    readonly source: unknown;
  };
  /** What a backend receives at thread start: the session's abort signal, the bound `resume`
   * id when the session carries one (absent means start fresh), plus the writers for the
   * frame's ambient cells. Every writer funnels through its cell's controller, so a TUI
   * watching `text` sees each delta as it lands. */
  export type Hooks = {
    readonly label: string;
    readonly signal: AbortSignal;
    readonly resume?: string;
    readonly emit: (event: unknown) => void;
    readonly text: (delta: string) => void;
    readonly item: (item: Item) => void;
    readonly usage: (usage: Usage) => void;
    readonly id: (id: string) => void;
  };
  /** What a harness lets userland answer during a turn, as the SDK's OWN types (ADR 0043): an
   * approval (`request` → `decision`) and a tool (`result` = the SDK-side result the adapter
   * maps values to — Claude: the MCP `CallToolResult`). The definition IS the `Mcp.Row` from
   * `@tinker/mcp`'s `expose` (ADR 0051): a tool op returns whatever value it returns and the
   * adapter maps it at the edge, so one row serves every harness and the MCP driver. Its presence is what admits
   * `tools` — an adapter without the hook says `never`, so the frame rejects a `tools` list
   * for it at compile time. A type-level record only — no runtime value. */
  export type Calls = {
    readonly approval: { readonly request: unknown; readonly decision: unknown };
    readonly tool: { readonly result: unknown };
  };
  /** One tool a frame exposes in-process: an `expose(op, { description, schema })` row, the
   * same `Mcp.Row` the MCP driver takes. The op returns whatever value it returns — the adapter
   * maps it at the edge. Attached at frame construction so the turn op depends on the row's op
   * and the call is a SUBFLOW of the turn. The presence of `C["tool"]` keeps the compile-time
   * gate: an adapter whose `Calls.tool` is `never` rejects `tools`. */
  export type Tool<C extends Calls> = [C["tool"]] extends [never] ? never : Mcp.Row;
  /** One tool as the thread receives it per turn: the row's op, its facts, and its subflow
   * controller. */
  export type ToolCall<C extends Calls> = {
    readonly op: Tool<C>["op"];
    readonly meta: Mcp.Tool;
    readonly run: Scope.OperationController<unknown, unknown>;
  };
  /** The approval operation a frame over `C` accepts: its input is the adapter's request, its
   * result the adapter's decision. Attached at frame construction (like the harness's own
   * tool and approval slots) so the turn op can depend on it — the approval runs as a SUBFLOW
   * of the turn. */
  export type ApproveOp<C extends Calls> = Operation.Handle<
    C["approval"]["decision"] | PromiseLike<C["approval"]["decision"]>,
    C["approval"]["request"]
  >;
  /** What the turn op hands its thread per turn: the approval subflow's controller and the tool
   * subflows, when the frame was built with them. The adapter calls them from the SDK's own
   * hooks. */
  export type TurnCalls<C extends Calls> = {
    readonly approve?: Scope.OperationController<
      C["approval"]["decision"] | PromiseLike<C["approval"]["decision"]>,
      C["approval"]["request"]
    >;
    readonly tools?: readonly ToolCall<C>[];
  };
  /** One live conversation: run turns on it, close it when done. The session's signal is the
   * interrupt — the thread stops its SDK call when it fires; `close` releases the thread's
   * own process and handles. `calls` carries the turn's subflows (ADR 0043 t03). */
  export type Thread<Turn, Result, C extends Calls> = {
    run(turn: Turn, calls: TurnCalls<C>): Promise<Result>;
    close(): Promise<void> | void;
  };
  /** What an adapter resource builds: `start` opens a thread on merged options and hooks. */
  export type Backend<Options, Turn, Result, C extends Calls> = {
    start(
      options: Options,
      hooks: Hooks,
    ): Thread<Turn, Result, C> | PromiseLike<Thread<Turn, Result, C>>;
  };
  /** One harness's SDK binding: its label, its lazy backend resource, its options tag, and
   * the nearest-first merge over `.all` bindings. Continuity rides `Hooks.resume` — the
   * session's `resume` binding passed through hooks, so each adapter resumes its own way
   * (Claude spreads it into `Options`; Codex calls `resumeThread`). */
  export type Adapter<Options, Turn, Result, C extends Calls> = {
    readonly label: string;
    readonly resource: Resource.Handle<Promise<Backend<Options, Turn, Result, C>>>;
    readonly options: Tag.Handle<Partial<Options>>;
    readonly merge: (bindings: readonly Partial<Options>[]) => Options;
  };
  /** The frame `harness` returns: its label, its adapter, the session `thread` resource,
   * the ambient cells the thread writes (`status`, `text`, `items`, `usage`, `id`,
   * `events`), the `resume` tag (bind an id to continue a conversation), and `send` —
   * the one operation to depend on — labelled `${frame.label}.send`. Its input is the
   * adapter's own turn type (no parse: the author's operation owns its own input); it
   * delivers the adapter's own result (no mapping: the author's `run` reads it). */
  export type Frame<Options, Turn, Result, C extends Calls> = {
    readonly label: string;
    readonly adapter: Adapter<Options, Turn, Result, C>;
    readonly send: Operation.Handle<Promise<Result>, Turn>;
    readonly thread: Resource.Handle<Promise<Thread<Turn, Result, C>>>;
    readonly status: Data.Cell<Status>;
    readonly text: Data.Cell<string>;
    readonly items: Data.Cell<readonly Item[]>;
    readonly usage: Data.Cell<Usage | undefined>;
    readonly id: Data.Cell<string | undefined>;
    readonly events: Data.Cell<readonly unknown[]>;
    readonly resume: Tag.Handle<string>;
  };
}

/** The shared frozen empty item list — every frame's `items` cell starts here. */
const noItems: readonly Harness.Item[] = Object.freeze([]);

/** The shared frozen empty event list — every frame's `events` cell starts here. */
const noEvents: readonly unknown[] = Object.freeze([]);

/** The `depends` slots of a frame's tools, one per tool under `tool:<name>`: a record the send
 * op spreads into its own `depends`, so each tool's operation is a subflow of the send. The
 * value is whatever the op returns — the adapter maps it at the edge. */
type ToolDeps = Record<`tool:${string}`, Operation.Handle<unknown, unknown>>;

/** The controllers those slots deliver, read back by the same keys. */
type ToolSlots<C extends Harness.Calls> = Record<`tool:${string}`, Harness.ToolCall<C>["run"]>;

/** One tool's facts, read once at frame construction: the row's op, its facts, and its dep key. */
type ToolEntry<C extends Harness.Calls> = {
  readonly op: Harness.Tool<C>["op"];
  readonly meta: Mcp.Tool;
  readonly key: `tool:${string}`;
};

/** Read every tool row once: its op, its facts, and its dep key — the facts' name, defaulting
 * to the op's label. A row always carries its facts, so nothing here can fail. */
function readToolEntries<C extends Harness.Calls>(
  tools: readonly Harness.Tool<C>[],
): readonly ToolEntry<C>[] {
  return tools.map(({ op, meta }) => ({ op, meta, key: `tool:${meta.name ?? op.label}` }));
}

/** One `tool:<name>` slot per tool, built once at frame construction. */
function readToolDeps<C extends Harness.Calls>(entries: readonly ToolEntry<C>[]): ToolDeps {
  const deps: ToolDeps = {};
  for (const entry of entries) deps[entry.key] = entry.op;
  return deps;
}

/** The turn's calls from its resolved slots: the approval controller when configured, and one
 * `{ op, meta, run }` per tool (absent when the frame has none — nothing allocated then). */
function readCalls<C extends Harness.Calls>(
  slots: ToolSlots<C>,
  entries: readonly ToolEntry<C>[],
  approve: Harness.TurnCalls<C>["approve"],
): Harness.TurnCalls<C> {
  if (entries.length === 0) return approve === undefined ? {} : { approve };
  const calls = entries.map((entry) => ({
    op: entry.op,
    meta: entry.meta,
    run: slots[entry.key],
  }));
  return approve === undefined ? { tools: calls } : { approve, tools: calls };
}

/** Build one frame at construction time; namespaces split its state and thread without
 * minting another graph. The label only names spans, cells, and the in-process server.
 * Six ambient cells, a `resume` tag (no default — absent means start
 * fresh), and a session `thread` resource whose factory merges the adapter's option
 * bindings nearest-first, passes `resume` through hooks, hands the backend hook writers
 * over each cell's controller, and always closes the thread on settle. The
 * signal is the interrupt: the thread stops its SDK call when it fires, so the defer only
 * closes (a defer runs after in-flight turns settled — closing there cannot deadlock).
 * Appending one array per event is O(n²) for long turns — accepted in v1; a ring or a
 * limit is a later knob. */
export function harness<O, T, R, C extends Harness.Calls>(config: {
  label?: string;
  adapter: Harness.Adapter<O, T, R, C>;
  approve?: Harness.ApproveOp<C>;
  tools?: Many<Harness.Tool<C>>;
  meta?: Tag.Bindings;
}): Harness.Frame<O, T, R, C> {
  const adapter = config.adapter;
  const label = config.label ?? "harness";
  const status = data<Harness.Status>({ label: `${label}.status`, initial: "idle" });
  const text = data<string>({ label: `${label}.text`, initial: "" });
  const items = data<readonly Harness.Item[]>({ label: `${label}.items`, initial: noItems });
  const usage = data<Harness.Usage | undefined>({
    label: `${label}.usage`,
    initial: undefined,
  });
  const id = data<string | undefined>({ label: `${label}.id`, initial: undefined });
  const events = data<readonly unknown[]>({ label: `${label}.events`, initial: noEvents });
  const resume = tag<string>({ label: `${label}.resume`, meta: config.meta });
  const thread: Resource.Handle<Promise<Harness.Thread<T, R, C>>> = resource({
    label: `${label}.thread`,
    target: "session",
    depends: {
      backend: adapter.resource,
      options: adapter.options.all,
      resume: resume.optional,
      text: text.controller,
      items: items.controller,
      usage: usage.controller,
      id: id.controller,
      events: events.controller,
    },
    meta: config.meta,
    factory: async ({ backend, options, resume: resumed, text, items, usage, id, events }, ctx) => {
      const merged = adapter.merge(options);
      const hooks: Harness.Hooks = {
        label,
        signal: ctx.signal,
        resume: resumed.present ? resumed.value : undefined,
        emit: (event) => events.update((list) => [...list, event]),
        text: (delta) => text.update((current) => current + delta),
        item: (item) => items.update((list) => [...list, item]),
        usage: (value) => usage.set(value),
        id: (value) => id.set(value),
      };
      const live = await backend.start(merged, hooks);
      ctx.defer(() => live.close());
      return live;
    },
  });
  const frame = { label, adapter, thread };
  const entries = readToolEntries(readMany(config.tools));
  const toolDeps = readToolDeps(entries);
  const approve = config.approve;
  /** The frame's one operation to depend on: `running` plus a fresh `text`, the thread's
   * `run` with the turn's calls, then `done` or `failed` ({@link runTurn}). It depends on
   * the thread, the cells it writes, and the tool and approval slots — so each tool and
   * the approval runs as a SUBFLOW of the turn (its span nests, it sees the session's
   * bindings). The author declares the turn's own operation above it. */
  const send: Operation.Handle<Promise<R>, T> = approve === undefined
    ? operation({
        label: `${label}.send`,
        depends: {
          thread,
          status: status.controller,
          text: text.controller,
          ...toolDeps,
        },
        meta: config.meta,
        run: (deps, ctx) => runTurn(frame, deps, readCalls(deps, entries, undefined), ctx),
      })
    : operation({
        label: `${label}.send`,
        depends: {
          thread,
          status: status.controller,
          text: text.controller,
          approve,
          ...toolDeps,
        },
        meta: config.meta,
        run: (deps, ctx) => runTurn(frame, deps, readCalls(deps, entries, deps.approve), ctx),
      });
  return {
    label,
    adapter,
    send,
    thread,
    status,
    text,
    items,
    usage,
    id,
    events,
    resume,
  };
}

/** What one turn body needs from its op: the thread, the cells it writes, and the approval
 * subflow's controller when the frame has one. */
type TurnDeps<T, R, C extends Harness.Calls> = {
  readonly thread: Harness.Thread<T, R, C>;
  readonly status: Scope.DataController<Harness.Status>;
  readonly text: Scope.DataController<string>;
};

/** Run one turn: `running` plus a fresh `text`, the thread's `run` with the turn's calls, then
 * `done` or `failed`. A forced close seals the layer before the catch runs, so the `failed` cell
 * write is skipped under an abort (the close itself settles `cancelled`, and the log line says
 * so); real errors still record it. */
async function runTurn<T, R, C extends Harness.Calls>(
  frame: { readonly label: string; readonly adapter: Harness.Adapter<unknown, T, R, C> },
  deps: TurnDeps<T, R, C>,
  calls: Harness.TurnCalls<C>,
  ctx: Operation.Ctx<T>,
): Promise<R> {
  if (ctx.signal.aborted) throw ctx.signal.reason;
  deps.status.set("running");
  deps.text.set("");
  const span = ctx.obs.span;
  if (span) span.attributes.adapter = frame.adapter.label;
  try {
    const result = await deps.thread.run(ctx.input, calls);
    deps.status.set("done");
    ctx.log("harness turn", { harness: frame.label, status: "done" });
    return result;
  } catch (error) {
    if (!ctx.signal.aborted) deps.status.set("failed");
    ctx.log("harness turn", {
      harness: frame.label,
      status: ctx.signal.aborted ? "cancelled" : "failed",
    });
    throw error;
  }
}
