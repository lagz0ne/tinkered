import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(
  readFileSync(
    join(
      homedir(),
      ".local/share/tinker-writer-trial",
      process.env.TRIAL_NAME ?? "readiness",
      "manifest.json",
    ),
  ),
);
const worker = manifest.workers[0];
const original = JSON.parse(readFileSync(join(worker.dir, ".pi/extensions/trial/worker.json")));

async function harness(limits) {
  const dir = mkdtempSync(join(tmpdir(), "writer-limits-"));
  for (const file of ["extension.mjs", "broker.mjs"])
    copyFileSync(new URL(file, import.meta.url), join(dir, file));
  writeFileSync(
    join(dir, "worker.json"),
    JSON.stringify({
      ...original,
      events: join(dir, "events.jsonl"),
      limits: { ...original.limits, disabled: false, ...limits },
    }),
  );
  const events = {};
  let active = [];
  let aborted = false;
  const context = {
    abort: async () => {
      aborted = true;
    },
  };
  const registered = new Map();
  const pi = {
    registerTool(tool) {
      registered.set(tool.name, tool);
    },
    on(name, fn) {
      events[name] = fn;
    },
    setActiveTools(names) {
      active = names;
    },
  };
  (await import(pathToFileURL(join(dir, "extension.mjs")))).default(pi);
  events.session_start({}, context);
  return {
    events,
    context,
    active: () => active,
    tool: (name) => registered.get(name),
    aborted: () => aborted,
    close() {
      events.session_shutdown();
      execFileSync("docker", ["start", worker.container]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

await test("worker tools exclude host tools and inherited context", async () => {
  const h = await harness({});
  try {
    assert.deepEqual(h.active(), ["work_shell", "jev"]);
    const block = await h.events.tool_call({ toolName: "bash" }, h.context);
    assert.equal(block.block, true);
    assert.equal(block.terminate, true);
    const prompt = h.events.before_agent_start({ systemPrompt: "SECRET_EXAMPLE" });
    assert.equal(prompt.systemPrompt.includes("SECRET_EXAMPLE"), false);
  } finally {
    h.close();
  }
});

await test("tool limit stops the container and aborts the agent", async () => {
  const h = await harness({ toolCalls: 0 });
  try {
    const block = await h.events.tool_call({ toolName: "work_shell" }, h.context);
    assert.equal(block.block, true);
    assert.equal(h.aborted(), true);
    assert.equal(
      execFileSync("docker", ["inspect", worker.container, "--format", "{{.State.Running}}"], {
        encoding: "utf8",
      }).trim(),
      "false",
    );
  } finally {
    h.close();
  }
});

await test("completed usage above the budget stops further turns", async () => {
  const h = await harness({ tokens: 10 });
  try {
    await h.events.turn_end(
      { message: { usage: { totalTokens: 11, cost: { total: 0.01 } } } },
      h.context,
    );
    assert.equal(h.aborted(), true);
  } finally {
    h.close();
  }
});

await test("wall clock stops the container without a model response", async () => {
  const h = await harness({ seconds: 0.01 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(h.aborted(), true);
  } finally {
    h.close();
  }
});

await test("disabled budgets allow work beyond token, tool, turn, cost and time thresholds", async () => {
  const h = await harness({
    disabled: true,
    seconds: 0.01,
    toolCalls: 0,
    modelTurns: 0,
    tokens: 0,
    estimatedDollars: 0,
  });
  try {
    assert.equal(await h.events.tool_call({ toolName: "work_shell" }, h.context), undefined);
    await h.events.turn_end(
      { message: { usage: { totalTokens: 999999, cost: { total: 10 } } } },
      h.context,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(h.aborted(), false);
    const result = await h.tool("work_shell").execute("disabled-probe", { command: "true" });
    assert.equal(result.details.code, 0);
    assert.equal(await h.events.tool_call({ toolName: "jev" }, h.context), undefined);
  } finally {
    h.close();
  }
});
