import { expect, test } from "vite-plus/test";
import { createScope, namespace, operation, preset } from "@tinker/core";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeCode, harness, type ClaudeCode } from "../src/index.ts";
import { readResult, readSystemInit, readTextDelta, readToolSdk, readToolUse } from "./fixtures.ts";

/** One SDK module serves both agents; each query reports its own id and events. */
test("one relay operation sends to A then B without sharing their thread or cells", async () => {
  const agent = harness({ adapter: claudeCode });
  const a = namespace({ tags: [claudeCode.options({ model: "a" })] });
  const b = namespace({ tags: [claudeCode.options({ model: "b" }), agent.resume("prior-b")] });
  expect(agent.label).toBe("harness");
  const relay = operation({
    label: "relay",
    depends: { send: agent.send },
    run: async ({ send }) => {
      const first = await send.run({ input: { prompt: "A" }, ns: a });
      if (first.subtype !== "success") throw new Error("A failed");
      const second = await send.run({ input: { prompt: `B:${first.result}` }, ns: b });
      if (second.subtype !== "success") throw new Error("B failed");
      return second.result;
    },
  });
  const seen: { prompt: string; model: string | undefined; resume: string | undefined }[] = [];
  const sdk: ClaudeCode.Sdk = {
    ...readToolSdk(),
    query: ({ prompt, options }) => {
      seen.push({ prompt, model: options?.model, resume: options?.resume });
      const id = options?.model === "a" ? "agent-a" : "agent-b";
      const base = readResult(prompt);
      const result = {
        ...base,
        session_id: id,
        usage: { ...base.usage, input_tokens: id === "agent-a" ? 1 : 2 },
      };
      const messages: SDKMessage[] = [
        { ...readSystemInit(), session_id: id },
        { ...readTextDelta(prompt), session_id: id },
        {
          ...readToolUse(),
          session_id: id,
          message: {
            ...readToolUse().message,
            content: [{ type: "tool_use", id: `tool-${id}`, name: "Read", input: {} }],
          },
        },
        result,
      ];
      return (async function* () {
        for (const message of messages) yield message;
      })();
    },
  };
  const scope = createScope({
    observe: { history: 60 },
    presets: [preset(claudeCode.sdk, async () => sdk)],
  });
  const session = scope.createSession();
  const textA: string[] = [];
  const textB: string[] = [];
  session.controller(agent.text, { ns: a }).watch((next) => textA.push(next));
  session.controller(agent.text, { ns: b }).watch((next) => textB.push(next));
  expect(await session.run(relay)).toBe("B:A");
  expect(textA).toEqual(["A"]);
  expect(textB).toEqual(["B:A"]);
  expect(session.resolve(agent.thread, { ns: a })).not.toBe(
    session.resolve(agent.thread, { ns: b }),
  );
  expect(session.resolve(agent.status, { ns: a })).toBe("done");
  expect(session.resolve(agent.status, { ns: b })).toBe("done");
  expect(session.resolve(agent.text, { ns: a })).toBe("A");
  expect(session.resolve(agent.text, { ns: b })).toBe("B:A");
  expect(session.resolve(agent.items, { ns: a })[0]?.id).toBe("tool-agent-a");
  expect(session.resolve(agent.items, { ns: b })[0]?.id).toBe("tool-agent-b");
  expect(session.resolve(agent.id, { ns: a })).toBe("agent-a");
  expect(session.resolve(agent.id, { ns: b })).toBe("agent-b");
  expect(session.resolve(agent.events, { ns: a })[0]).toMatchObject({ session_id: "agent-a" });
  expect(session.resolve(agent.events, { ns: b })[0]).toMatchObject({ session_id: "agent-b" });
  expect(session.resolve(agent.usage, { ns: a })?.input).toBe(1);
  expect(session.resolve(agent.usage, { ns: b })?.input).toBe(2);
  expect(session.resolve(agent.status)).toBe("idle");
  expect(session.resolve(agent.items)).toEqual([]);
  expect(seen).toEqual([
    { prompt: "A", model: "a", resume: undefined },
    { prompt: "B:A", model: "b", resume: "prior-b" },
  ]);
  const spans = scope.spans();
  const relaySpan = spans.find((span) => span.name === "relay");
  const sends = spans.filter((span) => span.name === "harness.send");
  expect(sends).toHaveLength(2);
  expect(sends.map((span) => span.parentId)).toEqual([relaySpan?.id, relaySpan?.id]);
  expect(
    spans.filter((span) => span.name === "harness.thread").map((span) => span.parentId),
  ).toEqual(sends.map((span) => span.id));
  await session.run(relay);
  expect(seen[2]).toEqual({ prompt: "A", model: "a", resume: "agent-a" });
  expect(seen[3]).toEqual({ prompt: "B:A", model: "b", resume: "agent-b" });
  expect(session.resolve(agent.items, { ns: a })).toHaveLength(2);
  expect(session.resolve(agent.items, { ns: b })).toHaveLength(2);
  expect(session.resolve(agent.events, { ns: a })).toHaveLength(8);
  expect(session.resolve(agent.events, { ns: b })).toHaveLength(8);
  await scope.close();
});
