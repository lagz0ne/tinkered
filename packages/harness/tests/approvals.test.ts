import { expect, test } from "vite-plus/test";
import {
  createScope,
  isError as isCoreError,
  operation,
  originOf,
  preset,
  tag,
} from "@tinker/core";
import type {
  Options,
  PermissionResult,
  SDKConversationResetMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeCode, harness, isError, type ClaudeCode } from "../src/index.ts";
import {
  parsePrompt,
  readResult,
  readSystemInit,
  readToolResult,
  readToolUse,
  readToolSdk,
} from "./fixtures.ts";

/** What one fake turn saw: the decisions the SDK's `canUseTool` got back, and the errors a
 * `real` fake caught from it. */
type Seen = { decisions: PermissionResult[]; errors: unknown[] };

/** How the fake treats a throwing `canUseTool` and an abort. `throw-through` lets the throw out of
 * the stream and ignores the abort. `real` does what `@anthropic-ai/claude-agent-sdk` 0.3.275 does
 * (`sdk.mjs`, `Query.handleControlRequest`): it catches the throw, answers the CLI with an error
 * `control_response`, and keeps streaming; an aborted query stops with the SDK's abort error. */
type Mode = "throw-through" | "real";

/** A fake SDK module whose `query` asks `canUseTool` for `Bash ls` mid-stream, once per tool-use
 * id and all at once, as the CLI asks for parallel tool calls (default one ask, `tu-1`), then
 * yields the tool use, the tool result only when every ask allowed, and the result. */
function fakeSdk(seen: Seen, mode: Mode = "real", toolUseIDs = ["tu-1"]): ClaudeCode.Sdk {
  return {
    ...readToolSdk(),
    query: ({ options }) => readStream(options, seen, mode, toolUseIDs),
  };
}

/** The recorded turn as an SDK stream: init, the permission prompts, then the messages. */
async function* readStream(
  options: Options | undefined,
  seen: Seen,
  mode: Mode,
  toolUseIDs: readonly string[],
): AsyncGenerator<SDKMessage> {
  yield readSystemInit();
  const signal = options?.abortController?.signal ?? new AbortController().signal;
  const decisions = await Promise.all(
    toolUseIDs.map((toolUseID) => readDecision(options, signal, seen, mode, toolUseID)),
  );
  if (mode === "real" && signal.aborted) throw new Error("Claude Code process aborted by user");
  yield readToolUse();
  if (decisions.every((decision) => decision?.behavior === "allow")) yield readToolResult();
  yield readResult("Hello");
}

/** Ask the query's `canUseTool` for `Bash ls` the way the SDK would and keep its decision; null
 * when none is bound, or when a `real` fake caught its throw. */
async function readDecision(
  options: Options | undefined,
  signal: AbortSignal,
  seen: Seen,
  mode: Mode,
  toolUseID: string,
): Promise<PermissionResult | null> {
  const ask = options?.canUseTool;
  if (ask === undefined) return null;
  const asked = ask("Bash", { command: "ls" }, { signal, toolUseID, requestId: `r-${toolUseID}` });
  try {
    const decision = await asked;
    if (decision !== null) seen.decisions.push(decision);
    return decision;
  } catch (error) {
    if (mode === "throw-through") throw error;
    seen.errors.push(error);
    return null;
  }
}

const policy = tag<"allow" | "deny">({ label: "policy", default: "allow" });

const parseApproval = operation({
  label: "parseApproval",
  input: claudeCode.approval,
  run: (_deps, ctx) => ctx.input,
});

test("a raw approval request keeps its tool name and input", () => {
  const request = { toolName: "Read", input: { file_path: "/a" }, options: {} };
  expect(createScope().run(parseApproval, { rawInput: request })).toBe(request);
});

function expectInvalidApproval(raw: unknown): void {
  try {
    createScope().run(parseApproval, { rawInput: raw });
    expect.unreachable();
  } catch (error) {
    if (!isCoreError(error, "DataValidationFailed")) throw error;
    if (!isError(error.payload.cause, "InvalidApproval")) throw error;
    expect(error.payload.cause.payload.harness).toBe("claudeCode");
  }
}

test.each([null, "Read", 1])(
  "a raw approval rejects a request that is not an object: %s",
  (raw) => {
    expectInvalidApproval(raw);
  },
);

test("a raw approval rejects a missing tool name", () => {
  expectInvalidApproval({ input: {} });
});

test.each([null, "file", undefined])("a raw approval rejects a non-record input: %s", (input) => {
  expectInvalidApproval({ toolName: "Read", input });
});

test("a raw approval rejects a non-string tool name", () => {
  expectInvalidApproval({ toolName: 123, input: {} });
});

test("a raw approval rejects a missing input", () => {
  expectInvalidApproval({ toolName: "Read" });
});

