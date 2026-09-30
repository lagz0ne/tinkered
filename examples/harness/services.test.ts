import { expect, test } from "vite-plus/test";
import { createScope, preset } from "@tinker/core";
import { claudeCode, type ClaudeCode } from "@tinker/harness";
import { backend, HttpRequest, HttpResponse, isError, type HttpClient } from "@tinker/http";
import type {
  McpServerConfig,
  Options,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { services, serviceTags } from "./index.ts";

const settings = { githubToken: "github-only", cloudflareToken: "cloudflare-only", cwd: "/work" };
const recordedResult: SDKResultMessage = {
  type: "result",
  subtype: "success",
  duration_ms: 1,
  duration_api_ms: 1,
  is_error: false,
  num_turns: 1,
  result: "Read both services.",
  stop_reason: null,
  total_cost_usd: 0,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    fallback_credit: { status: { type: "redeemed" } },
    inference_geo: "none",
    iterations: [],
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: "standard",
    speed: "standard",
  },
  modelUsage: {},
  permission_denials: [],
  uuid: "11111111-2222-4333-8444-555555555555",
  session_id: "services-thread",
};

class RecordingSdk implements ClaudeCode.Sdk {
  readonly servers = new Map<
    McpServerConfig,
    Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]
  >();
  readonly queries: (Options | undefined)[] = [];
  readonly results: CallToolResult[] = [];
  calls = [
    { name: "getrepo", args: { owner: " octocat ", repo: " Hello-World " } },
    { name: "listzones", args: { name: " example.com " } },
  ];
  checkApproval = false;
  approval?: Awaited<ReturnType<NonNullable<Options["canUseTool"]>>>;
  id = "services-thread";

  tool: ClaudeCode.Sdk["tool"] = (name, description, schema, handler) => ({
    name,
    description,
    inputSchema: schema,
    handler,
  });

  createSdkMcpServer(options: Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]) {
    const server: McpServerConfig = { type: "stdio", command: "recorded-sdk" };
    this.servers.set(server, options);
    return server;
  }

  async *query({ options }: Parameters<ClaudeCode.Sdk["query"]>[0]): AsyncGenerator<SDKMessage> {
    this.queries.push(options);
    const server = options?.mcpServers?.services;
    const registered = server === undefined ? undefined : this.servers.get(server);
    if (registered === undefined) return;
    await this.requestApproval(options);
    for (const call of this.calls) {
      const tool = registered.tools.find((entry) => entry.name === call.name);
      if (tool === undefined) return;
      this.results.push(await tool.handler(call.args, {}));
    }
    yield { ...recordedResult, session_id: this.id };
  }

  private async requestApproval(options: Options | undefined): Promise<void> {
    if (!this.checkApproval || options?.canUseTool === undefined) return;
    this.approval = await options.canUseTool(
      "Bash",
      { command: "echo unneeded" },
      { signal: new AbortController().signal, toolUseID: "permission-1", requestId: "request-1" },
    );
  }
}

class RecordingHttp {
  readonly requests: HttpRequest.Record[] = [];
  status = 200;
  repo: unknown = {
    full_name: "octocat/Hello-World",
    html_url: "https://github.com/octocat/Hello-World",
    private: false,
    description: null,
    stargazers_count: 42,
    ignored: "not sent to the agent",
  };
  zones: unknown = {
    success: true,
    result: [{ id: "zone-1", name: "example.com", status: "active", ignored: true }],
  };

  send: HttpClient.Backend = async (request) => {
    this.requests.push(request);
    return HttpResponse.make(request, {
      status: this.status,
      body: JSON.stringify(
        request.url.startsWith("https://api.github.com/") ? this.repo : this.zones,
      ),
    });
  };
}

