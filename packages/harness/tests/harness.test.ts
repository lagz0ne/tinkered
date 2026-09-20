import { expect, test } from "vite-plus/test";
import { createScope, preset, type Observe } from "@tinker/core";
import type {
  Options,
  SDKMessage,
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeCode, harness, type ClaudeCode, type Harness } from "../src/index.ts";
import { readAssistantText, readScript, type Script, readToolSdk } from "./fixtures.ts";

/** One `query` call a test fake saw: the prompt plus the options it opened with. */
type Seen = { readonly prompt: string; readonly options: Options | undefined };

/** A fake SDK module: each `query` records its call, then yields the next script's messages —
 * checking the call's abort signal before every yield, so a forced close lands mid-turn. With
 * no script left, the stream parks on `gate` instead (for the mid-turn close test). */
function fakeSdk(scripts: Script[], seen: Seen[], gate?: Gate): ClaudeCode.Sdk {
  return {
    ...readToolSdk(),
    query: ({ prompt, options }) => {
      seen.push({ prompt, options });
      const script = scripts.shift();
      const messages = script === undefined ? [] : script.messages;
      return readStream(messages, options?.abortController?.signal, gate);
    },
  };
}

/** A parked stream's release: the test resolves it after the close under test settles. */
type Gate = { readonly promise: Promise<void> };

/** Yield recorded messages, then park on `gate` while given; an abort rejects first. */
async function* readStream(
  messages: readonly SDKMessage[],
  signal: AbortSignal | undefined,
  gate?: Gate,
): AsyncGenerator<SDKMessage> {
  for (const message of messages) {
    checkAborted(signal);
    yield message;
  }
  if (gate === undefined) return;
  checkAborted(signal);
  const abort = new Promise<never>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
  });
  await Promise.race([gate.promise, abort]);
}

/** Throw the signal's reason when an abort already landed — like a real SDK call would. */
function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason;
}

/** Run one turn of `ask` on a scope whose `sdk` resource is the fake scripts. */
function readSetup(scripts: Script[], seen: Seen[]) {
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    presets: [preset(claudeCode.sdk, async () => fakeSdk(scripts, seen))],
  });
  return { coder, ask, scope };
}

test("a turn streams text and fills the ambient cells", async () => {
  const seen: Seen[] = [];
  const script = readScript("Hello");
  const { coder, ask, scope } = readSetup([script], seen);
  const session = scope.createSession();
  const statusSeen: Harness.Status[] = [];
  const textSeen: string[] = [];
  session.controller(coder.status).watch((next) => statusSeen.push(next));
  session.controller(coder.text).watch((next) => textSeen.push(next));
  const result = await session.run(ask, { input: "hello" });
  expect(result).toBe(script.messages[script.messages.length - 1]);
  expect(statusSeen).toEqual(["running", "done"]);
  expect(textSeen).toEqual(["Hel", "Hello"]);
  expect(session.resolve(coder.items)).toEqual([
    { kind: "tool_use", id: "tu-1", status: "started", source: script.messages[3] },
    { kind: "tool_result", id: "tu-1", status: "completed", source: script.messages[4] },
  ]);
  expect(session.resolve(coder.usage)).toEqual({ input: 10, cached: 2, output: 5, cost: 0.01 });
  expect(session.resolve(coder.id)).toBe("s-1");
  expect(session.resolve(coder.events)).toEqual(script.messages);
  expect(seen.length).toBe(1);
  await scope.close();
});

test("two turns in one session resume the first session id", async () => {
  const seen: Seen[] = [];
  const { coder, ask, scope } = readSetup(
    [readScript("one"), readScript("two"), readScript("three")],
    seen,
  );
  const session = scope.createSession();
  await session.run(ask, { input: "a" });
  await session.run(ask, { input: "b" });
  expect(session.resolve(coder.text)).toBe("Hello");
  expect(seen.length).toBe(2);
  expect(seen[0].options?.resume).toBe(undefined);
  expect(seen[1].options?.resume).toBe("s-1");
  const other = scope.createSession();
  await other.run(ask, { input: "c" });
  expect(seen.length).toBe(3);
  expect(seen[2].options?.resume).toBe(undefined);
  await scope.close();
});