test("an approve op that allows answers canUseTool as a subflow of the turn and lands in items", async () => {
  const seen: Seen = { decisions: [], errors: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => ({ behavior: "allow" }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
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
  const send = spans.find((span) => span.name === "coder.send");
  const approval = spans.find((span) => span.name === "approve");
  expect(approval?.parentId).toBe(send?.id);
  await scope.close();
});

test("an approve op that denies stops the tool: no tool result, the deny lands in items", async () => {
  const seen: Seen = { decisions: [], errors: [] };
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
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
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
  const seen: Seen = { decisions: [], errors: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    depends: { policy },
    run: ({ policy }): PermissionResult =>
      policy === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "policy" },
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  await scope.createSession({ tags: [policy("deny")] }).run(ask, { input: "a" });
  await scope.createSession({ tags: [policy("allow")] }).run(ask, { input: "b" });
  expect(seen.decisions.map((decision) => decision.behavior)).toEqual(["deny", "allow"]);
  await scope.close();
});

const modes: Mode[] = ["throw-through", "real"];

test.each(modes)(
  "a failed approval rejects the turn, and the error is not a TurnFailed: %s SDK",
  async (mode) => {
    const seen: Seen = { decisions: [], errors: [] };
    const boom = new Error("policy down");
    const approve = operation({
      label: "approve",
      input: claudeCode.approval,
      run: (): PermissionResult => {
        throw boom;
      },
    });
    const coder = harness({ label: "coder", adapter: claudeCode, approve });
    const ask = operation({
      label: "coder.ask",
      input: parsePrompt,
      depends: { send: coder.send },
      run: async ({ send }, ctx) => {
        const result = await send.run({ input: { prompt: ctx.input } });
        return result;
      },
    });
    const scope = createScope({
      presets: [preset(claudeCode.sdk, async () => fakeSdk(seen, mode))],
    });
    const session = scope.createSession();
    const outcome = await session.run(ask, { input: "hello" }).then(
      () => "resolved",
      (error: unknown) => error,
    );
    expect(outcome).toBe(boom);
    if (isError(outcome, "TurnFailed")) throw new Error("an approval throw reads as TurnFailed");
    await scope.close();
  },
);

test("no tool runs after a failed approval: the SDK hears a deny", async () => {
  const seen: Seen = { decisions: [], errors: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => {
      throw new Error("policy down");
    },
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  const session = scope.createSession();
  await expect(session.run(coder.send, { input: { prompt: "hello" } })).rejects.toThrow();
  expect(seen.decisions.map((decision) => decision.behavior)).toEqual(["deny"]);
  expect(session.resolve(coder.items).filter((item) => item.kind === "tool_result")).toEqual([]);
  await scope.close();
});

test("an approval still running when another fails answers deny and lands no allow item", async () => {
  const seen: Seen = { decisions: [], errors: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: async (_deps, ctx): Promise<PermissionResult> => {
      const { options } = ctx.input;
      if (options.toolUseID === "tu-1") ctx.raise("PolicyDown", { tool: ctx.input.toolName });
      await new Promise((resolve) => {
        options.signal.addEventListener("abort", resolve, { once: true });
      });
      return { behavior: "allow" };
    },
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const scope = createScope({
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen, "real", ["tu-1", "tu-2"]))],
  });
  const session = scope.createSession();
  const outcome = await session.run(coder.send, { input: { prompt: "hello" } }).then(
    () => "resolved",
    (error: unknown) => error,
  );
  expect(outcome).toMatchObject({ kind: "PolicyDown" });
  expect(seen.decisions.map((decision) => decision.behavior)).toEqual(["deny", "deny"]);
  expect(session.resolve(coder.items).filter((item) => item.status === "allow")).toEqual([]);
  await scope.close();
});

test("a forced close while the SDK waits on canUseTool settles the close cancelled", async () => {
  const asked: string[] = [];
  const coder = harness({ label: "coder", adapter: claudeCode });
  const scope = createScope({
    tags: [
      claudeCode.options({
        canUseTool: (toolName, _input, { signal }) => {
          asked.push(toolName);
          return new Promise((resolve) => {
            const deny = (): void => resolve({ behavior: "deny", message: "closed" });
            signal.addEventListener("abort", deny, { once: true });
          });
        },
      }),
    ],
    presets: [preset(claudeCode.sdk, async () => fakeSdk({ decisions: [], errors: [] }))],
  });
  const session = scope.createSession();
  const settled = session.run(coder.send, { input: { prompt: "hello" } }).then(
    () => "resolved",
    () => "rejected",
  );
  await expect.poll(() => asked).toEqual(["Bash"]);
  expect((await session.close()).status).toBe("cancelled");
  expect(await settled).toBe("rejected");
  await scope.close();
});

const panics = operation({
  label: "approve",
  input: claudeCode.approval,
  run: (): PermissionResult => {
    throw new Error("policy down");
  },
});

const raises = operation({
  label: "approve",
  input: claudeCode.approval,
  run: (_deps, ctx): PermissionResult => ctx.raise("PolicyDown", { tool: ctx.input.toolName }),
});

const failures = [
  { failure: "a managed error", approve: raises, close: "success" },
  { failure: "a panic", approve: panics, close: "failed" },
];

test.each(failures)(
  "an approval that fails with $failure rejects the turn with it; the session closes $close",
  async ({ approve, close }) => {
    const coder = harness({ label: "coder", adapter: claudeCode, approve });
    const scope = createScope({
      presets: [preset(claudeCode.sdk, async () => fakeSdk({ decisions: [], errors: [] }))],
    });
    const session = scope.createSession();
    const outcome = await session.run(coder.send, { input: { prompt: "hello" } }).then(
      () => "resolved",
      (error: unknown) => error,
    );
    expect(originOf(outcome)).toMatchObject({ label: "approve" });
    expect((await session.close({ graceful: true })).status).toBe(close);
    await scope.close();
  },
);

test("the approval item keeps the request and the decision as its source", async () => {
  const seen: Seen = { decisions: [], errors: [] };
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => ({ behavior: "allow", updatedInput: { command: "ls -l" } }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve });
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
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
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
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
    presets: [preset(claudeCode.sdk, async () => fakeSdk({ decisions: [], errors: [] }))],
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
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
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
    presets: [preset(claudeCode.sdk, async () => fakeSdk({ decisions: [], errors: [] }))],
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
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
  const scope = createScope({
    presets: [
      preset(claudeCode.sdk, async () => ({
        ...readToolSdk(),
        query: async function* () {
          yield readSystemInit();
          yield reset;
          yield readToolUse();
          yield readToolResult();
          yield readResult("Hello");
        },
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
