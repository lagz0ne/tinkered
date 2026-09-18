import { expect, test } from "vite-plus/test";
import { createScope, preset, type Observe } from "@tinker/core";
import type {
  CodexOptions,
  Input,
  ThreadEvent,
  ThreadOptions,
  TurnOptions,
} from "@openai/codex-sdk";
import { codex, harness, isError, type Harness, type OpenAiCodex } from "../src/index.ts";
import { readCodexFailure, readCodexScript, type CodexScript } from "./fixtures.ts";

/** One `runStreamed` call a fake thread saw: the input plus the turn options. */
type SeenTurn = { readonly input: Input; readonly turnOptions: TurnOptions | undefined };

/** One `Codex` construction a fake saw: which constructor call plus its thread calls. */
type SeenClient = {
  readonly options: CodexOptions | undefined;
  readonly started: ThreadOptions[];
  readonly resumed: { readonly id: string; readonly options: ThreadOptions | undefined }[];
};

/** What one test owns: every turn the fake threads saw plus every `Codex` construction. */
type Seen = { turns: SeenTurn[]; clients: SeenClient[] };

/** A parked stream's release: the test resolves it after the close under test settles. */
type Gate = { readonly promise: Promise<void> };

/** A fake thread: yields the next script's events, checking the turn signal before each one. */
function fakeThread(scripts: CodexScript[], seen: Seen, gate?: Gate): OpenAiCodex.Thread {
  return {
    runStreamed: async (input, turnOptions) => {
      seen.turns.push({ input, turnOptions });
      const script = scripts.shift();
      return { events: readEvents(script?.events ?? [], turnOptions?.signal, gate) };
    },
  };
}

/** A fake SDK module: constructions land in the test's `seen.clients`. */
function fakeCodexSdk(scripts: CodexScript[], seen: Seen, gates?: Gate[]) {
  return {
    Codex: class {
      client: SeenClient;
      constructor(options?: CodexOptions) {
        this.client = { options, started: [], resumed: [] };
        seen.clients.push(this.client);
      }
      startThread(options?: ThreadOptions) {
        this.client.started.push(options ?? {});
        return fakeThread(scripts, seen, gates?.shift());
      }
      resumeThread(id: string, options?: ThreadOptions) {
        this.client.resumed.push({ id, options });
        return fakeThread(scripts, seen, gates?.shift());
      }
    },
  };
}

/** Yield recorded events, then park on `gate` while given; an abort rejects first. */
async function* readEvents(
  events: readonly ThreadEvent[],
  signal: AbortSignal | undefined,
  gate?: Gate,
): AsyncGenerator<ThreadEvent> {
  for (const event of events) {
    if (signal?.aborted === true) throw signal.reason;
    yield event;
  }
  if (gate === undefined) return;
  if (signal?.aborted === true) throw signal.reason;
  const abort = new Promise<never>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
  });
  await Promise.race([gate.promise, abort]);
}

test("a turn folds the event stream into the result and the ambient cells", async () => {
  const seen: Seen = { turns: [], clients: [] };
  const script = readCodexScript();
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const scope = createScope({
    presets: [preset(codex.sdk, async () => fakeCodexSdk([script], seen))],
  });
  const session = scope.createSession();
  const statusSeen: Harness.Status[] = [];
  const textSeen: string[] = [];
  session.controller(coder.status).watch((next) => statusSeen.push(next));
  session.controller(coder.text).watch((next) => textSeen.push(next));
  const result = await session.run(ask, { input: "hello" });
  const command = script.events[6];
  const message = script.events[7];
  if (command.type !== "item.completed" || message.type !== "item.completed")
    throw new Error("fixtures changed shape");
  expect(result).toEqual({
    items: [command.item, message.item],
    finalResponse: "Hello",
    usage: {
      input_tokens: 10,
      cached_input_tokens: 2,
      cache_write_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 1,
    },
  });
  expect(result.items[0]).toBe(command.item);
  expect(statusSeen).toEqual(["running", "done"]);
  expect(textSeen).toEqual(["Hel", "Hello"]);
  const started = script.events[5];
  const updated = script.events[3];
  if (started.type !== "item.started" || updated.type !== "item.updated")
    throw new Error("fixtures changed shape");
  expect(session.resolve(coder.items)).toEqual([
    { kind: "agent_message", id: "m-1", status: "started", source: script.events[2] },
    { kind: "agent_message", id: "m-1", status: "updated", source: updated },
    { kind: "agent_message", id: "m-1", status: "updated", source: script.events[4] },
    { kind: "command_execution", id: "c-1", status: "in_progress", source: started },
    { kind: "command_execution", id: "c-1", status: "completed", source: command },
    { kind: "agent_message", id: "m-1", status: "completed", source: message },
  ]);
  expect(session.resolve(coder.items)[3].source).toBe(started);
  expect(session.resolve(coder.usage)).toEqual({ input: 10, cached: 2, output: 5 });
  expect("cost" in (session.resolve(coder.usage) ?? {})).toBe(false);
  expect(session.resolve(coder.id)).toBe("t-1");
  expect(session.resolve(coder.events)).toEqual(script.events);
  expect(seen.turns.length).toBe(1);
  await scope.close();
});

test("options split into the constructor's keys and the thread's keys", async () => {
  const seen: Seen = { turns: [], clients: [] };
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const scope = createScope({
    tags: [codex.options({ apiKey: "k", model: "a", workingDirectory: "/x" })],
    presets: [preset(codex.sdk, async () => fakeCodexSdk([readCodexScript()], seen))],
  });
  const session = scope.createSession({ tags: [codex.options({ model: "b" })] });
  await session.run(ask, { input: "hello" });
  expect(seen.clients.length).toBe(1);
  expect(seen.clients[0].options).toEqual({ apiKey: "k" });
  expect(seen.clients[0].started).toEqual([{ model: "b", workingDirectory: "/x" }]);
  await scope.close();
});

