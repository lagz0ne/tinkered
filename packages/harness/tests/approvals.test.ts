import { expect, test } from "vite-plus/test";
import { createScope, operation, preset, tag } from "@tinker/core";
import type {
  Options,
  PermissionResult,
  SDKConversationResetMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeCode, harness, isError, type ClaudeCode } from "../src/index.ts";
import {
  readResult,
  readSystemInit,
  readToolResult,
  readToolUse,
  readToolSdk,
} from "./fixtures.ts";

/** What one fake turn saw: the decision the SDK's `canUseTool` got back, if it was asked. */
type Seen = { decisions: PermissionResult[] };

/** A fake SDK module whose `query` asks `canUseTool` for `Bash ls` mid-stream (tool-use id
 * `tu-1`), then yields the tool use, the tool result only when allowed, and the result. */
function fakeSdk(seen: Seen): ClaudeCode.Sdk {
  return { ...readToolSdk(), query: ({ options }) => readStream(options, seen) };
}

/** The recorded turn as an SDK stream: init, the permission prompt, then the messages. */
async function* readStream(options: Options | undefined, seen: Seen): AsyncGenerator<SDKMessage> {
  yield readSystemInit();
  const decision = await readDecision(options);
  if (decision !== null) seen.decisions.push(decision);
  yield readToolUse();
  if (decision?.behavior === "allow") yield readToolResult();
  yield readResult("Hello");
}

/** Ask the query's `canUseTool` for `Bash ls` the way the SDK would; null when none is bound. */
async function readDecision(options: Options | undefined): Promise<PermissionResult | null> {
  const ask = options?.canUseTool;
  if (ask === undefined) return null;
  const signal = options?.abortController?.signal ?? new AbortController().signal;
  return ask("Bash", { command: "ls" }, { signal, toolUseID: "tu-1", requestId: "r-1" });
}

const policy = tag<"allow" | "deny">({ label: "policy", default: "allow" });

test("an approve op that allows answers canUseTool as a subflow of the turn and lands in items", async () => {
  const seen: Seen = { decisions: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => ({ behavior: "allow" }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    observe: { history: 20 },
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  const session = scope.createSession();
  const result = await session.run(ask, { input: "hello" });
  expect(result.type).toBe("result");
  expect(seen.decisions).toEqual([{ behavior: "allow" }]);
  const items = session.resolve(coder.items);
  expect(items[0]).toMatchObject({ kind: "approval", id: "tu-1", status: "allow" });
  expect(items[1]).toMatchObject({ kind: "tool_use", id: "tu-1" });
  expect(items[2]).toMatchObject({ kind: "tool_result", id: "tu-1" });
  const spans = scope.spans();
  const turn = spans.find((span) => span.name === "coder.ask");
  const approval = spans.find((span) => span.name === "approve");
  expect(approval?.parentId).toBe(turn?.id);
  await scope.close();
});

test("an approve op that denies stops the tool: no tool result, the deny lands in items", async () => {
  const seen: Seen = { decisions: [] };
  const requests: ClaudeCode.Approval[] = [];
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (_deps, ctx): PermissionResult => {
      requests.push(ctx.input);
      return { behavior: "deny", message: "no" };
    },
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  expect(requests[0].toolName).toBe("Bash");
  expect(requests[0].input.command).toBe("ls");
  const items = session.resolve(coder.items);
  expect(items.map((item) => item.kind)).toEqual(["approval", "tool_use"]);
  expect(items[0].status).toBe("deny");
  await scope.close();
});

test("the approve op sees the session's own bindings: one session allows, another denies", async () => {
  const seen: Seen = { decisions: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    depends: { policy },
    run: ({ policy }): PermissionResult =>
      policy === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "policy" },
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  await scope.createSession({ tags: [policy("deny")] }).run(ask, { input: "a" });
  await scope.createSession({ tags: [policy("allow")] }).run(ask, { input: "b" });
  expect(seen.decisions.map((decision) => decision.behavior)).toEqual(["deny", "allow"]);
  await scope.close();
});

test("a failed approval rejects the turn, and the error is not a TurnFailed", async () => {
  const seen: Seen = { decisions: [] };
  const boom = new Error("policy down");
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => {
      throw boom;
    },
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  const session = scope.createSession();
  const outcome = await session.run(ask, { input: "hello" }).then(
    () => "resolved",
    (error: unknown) => error,
  );
  expect(outcome).toBe(boom);
  if (isError(outcome, "TurnFailed")) throw new Error("an approval throw reads as TurnFailed");
  await scope.close();
});

test("the approval item keeps the request and the decision as its source", async () => {
  const seen: Seen = { decisions: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => ({ behavior: "allow", updatedInput: { command: "ls -l" } }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  const items = session.resolve(coder.items);
  if (
    typeof items[0].source !== "object" ||
    items[0].source === null ||
    !("result" in items[0].source)
  )
    throw new Error("approval item changed shape");
  expect(items[0].source.result).toEqual({
    behavior: "allow",
    updatedInput: { command: "ls -l" },
  });
  expect(seen.decisions).toEqual([{ behavior: "allow", updatedInput: { command: "ls -l" } }]);
  await scope.close();
});

test("without an approve op a canUseTool bound in options still answers", async () => {
  const bound: PermissionResult[] = [];
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    tags: [
      claudeCode.options({
        canUseTool: async () => {
          const decision: PermissionResult = { behavior: "allow" };
          bound.push(decision);
          return decision;
        },
      }),
    ],
    presets: [preset(claudeCode.sdk, async () => fakeSdk({ decisions: [] }))],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  expect(bound).toEqual([{ behavior: "allow" }]);
  expect(session.resolve(coder.items).filter((item) => item.kind === "approval")).toEqual([]);
  await scope.close();
});

test("an approve op overrides a canUseTool bound in options", async () => {
  const bound: PermissionResult[] = [];
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => ({ behavior: "deny", message: "frame" }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    tags: [
      claudeCode.options({
        canUseTool: async () => {
          const decision: PermissionResult = { behavior: "allow" };
          bound.push(decision);
          return decision;
        },
      }),
    ],
    presets: [preset(claudeCode.sdk, async () => fakeSdk({ decisions: [] }))],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  expect(bound).toEqual([]);
  const items = session.resolve(coder.items).filter((item) => item.kind === "approval");
  expect(items.length).toBe(1);
  expect(items[0]).toMatchObject({ kind: "approval", id: "tu-1", status: "deny" });
  await scope.close();
});

test("an unknown message kind still lands in events and the turn resolves", async () => {
  const reset: SDKConversationResetMessage = {
    type: "conversation_reset",
    new_conversation_id: "22222222-2222-4333-8444-555555555555",
    session_id: "s-1",
    uuid: "11111111-2222-4333-8444-555555555555",
  };
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    presets: [
      preset(claudeCode.sdk, async () => ({
        ...readToolSdk(),
        query: () => readResetStream(reset),
      })),
    ],
  });
  const session = scope.createSession();
  const result = await session.run(ask, { input: "hello" });
  expect(result.type).toBe("result");
  expect(session.resolve(coder.events)).toEqual([
    readSystemInit(),
    reset,
    readToolUse(),
    readToolResult(),
    readResult("Hello"),
  ]);
  await scope.close();
});

/** The recorded turn with a `conversation_reset` mid-stream: unknown kinds emit and continue. */
async function* readResetStream(reset: SDKMessage): AsyncGenerator<SDKMessage> {
  yield readSystemInit();
  yield reset;
  yield readToolUse();
  yield readToolResult();
  yield readResult("Hello");
}