test("a resume binding opens the first turn on that id", async () => {
  const seen: Seen[] = [];
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    presets: [preset(claudeCode.sdk, async () => fakeSdk([readScript("hi")], seen))],
  });
  const session = scope.createSession({ tags: [coder.resume("s-9")] });
  await session.run(ask, { input: "hello" });
  expect(seen[0].options?.resume).toBe("s-9");
  await scope.close();
});

test("options merge nearest-first and force partial messages", async () => {
  const seen: Seen[] = [];
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    tags: [claudeCode.options({ model: "a", cwd: "/x" })],
    presets: [preset(claudeCode.sdk, async () => fakeSdk([readScript("hi")], seen))],
  });
  const session = scope.createSession({ tags: [claudeCode.options({ model: "b" })] });
  await session.run(ask, { input: "hello" });
  expect(seen[0].options?.model).toBe("b");
  expect(seen[0].options?.cwd).toBe("/x");
  expect(seen[0].options?.includePartialMessages).toBe(true);
  expect(seen[0].options?.abortController instanceof AbortController).toBe(true);
  await scope.close();
});

test("a forced close mid-turn rejects the turn and cancels the close", async () => {
  const seen: Seen[] = [];
  let release!: () => void;
  const gate = {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    presets: [preset(claudeCode.sdk, async () => fakeSdk([], seen, gate))],
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
  expect(seen[0].options?.abortController?.signal.aborted).toBe(true);
  await scope.close();
});

test("with observe, the turn span carries the adapter and one harness turn line logs done", async () => {
  const seen: Seen[] = [];
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    presets: [preset(claudeCode.sdk, async () => fakeSdk([readScript("hi")], seen))],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  const turn = scope.spans().find((span) => span.name === "coder.ask");
  expect(turn?.attributes.adapter).toBe("claudeCode");
  const lines = logs.filter((entry) => entry.message === "harness turn");
  expect(lines.length).toBe(1);
  expect(lines[0].attributes.status).toBe("done");
  expect(lines[0].attributes.harness).toBe("coder");
  await scope.close();
});

test("a response reader delivers its reading, not the raw result", async () => {
  const seen: Seen[] = [];
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({
    label: "ask",
    request: (prompt: string) => ({ prompt }),
    response: (result) => (result.subtype === "success" ? result.result : "error"),
  });
  const scope = createScope({
    presets: [preset(claudeCode.sdk, async () => fakeSdk([readScript("Hello")], seen))],
  });
  const session = scope.createSession();
  const result: string = await session.run(ask, { input: "hello" });
  expect(result).toBe("Hello");
  await scope.close();
});

test("a stream event that is not a text delta adds no text", async () => {
  const script = readScript("Hello");
  const thinking: SDKPartialAssistantMessage = {
    ...(script.messages[1] as SDKPartialAssistantMessage),
    event: { type: "message_stop" },
  };
  const other: SDKPartialAssistantMessage = {
    ...(script.messages[1] as SDKPartialAssistantMessage),
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "x" },
    },
  };
  const mixed: Script = {
    messages: [script.messages[0], thinking, other, ...script.messages.slice(1)],
  };
  const { coder, ask, scope } = readSetup([mixed], []);
  const session = scope.createSession();
  const textSeen: string[] = [];
  session.controller(coder.text).watch((next) => textSeen.push(next));
  await session.run(ask, { input: "hello" });
  expect(textSeen).toEqual(["Hel", "Hello"]);
  await scope.close();
});

test("an assistant message without a tool call adds no tool item", async () => {
  const script = readScript("Hello");
  const mixed: Script = {
    messages: [script.messages[0], readAssistantText("noted"), ...script.messages.slice(1)],
  };
  const { coder, ask, scope } = readSetup([mixed], []);
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  expect(session.resolve(coder.items).filter((item) => item.kind === "tool_use")).toEqual([
    { kind: "tool_use", id: "tu-1", status: "started", source: script.messages[3] },
  ]);
  await scope.close();
});