test("every option key reaches its SDK side: the constructor's six, the thread's eleven", async () => {
  const seen: Seen = { turns: [], clients: [] };
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const scope = createScope({
    tags: [
      codex.options({
        codexPathOverride: "/bin/codex",
        baseUrl: "https://api",
        apiKey: "k",
        config: { a: 1 },
        configOverrides: ["x=1"],
        env: { HOME: "/h" },
        model: "m",
        threadSource: "src",
        sandboxMode: "read-only",
        workingDirectory: "/w",
        skipGitRepoCheck: true,
        modelReasoningEffort: "high",
        networkAccessEnabled: false,
        webSearchMode: "cached",
        webSearchEnabled: true,
        approvalPolicy: "never",
        additionalDirectories: ["/d"],
      }),
    ],
    presets: [preset(codex.sdk, async () => fakeCodexSdk([readCodexScript()], seen))],
  });
  await scope.createSession().run(ask, { input: "hello" });
  expect(seen.clients[0].options).toEqual({
    codexPathOverride: "/bin/codex",
    baseUrl: "https://api",
    apiKey: "k",
    config: { a: 1 },
    configOverrides: ["x=1"],
    env: { HOME: "/h" },
  });
  expect(seen.clients[0].started).toEqual([
    {
      model: "m",
      threadSource: "src",
      sandboxMode: "read-only",
      workingDirectory: "/w",
      skipGitRepoCheck: true,
      modelReasoningEffort: "high",
      networkAccessEnabled: false,
      webSearchMode: "cached",
      webSearchEnabled: true,
      approvalPolicy: "never",
      additionalDirectories: ["/d"],
    },
  ]);
  await scope.close();
});

test("a resume binding resumes the thread id", async () => {
  const seen: Seen = { turns: [], clients: [] };
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const scope = createScope({
    presets: [preset(codex.sdk, async () => fakeCodexSdk([readCodexScript()], seen))],
  });
  const session = scope.createSession({ tags: [coder.resume("t-9")] });
  await session.run(ask, { input: "hello" });
  expect(seen.clients.length).toBe(1);
  expect(seen.clients[0].started).toEqual([]);
  expect(seen.clients[0].resumed.length).toBe(1);
  expect(seen.clients[0].resumed[0].id).toBe("t-9");
  await scope.close();
});

test("two turns in one session use one thread", async () => {
  const seen: Seen = { turns: [], clients: [] };
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const scope = createScope({
    presets: [
      preset(codex.sdk, async () => fakeCodexSdk([readCodexScript(), readCodexScript()], seen)),
    ],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "a" });
  await session.run(ask, { input: "b" });
  expect(seen.clients.length).toBe(1);
  expect(seen.clients[0].started.length).toBe(1);
  expect(seen.clients[0].resumed).toEqual([]);
  expect(seen.turns.length).toBe(2);
  await scope.close();
});

test("a failed turn rejects with TurnFailed and the harness turn line says failed", async () => {
  const seen: Seen = { turns: [], clients: [] };
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    presets: [preset(codex.sdk, async () => fakeCodexSdk([readCodexFailure()], seen))],
  });
  const session = scope.createSession();
  const statusSeen: Harness.Status[] = [];
  session.controller(coder.status).watch((next) => statusSeen.push(next));
  const outcome = await session.run(ask, { input: "hello" }).then(
    () => "resolved",
    (error: unknown) => error,
  );
  if (!isError(outcome, "TurnFailed")) throw outcome;
  expect(outcome.payload.harness).toBe("codex");
  expect(statusSeen).toEqual(["running", "failed"]);
  const lines = logs.filter((entry) => entry.message === "harness turn");
  expect(lines.length).toBe(1);
  expect(lines[0].attributes.status).toBe("failed");
  await scope.close();
});

test("a forced close mid-turn rejects the turn and cancels the close", async () => {
  const seen: Seen = { turns: [], clients: [] };
  let release!: () => void;
  const gate = {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    presets: [preset(codex.sdk, async () => fakeCodexSdk([], seen, [gate]))],
  });
  const session = scope.createSession();
  await session.resolve(coder.thread);
  const statusSeen: Harness.Status[] = [];
  session.controller(coder.status).watch((next) => statusSeen.push(next));
  const settled = session.run(ask, { input: "hello" }).then(
    () => "resolved",
    () => "rejected",
  );
  const end = await session.close();
  release();
  expect(await settled).toBe("rejected");
  expect(end.status).toBe("cancelled");
  expect(statusSeen).toEqual(["running"]);
  const lines = logs.filter((entry) => entry.message === "harness turn");
  expect(lines.length).toBe(1);
  expect(lines[0].attributes.status).toBe("cancelled");
  expect(seen.turns[0].turnOptions?.signal?.aborted).toBe(true);
  await scope.close();
});

test("with observe, the turn span carries the adapter and one harness turn line logs done", async () => {
  const seen: Seen = { turns: [], clients: [] };
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    presets: [preset(codex.sdk, async () => fakeCodexSdk([readCodexScript()], seen))],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  const turn = scope.spans().find((span) => span.name === "coder.ask");
  expect(turn?.attributes.adapter).toBe("codex");
  const lines = logs.filter((entry) => entry.message === "harness turn");
  expect(lines.length).toBe(1);
  expect(lines[0].attributes.status).toBe("done");
  expect(lines[0].attributes.harness).toBe("coder");
  await scope.close();
});
