import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import {
  createIssue,
  issueServer,
  parseIssue,
  parseIssueList,
  publish,
  runServer,
  src,
  store,
  migrateIssues,
} from "../src/index.ts";

async function readFreePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string") return expect.unreachable();
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("the first HTTP read and sync snapshot contain saved issues while the port binds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issues-order-"));
  const path = join(dir, "db");
  const seed = createScope({ tags: [store.config(path)], extensions: [migrateIssues] });
  await seed.ready;
  const saved = await seed
    .session((s) =>
      s.run(createIssue, { input: { title: "Saved before bind", description: "kept on disk" } }),
    )
    .finally(() => seed.close({ graceful: true }));
  let list: unknown;
  let snapshot: unknown;
  const server = issueServer({
    serve: async (app) => {
      list = await (await app.request("/api/issues")).json();
      const response = await app.request("/sync?keys=issues");
      const reader = response.body?.getReader();
      if (reader === undefined) return expect.unreachable();
      const decoder = new TextDecoder();
      let frames = "";
      try {
        while (!frames.includes("data: ") || !frames.endsWith("\n\n")) {
          const chunk = await reader.read();
          if (chunk.done) break;
          frames += decoder.decode(chunk.value);
        }
        const data = frames.split("\n").find((line) => line.startsWith("data: "));
        snapshot = data === undefined ? undefined : JSON.parse(data.slice(6));
      } finally {
        await reader.cancel();
      }
    },
  });
  const scope = createScope({
    tags: [store.config(path)],
    extensions: [server, migrateIssues, src, publish()],
  });
  try {
    await scope.ready;
    expect(list).toEqual([saved]);
    expect(snapshot).toMatchObject({ type: "snapshot", key: "issues", value: [saved] });
  } finally {
    await scope.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("runServer serves saved issues until stop and then answers zero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issues-root-"));
  const port = await readFreePort();
  const base = `http://127.0.0.1:${port}`;
  const stop = new AbortController();
  const ended = runServer(
    { HOST: "127.0.0.1", PORT: String(port), DATA_PATH: join(dir, "db") },
    stop.signal,
  );
  try {
    await expect.poll(async () => (await fetch(`${base}/api/issues`)).status).toBe(200);
    const response = await fetch(`${base}/api/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "From the real root", description: "saved over HTTP" }),
    });
    expect(response.status).toBe(201);
    const saved = parseIssue(await response.json());
    expect(parseIssueList(await (await fetch(`${base}/api/issues`)).json())).toEqual([saved]);
    stop.abort();
    expect(await ended).toBe(0);
  } finally {
    stop.abort();
    await ended;
    await rm(dir, { recursive: true, force: true });
  }
});

test("runServer answers one for a bad PORT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issues-bad-port-"));
  const path = join(dir, "db");
  try {
    expect(await runServer({ PORT: "abc", DATA_PATH: path }, new AbortController().signal)).toBe(1);
    expect(existsSync(path)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
