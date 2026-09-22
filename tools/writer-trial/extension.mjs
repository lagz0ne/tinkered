import { readFileSync } from "node:fs";
import { createBroker } from "./broker.mjs";

function tokenCount(usage) {
  return (
    usage.totalTokens ??
    [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    )
  );
}

function limitReached(config, turns, tokens, cost) {
  return (
    turns >= config.limits.modelTurns ||
    tokens >= config.limits.tokens ||
    cost >= config.limits.estimatedDollars
  );
}

export default function (pi) {
  const config = JSON.parse(readFileSync(new URL("./worker.json", import.meta.url)));
  const broker = createBroker(config);
  const tools = ["work_shell", "jev"];
  let timer;
  const deadline = Date.now() + config.limits.seconds * 1000;
  let turns = 0;
  let tokens = 0;
  let cost = 0;
  let toolCalls = 0;
  let stopped = false;
  const stop = async (ctx, reason) => {
    if (stopped) return;
    stopped = true;
    broker.log({ kind: "stop", reason, tokens, estimatedCost: cost });
    try {
      broker.stop();
    } finally {
      await ctx.abort();
    }
  };
  pi.registerTool({
    name: "work_shell",
    label: "Worker shell",
    description:
      "Run shell commands in your isolated /work project. Use this to read, edit, build, and test. No network or host files. Commands time out after 120 seconds.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number", minimum: 1, maximum: 120 },
      },
      required: ["command"],
      additionalProperties: false,
    },
    async execute(id, params, signal) {
      const r = await broker.shell(params.command, signal, params.timeout);
      return { content: [{ type: "text", text: JSON.stringify(r) }], details: r };
    },
  });
  pi.registerTool({
    name: "jev",
    label: "Jev check",
    description:
      "Ask teacher-selected Jev judges about one src/ or tests/ TypeScript file. Advisory; fix or explain findings. Errors are unavailable checks, never a pass.",
    parameters: {
      type: "object",
      properties: { file: { type: "string" } },
      required: ["file"],
      additionalProperties: false,
    },
    async execute(id, params, signal) {
      const r = await broker.jev(params.file, signal);
      return { content: [{ type: "text", text: JSON.stringify(r) }], details: {} };
    },
  });
  pi.on("session_start", (_event, ctx) => {
    pi.setActiveTools(tools);
    timer = setTimeout(() => {
      stop(ctx, "wall-clock limit").catch(() => {});
    }, config.limits.seconds * 1000);
    timer.unref();
    broker.log({ kind: "session-start", allowedTools: tools, limits: config.limits });
  });
  pi.on("before_agent_start", (_event, ctx) => {
    if (!timer) {
      timer = setTimeout(
        () => {
          stop(ctx, "wall-clock limit").catch(() => {});
        },
        Math.max(1, deadline - Date.now()),
      );
      timer.unref();
    }
    return {
      systemPrompt:
        "You are a coding worker in a controlled trial. Your entire project is /work inside work_shell. Only work_shell and jev are available. Read /work/TASK.md and /work/GUIDELINES.md when asked to implement. Do not seek outside examples or other writers. Use public @tinker/core and @tinker/react APIs. Report real check results and blockers honestly. Jev is advice, not a pass gate. Stop after the requested task; do not invent later tasks. There is no host filesystem access. The teacher controls all limits and scoring.",
    };
  });
  pi.on("tool_call", async (event, ctx) => {
    toolCalls++;
    if (!tools.includes(event.toolName))
      return { block: true, terminate: true, reason: "Tool unavailable in this trial" };
    if (stopped || toolCalls > config.limits.toolCalls) {
      await stop(ctx, "tool-call limit");
      return { block: true, terminate: true, reason: "Trial limit reached" };
    }
  });
  pi.on("turn_end", async (event, ctx) => {
    turns++;
    const usage = event.message?.usage;
    if (usage) {
      tokens += tokenCount(usage);
      cost += usage.cost?.total ?? 0;
    }
    broker.log({ kind: "turn", turn: turns, usage: usage ?? null, tokens, estimatedCost: cost });
    if (limitReached(config, turns, tokens, cost)) await stop(ctx, "turn/token/cost limit");
  });
  pi.on("agent_end", () => {
    clearTimeout(timer);
    timer = undefined;
    broker.log({ kind: "agent-end", turns, tokens, estimatedCost: cost });
  });
  pi.on("session_shutdown", () => clearTimeout(timer));
}
