import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createScope, preset } from "@tinker/core";
import { claudeCode, type ClaudeCode } from "@tinker/harness";
import type {
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  bootScope,
  buildApp,
  parseComment,
  parseIssueDetail,
  runDraft,
} from "../src/index.ts";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-draft-")), "db");
}

type Heard = {
  readonly stop: () => Promise<void>;
  readonly base: string;
  readonly serve: (app: { fetch: (req: Request) => Response | Promise<Response> }) => void;
};

async function reservePort(): Promise<Heard> {
  const { serve } = await import("@hono/node-server");
  let current: { fetch: (req: Request) => Response | Promise<Response> } | undefined;
  let settle: (port: number) => void = () => undefined;
  const heard = new Promise<number>((resolve) => {
    settle = resolve;
  });
  const server = serve(
    { fetch: (req) => (current === undefined ? new Response("starting", { status: 503 }) : current.fetch(req)), hostname: "127.0.0.1", port: 0 },
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

type Script = {
  readonly id?: string;
  readonly text: string;
  readonly hold?: boolean;
  readonly fail?: boolean;
  readonly errorResult?: boolean;
};

type Fixture = {
  readonly sdk: ClaudeCode.Sdk;
  readonly toolsCalled: string[];
  readonly saved: unknown[];
  readonly decisions: unknown[];
  readonly queryOptions: Record<string, unknown>[];
  readonly started: () => Promise<void>;
  readonly release: () => void;
};

function readFixture(scripts: Script[]): Fixture {
  const toolsCalled: string[] = [];
  const saved: unknown[] = [];
  const decisions: unknown[] = [];
  const queryOptions: Record<string, unknown>[] = [];
  const registrations = new Map<object, Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"]>();
  const registeredKey = { type: "stdio", command: "test-only-do-not-spawn" } as ReturnType<
    ClaudeCode.Sdk["createSdkMcpServer"]
  >;
  let startedResolve: () => void = () => undefined;
  const started = (): Promise<void> =>
    new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
  let releaseHold: () => void = () => undefined;
  const queue = [...scripts];
  async function* readStream(
    prompt: string,
    options: Parameters<ClaudeCode.Sdk["query"]>[0]["options"],
  ) {
    const script = queue.shift();
    if (script === undefined) return;
    if (options === undefined) throw new Error("expected query options");
    queryOptions.push({ ...options, abortController: undefined, canUseTool: undefined });
    if (options.allowedTools?.join(",") !== "mcp__triage__list,mcp__triage__get") {
      throw new Error("expected only the two issue read tools to auto-run");
    }
    if (options.tools !== undefined && JSON.stringify(options.tools) !== "[]") {
      throw new Error("expected built-in tools disabled");
    }
    if (options.settingSources !== undefined && JSON.stringify(options.settingSources) !== "[]") {
      throw new Error("expected filesystem settings disabled");
    }
    if (options.strictMcpConfig !== true) throw new Error("expected strict MCP config");
    const configs = Object.values(options.mcpServers ?? {});
    if (configs.length !== 1) throw new Error("expected only the in-process read server");
    const registered = registrations.get(configs[0] as object) ?? [];
    const names = registered.map((entry) => entry.name).sort();
    if (names.join(",") !== "get,list") throw new Error("expected only get and list tools");
    if (options.abortController === undefined) throw new Error("expected an abort signal");
    const signal = options.abortController.signal;
    const deny = options.canUseTool
      ? await options.canUseTool("Bash", { command: "echo never" }, {
          signal,
          toolUseID: "t-denied",
          requestId: "r-denied",
        })
      : undefined;
    decisions.push(deny);
    for (const entry of registered) {
      toolsCalled.push(entry.name);
      const answered = await entry.handler(entry.name === "get" ? { id: script.id } : {}, {});
      if (answered.isError === true) throw new Error(`read tool ${entry.name} failed`);
      if (entry.name === "get") {
        const part = answered.content.find((text) => text.type === "text");
        if (part !== undefined && part.type === "text") saved.push(JSON.parse(part.text));
      }
    }
    void prompt;
    yield readSystemInit();
    yield readDelta(script.text.slice(0, Math.ceil(script.text.length / 2)));
    startedResolve();
    if (script.hold === true) {
      const release = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      const onAbort = (): void => {
        releaseHold();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        await release;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      if (signal.aborted === true) throw signal.reason;
    }
    if (script.fail === true) throw new Error("recorded model failure");
    yield readDelta(script.text.slice(Math.ceil(script.text.length / 2)));
    if (script.errorResult === true) {
      yield {
        ...readResult(script.text),
        subtype: "error_during_execution",
        is_error: true,
        errors: ["recorded error result"],
      } as SDKResultMessage;
    } else {
      yield readResult(script.text);
    }
  }
  const seen: { servers: { tools: Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"] }[] } = { servers: [] };
  const sdk: ClaudeCode.Sdk = {
    tool: (name, description, schema, handler) => ({
      name,
      description,
      inputSchema: schema,
      handler,
    }),
    createSdkMcpServer: ({ tools }) => {
      seen.servers.push({ tools });
      registrations.set(registeredKey, [...tools]);
      return registeredKey;
    },
    query: ({ prompt, options }) => readStream(prompt, options),
  };
  return {
    sdk,
    toolsCalled,
    saved,
    decisions,
    queryOptions,
    started,
    release: () => releaseHold(),
  };
}

function readEvents(text: string): { kind: string; [key: string]: unknown }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
}

test("the draft helper is off by default and needs no account", async () => {
  const booted = await bootScope(tempPath());
  const app = buildApp(booted);
  try {
    const capability = await app.request("/api/draft");
    expect(capability.status).toBe(200);
    expect(await capability.json()).toEqual({ enabled: false });

    const created = await booted.save.create({ title: "Plain", description: "no helper" });
    const refused = await app.request(`/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(404);
    const detail = await booted.detail(created.id);
    expect(detail.comments).toEqual([]);
    expect(detail.activity.length).toBe(1);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("a draft streams text and finishes without saving anything", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Streamed", description: "read me" });
  await booted.save.comment({ issueId: created.id, author: "Lin", text: "Discuss this." });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readFixture([{ id: created.id, text: "A short summary." }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  try {
    const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const seen = readEvents(await res.text());
    expect(seen.filter((event) => event.kind === "text").map((event) => event.text).join("")).toBe(
      "A short summary.",
    );
    expect(seen.filter((event) => event.kind === "done")).toEqual([
      { kind: "done", draft: "A short summary." },
    ]);
    expect(seen.at(-1)).toEqual({ kind: "terminal", status: "done", draft: "A short summary." });
    expect(await live.detail(created.id)).toEqual(before);
    expect(fixture.toolsCalled.sort()).toEqual(["get", "list"]);
    expect(fixture.decisions).toEqual([
      { behavior: "deny", message: "only issue reads are allowed" },
    ]);
    expect(fixture.saved).toEqual([before]);
    expect(fixture.queryOptions[0]?.allowedTools).toEqual([
      "mcp__triage__list",
      "mcp__triage__get",
    ]);
    expect(fixture.queryOptions[0]?.tools).toEqual([]);
    expect(fixture.queryOptions[0]?.settingSources).toEqual([]);
    expect(fixture.queryOptions[0]?.strictMcpConfig).toBe(true);
  } finally {
    await heard.stop();
    await live.scope.close({ graceful: true });
  }
});

test("an explicit post persists one comment and nothing else changes", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Post me", description: "v1" });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readFixture([{ id: created.id, text: "Post this draft." }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  try {
    const generated = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const finished = readEvents(await generated.text()).filter((event) => event.kind === "done");
    expect(finished.length).toBe(1);

    const posted = await fetch(`${heard.base}/api/issues/${created.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "Ada", text: "Post this draft." }),
    });
    expect(posted.status).toBe(201);
    expect(parseComment(await posted.json()).text).toBe("Post this draft.");
    const after = await live.detail(created.id);
    expect(after.comments.length).toBe(before.comments.length + 1);
    expect(after.comments.at(-1)?.text).toBe("Post this draft.");
    expect(after.issue.revision).toBe(before.issue.revision);
    expect(after.activity.length).toBe(before.activity.length + 1);
  } finally {
    await heard.stop();
    await live.scope.close({ graceful: true });
  }
});

test("a model error result and a thrown model error both fail without a draft", async () => {
  for (const script of [{ errorResult: true }, { fail: true }]) {
    const heard = await reservePort();
    const path = tempPath();
    const booted = await bootScope(path);
    const created = await booted.save.create({ title: "Failing", description: "v1" });
    const before = await booted.detail(created.id);
    await booted.scope.close({ graceful: true });
    const fixture = readFixture([{ id: created.id, text: "never shown", ...script }]);
    const live = await bootScope(path, {
      draft: { enabled: true, baseUrl: heard.base },
      presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
    });
    heard.serve(buildApp(live));
    try {
      const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const seen = readEvents(await res.text());
      expect(seen.some((event) => event.kind === "done")).toBe(false);
      expect(seen.some((event) => event.kind === "status" && event.status === "failed")).toBe(true);
      expect(await live.detail(created.id)).toEqual(before);
    } finally {
      await heard.stop();
      await live.scope.close({ graceful: true });
    }
  }
});

test("a draft for a missing issue answers gone and runs no model", async () => {
  const fixture = readFixture([{ text: "never used" }]);
  const booted = await bootScope(tempPath(), {
    draft: { enabled: true, baseUrl: "http://127.0.0.1:1" },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
  try {
    const res = await app.request("/api/issues/missing-id/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(fixture.queryOptions.length).toBe(0);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("an aborted caller runs no model turn", async () => {
  const fixture = readFixture([{ text: "never used" }]);
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fixture.sdk)] });
  try {
    const stopper = new AbortController();
    stopper.abort();
    const done = await runDraft(scope, { id: "x", prompt: "" }, () => undefined, stopper.signal);
    expect(done).toEqual({ status: "cancelled", draft: "" });
    expect(fixture.queryOptions.length).toBe(0);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("ordinary saves continue while a draft turn holds", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Held", description: "v1" });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readFixture([{ id: created.id, text: "Held draft.", hold: true }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  try {
    const pending = fetch(`${heard.base}/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    await fixture.started();
    const other = await live.save.create({ title: "Concurrent", description: "no block" });
    expect(other.title).toBe("Concurrent");
    fixture.release();
    const seen = readEvents(await (await pending).text());
    expect(seen.at(-1)).toEqual({ kind: "terminal", status: "done", draft: "Held draft." });
    expect(parseIssueDetail(await (await fetch(`${heard.base}/api/issues/${created.id}`)).json())).toEqual(
      before,
    );
  } finally {
    await heard.stop();
    await live.scope.close({ graceful: true });
  }
});

test("separate issues stream isolated drafts through one live app", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const one = await booted.save.create({ title: "One", description: "v1" });
  const two = await booted.save.create({ title: "Two", description: "v1" });
  await booted.scope.close({ graceful: true });
  const fixture = readFixture([
    { id: one.id, text: "First draft." },
    { id: two.id, text: "Second draft." },
  ]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  try {
    const firstSeen = readEvents(
      await (
        await fetch(`${heard.base}/api/issues/${one.id}/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      ).text(),
    );
    const secondSeen = readEvents(
      await (
        await fetch(`${heard.base}/api/issues/${two.id}/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      ).text(),
    );
    expect(firstSeen.at(-1)).toEqual({ kind: "terminal", status: "done", draft: "First draft." });
    expect(secondSeen.at(-1)).toEqual({
      kind: "terminal",
      status: "done",
      draft: "Second draft.",
    });
  } finally {
    await heard.stop();
    await live.scope.close({ graceful: true });
  }
});
