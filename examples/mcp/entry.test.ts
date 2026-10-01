import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const entries = [
  { path: "./serve.ts", args: [] },
  { path: "./cli.ts", args: ["--", "mcp"] },
];

function startServer(entry: { path: string; args: string[] }) {
  const path = fileURLToPath(new URL(entry.path, import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", path, ...entry.args], {
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
        clientInfo: { name: "mcp-entry-test", version: "0" },
      },
    })}\n`,
  );
  const [line] = await ready;
  lines.close();
  expect(JSON.parse(line)).toMatchObject({ id: 1, result: { serverInfo: { name: "coder" } } });
}

test("both stdio entries close cleanly when stdin ends", async () => {
  const exits = [];
  for (const entry of entries) {
    const { child, closed } = startServer(entry);
    try {
      await initialize(child);
      child.stdin.end();
      exits.push(await closed);
    } finally {
      child.kill("SIGKILL");
      await closed;
    }
  }
  expect(exits).toEqual([
    { code: 0, stderr: "" },
    { code: 0, stderr: "" },
  ]);
});

test("both stdio entries close cleanly on SIGTERM", async () => {
  const exits = [];
  for (const entry of entries) {
    const { child, closed } = startServer(entry);
    try {
      await initialize(child);
      child.kill("SIGTERM");
      exits.push(await closed);
    } finally {
      child.kill("SIGKILL");
      await closed;
    }
  }
  expect(exits).toEqual([
    { code: 0, stderr: "" },
    { code: 0, stderr: "" },
  ]);
});