test("the agent reads two service URLs with separate tokens and maps their parsed replies", async () => {
  const sdk = new RecordingSdk();
  const http = new RecordingHttp();
  http.status = 201;
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [...serviceTags(settings), backend(http.send)],
    presets: [preset(claudeCode.sdk, async () => sdk)],
  });
  try {
    await root.createSession().run(services.send, { input: { prompt: "Read both services." } });
    expect(
      http.requests.map((request) => ({
        url: HttpRequest.toUrl(request),
        method: request.method,
        token: request.headers.authorization,
        version: request.headers["x-github-api-version"],
        accept: request.headers.accept,
      })),
    ).toEqual([
      {
        url: "https://api.github.com/repos/octocat/Hello-World",
        method: "GET",
        token: "Bearer github-only",
        version: "2026-03-10",
        accept: "application/vnd.github+json",
      },
      {
        url: "https://api.cloudflare.com/client/v4/zones?page=1&per_page=50&name=example.com",
        method: "GET",
        token: "Bearer cloudflare-only",
        version: undefined,
        accept: undefined,
      },
    ]);
    expect(sdk.results).toEqual([
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              name: "octocat/Hello-World",
              url: "https://github.com/octocat/Hello-World",
              private: false,
              description: null,
              stars: 42,
            }),
          },
        ],
      },
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              page: 1,
              zones: [{ id: "zone-1", name: "example.com", status: "active" }],
            }),
          },
        ],
      },
    ]);
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("two turns reuse the same SDK server and resume one conversation", async () => {
  const sdk = new RecordingSdk();
  const http = new RecordingHttp();
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [...serviceTags(settings), backend(http.send)],
    presets: [preset(claudeCode.sdk, async () => sdk)],
  });
  try {
    const session = root.createSession();
    await session.run(services.send, { input: { prompt: "Read both services." } });
    await session.run(services.send, { input: { prompt: "Read them again." } });
    const [first, second] = sdk.queries;
    expect(second?.mcpServers?.services).toBe(first?.mcpServers?.services);
    expect(second?.resume).toBe("services-thread");
    expect(sdk.results).toHaveLength(4);
    expect(session.resolve(services.id)).toBe("services-thread");
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("closing one root leaves the same graph and namespace keys usable in another root", async () => {
  const a = new RecordingSdk();
  const b = new RecordingSdk();
  a.id = "thread-a";
  b.id = "thread-b";
  const http = new RecordingHttp();
  const tags = [...serviceTags(settings), backend(http.send)];
  const stopA = new AbortController();
  const stopB = new AbortController();
  const rootA = createScope({
    signal: stopA.signal,
    tags,
    presets: [preset(claudeCode.sdk, async () => a)],
  });
  const rootB = createScope({
    signal: stopB.signal,
    tags,
    presets: [preset(claudeCode.sdk, async () => b)],
  });
  try {
    const sessionA = rootA.createSession();
    const sessionB = rootB.createSession();
    await sessionA.run(services.send, { input: { prompt: "A reads." } });
    await sessionB.run(services.send, { input: { prompt: "B reads." } });
    stopA.abort();
    await rootA.closed;
    await sessionB.run(services.send, { input: { prompt: "B still reads." } });
    expect(b.queries.map((query) => query?.resume)).toEqual([undefined, "thread-b"]);
    expect(sessionB.resolve(services.id)).toBe("thread-b");
    expect(b.results).toHaveLength(4);
  } finally {
    stopA.abort();
    stopB.abort();
    await Promise.all([rootA.closed, rootB.closed]);
  }
});

test("the root shares cwd and limits the agent to two service tools while denying other approvals", async () => {
  const sdk = new RecordingSdk();
  sdk.checkApproval = true;
  sdk.calls = [];
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: serviceTags(settings),
    presets: [preset(claudeCode.sdk, async () => sdk)],
  });
  try {
    await root.createSession().run(services.send, { input: { prompt: "Ask for an extra tool." } });
    expect(sdk.queries).toMatchObject([
      {
        cwd: "/work",
        tools: [],
        allowedTools: ["mcp__services__getrepo", "mcp__services__listzones"],
        settingSources: [],
        skills: [],
        strictMcpConfig: true,
      },
    ]);
    expect(sdk.approval?.behavior).toBe("deny");
    expect(
      [...sdk.servers.values()].map((server) => server.tools.map((tool) => tool.name)),
    ).toEqual([["getrepo", "listzones"]]);
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("service response schemas reject bad fields and Cloudflare failure envelopes", async () => {
  for (const bad of ["github", "cloudflare"]) {
    const sdk = new RecordingSdk();
    const http = new RecordingHttp();
    if (bad === "github") http.repo = { full_name: "octocat/Hello-World" };
    else http.zones = { success: false, result: [] };
    const stop = new AbortController();
    const root = createScope({
      signal: stop.signal,
      tags: [...serviceTags(settings), backend(http.send)],
      presets: [preset(claudeCode.sdk, async () => sdk)],
    });
    try {
      const result = await root
        .createSession()
        .settle(services.send, { input: { prompt: "Read both." } });
      if (result.status !== "failed") throw result;
      if (!isError(result.error, "ResponseFailed")) throw result.error;
      expect(result.error.payload.reason).toBe("Decode");
    } finally {
      stop.abort();
      await root.closed;
    }
  }
});

test("a non-2xx service reply is rejected before reading its body", async () => {
  const sdk = new RecordingSdk();
  const http = new RecordingHttp();
  http.status = 302;
  http.repo = null;
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [...serviceTags(settings), backend(http.send)],
    presets: [preset(claudeCode.sdk, async () => sdk)],
  });
  try {
    const result = await root
      .createSession()
      .settle(services.send, { input: { prompt: "Read both." } });
    if (result.status !== "failed") throw result;
    if (!isError(result.error, "ResponseFailed")) throw result.error;
    expect(result.error.payload.reason).toBe("StatusCode");
  } finally {
    stop.abort();
    await root.closed;
  }
});
