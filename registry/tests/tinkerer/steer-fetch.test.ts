import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { steer, tinkerer } from "../../src/tinkerer/index.ts";

const coder = tinkerer({ label: "coder" });
const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

function serve() {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    request.resume();
    requests.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (requests.length === 1)
      response.write('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n');
    else response.end(answer);
  });
  return { server, requests };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("a steered fetch keeps its response alive until the stream is read", async () => {
  const { server, requests } = serve();
  const baseUrl = await listen(server);
  const scope = createScope({
    tags: [coder.config({ model: "m", baseUrl })],
  });
  const session = scope.createSession();
  const running = session.settle(coder.turn, { input: "start" });
  try {
    await expect.poll(() => session.resolve(coder.text)).toBe("Partial");
    session.controller(coder.inbox).update((entries) => [...entries, steer("switch")]);
    await expect.poll(() => requests.length).toBe(2);
    expect((await running).status).toBe("success");
    expect(session.resolve(coder.messages).slice(0, 3)).toEqual([
      { role: "user", content: "start" },
      { role: "assistant", content: "Partial" },
      { role: "user", content: "switch" },
    ]);
    expect((await session.close({ graceful: true })).status).toBe("success");
  } finally {
    server.closeAllConnections();
    await scope.close();
    await running;
    await close(server);
  }
});

test("forced close cancels a real fetch body and settles its turn", async () => {
  const { server } = serve();
  const baseUrl = await listen(server);
  const scope = createScope({ tags: [coder.config({ model: "m", baseUrl })] });
  const session = scope.createSession();
  const running = session.settle(coder.turn, { input: "start" });
  try {
    await expect.poll(() => session.resolve(coder.text)).toBe("Partial");
    const closing = session.close();
    expect((await running).status).toBe("cancelled");
    expect((await closing).status).toBe("cancelled");
  } finally {
    server.closeAllConnections();
    await scope.close();
    await running;
    await close(server);
  }
});
