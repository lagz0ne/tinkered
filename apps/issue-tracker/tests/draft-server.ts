import { type ClaudeCode } from "@tinker/harness";
import type {
  SDKPartialAssistantMessage,
  SDKResultError,
  SDKResultMessage,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { fail } from "../src/index.ts";

export type DraftScript = {
  readonly id?: string;
  readonly text: string;
  readonly hold?: boolean;
  readonly fail?: boolean;
  readonly errorResult?: boolean;
};

export type DraftHeard = {
  readonly stop: () => Promise<void>;
  readonly base: string;
  readonly serve: (app: { fetch: (req: Request) => Response | Promise<Response> }) => void;
};

export async function reservePort(): Promise<DraftHeard> {
  const { serve } = await import("@hono/node-server");
  let current: { fetch: (req: Request) => Response | Promise<Response> } | undefined;
  let settle: (port: number) => void = () => undefined;
  const heard = new Promise<number>((resolve) => {
    settle = resolve;
  });
  const server = serve(
    {
      fetch: (req) =>
        current === undefined ? new Response("starting", { status: 503 }) : current.fetch(req),
      hostname: "127.0.0.1",
      port: 0,
    },
    (info) => settle(info.port),
  );
  const port = await heard;
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    base: `http://127.0.0.1:${port}`,
    serve: (app) => {
      current = app;
    },
  };
}

const uuid = "11111111-2222-4333-8444-555555555555";

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

function readSystemInit(): SDKSystemMessage {
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
    session_id: "draft-1",
  };
}

function readDelta(text: string): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
    uuid,
    session_id: "draft-1",
  };
}

function readResult(text: string): SDKResultMessage {
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
    session_id: "draft-1",
  };
}

function readErrorResult(text: string): SDKResultError {
  const result = readResult(text);
  return {
    ...result,
    subtype: "error_during_execution",
    is_error: true,
    errors: ["recorded error result"],
  };
}

export type DraftFixture = {
  readonly sdk: ClaudeCode.Sdk;
  readonly toolsCalled: string[];
  readonly saved: unknown[];
  readonly decisions: unknown[];
  readonly readGuardrails: () => Record<string, unknown> | undefined;
  readonly turnCount: () => number;
  readonly started: () => Promise<void>;
  readonly aborted: () => Promise<void>;
  readonly release: () => void;
};

export function readDraftServer(scripts: DraftScript[]): DraftFixture {
  const toolsCalled: string[] = [];
  const saved: unknown[] = [];
  const decisions: unknown[] = [];
  let guardrails: Record<string, unknown> | undefined;
  let turns = 0;
  const registrations = new Map<
    ReturnType<ClaudeCode.Sdk["createSdkMcpServer"]>,
    Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"]
  >();
  let startedResolve: () => void = () => undefined;
  let abortedResolve: () => void = () => undefined;
  const startedPromise = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  const abortedPromise = new Promise<void>((resolve) => {
    abortedResolve = resolve;
  });
  const started = (): Promise<void> => startedPromise;
  const aborted = (): Promise<void> => abortedPromise;
  let releaseHold: () => void = () => undefined;
  const queue = [...scripts];
  const sdk: ClaudeCode.Sdk = {
    tool: (name, description, schema, handler) => ({
      name,
      description,
      inputSchema: schema,
      handler,
    }),
    createSdkMcpServer: ({ tools }) => {
      const key: ReturnType<ClaudeCode.Sdk["createSdkMcpServer"]> = {
        type: "stdio",
        command: "test-only-do-not-spawn",
      };
      registrations.set(key, tools);
      return key;
    },
    query: ({ prompt, options }) => readStream(prompt, options),
  };
  async function* readStream(
    prompt: string,
    options: Parameters<ClaudeCode.Sdk["query"]>[0]["options"],
  ) {
    turns += 1;
    const script = queue.shift();
    if (script === undefined) throw fail("DraftFailed", { reason: "unexpected model turn" });
    if (options === undefined) throw fail("DraftFailed", { reason: "expected query options" });
    guardrails = readGuardrails(options);
    const registered = readRegistered(options);
    if (options.abortController === undefined) {
      throw fail("DraftFailed", { reason: "expected an abort signal" });
    }
    const signal = options.abortController.signal;
    await readDenied(options, signal);
    await readSaved(registered, script.id);
    if (prompt.length === 0) throw fail("DraftFailed", { reason: "expected a prompt" });
    yield readSystemInit();
    yield readDelta(script.text.slice(0, Math.ceil(script.text.length / 2)));
    startedResolve();
    await holdTurn(script, signal);
    if (script.fail === true) {
      throw fail("IssueNotFound", { id: "recorded-sdk-failure" });
    }
    yield readDelta(script.text.slice(Math.ceil(script.text.length / 2)));
    if (script.errorResult === true) {
      yield readErrorResult(script.text);
    } else {
      yield readResult(script.text);
    }
  }
  function readGuardrails(
    options: NonNullable<Parameters<ClaudeCode.Sdk["query"]>[0]["options"]>,
  ): Record<string, unknown> {
    return {
      allowedTools: options.allowedTools,
      tools: options.tools,
      settingSources: options.settingSources,
      strictMcpConfig: options.strictMcpConfig,
    };
  }
  function readRegistered(
    options: NonNullable<Parameters<ClaudeCode.Sdk["query"]>[0]["options"]>,
  ): Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"] {
    const configs = Object.values(options.mcpServers ?? {});
    if (configs.length !== 1) throw fail("DraftFailed", { reason: "expected one read server" });
    const first = configs.at(0);
    if (first === undefined) throw fail("DraftFailed", { reason: "expected one read server" });
    const registered = registrations.get(first) ?? [];
    const names = registered.map((entry) => entry.name).sort();
    if (names.join(",") !== "get,list") {
      throw fail("DraftFailed", { reason: "expected only get and list tools" });
    }
    return registered;
  }
  async function readDenied(
    options: NonNullable<Parameters<ClaudeCode.Sdk["query"]>[0]["options"]>,
    signal: AbortSignal,
  ): Promise<void> {
    const deny =
      options.canUseTool === undefined
        ? undefined
        : await options.canUseTool(
            "Bash",
            { command: "echo never" },
            { signal, toolUseID: "t-denied", requestId: "r-denied" },
          );
    decisions.push(deny);
  }
  async function readSaved(
    registered: Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"],
    id: string | undefined,
  ): Promise<void> {
    for (const entry of registered) {
      toolsCalled.push(entry.name);
      const answered = await entry.handler(entry.name === "get" ? { id } : {}, {});
      if (answered.isError === true) {
        throw fail("DraftFailed", { reason: `read tool ${entry.name} failed` });
      }
      if (entry.name === "get") {
        const part = answered.content.find((text) => text.type === "text");
        if (part !== undefined && part.type === "text") saved.push(JSON.parse(part.text));
      }
    }
  }
  async function holdTurn(script: DraftScript, signal: AbortSignal): Promise<void> {
    if (script.hold !== true) return;
    const release = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const onAbort = (): void => {
      abortedResolve();
      releaseHold();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener("abort", onAbort);
      abortedResolve();
      releaseHold();
      throw signal.reason;
    }
    try {
      await release;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw signal.reason;
  }
  return {
    sdk,
    toolsCalled,
    saved,
    decisions,
    readGuardrails: () => guardrails,
    turnCount: () => turns,
    started,
    aborted,
    release: () => releaseHold(),
  };
}
