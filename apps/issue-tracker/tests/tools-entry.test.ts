import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const entry = fileURLToPath(new URL("../src/tools/main.ts", import.meta.url));

function startTools() {
  const child = spawn(process.execPath, ["--experimental-strip-types", entry, "mcp"], {
    env: { ...process.env, BASE_URL: "http://127.0.0.1:1" },
    stdio: "pipe",
    signal: AbortSignal.timeout(15_000),
    killSignal: "SIGKILL",
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { child, closed: closed.then((code) => ({ code, stderr })) };
}

async function initialize(child: ChildProcessWithoutNullStreams) {
  const lines = createInterface({ input: child.stdout });
  const ready = once(lines, "line", { signal: AbortSignal.timeout(10_000) });
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "tracker-entry-test", version: "0" },
      },
    })}\n`,
  );
  const [line] = await ready;
  lines.close();
  expect(JSON.parse(line)).toMatchObject({ id: 1, result: { serverInfo: { name: "issues" } } });
}

test("the MCP entry closes cleanly when stdin ends", async () => {
  const { child, closed } = startTools();
  try {
    await initialize(child);
    child.stdin.end();
    expect(await closed).toEqual({ code: 0, stderr: "" });
  } finally {
    child.kill("SIGKILL");
    await closed;
  }
});

test("the MCP entry closes cleanly on SIGTERM", async () => {
  const { child, closed } = startTools();
  try {
    await initialize(child);
    child.kill("SIGTERM");
    expect(await closed).toEqual({ code: 0, stderr: "" });
  } finally {
    child.kill("SIGKILL");
    await closed;
  }
});
