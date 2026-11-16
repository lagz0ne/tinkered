import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { backendStop, httpBackend, httpRequest, isError, requestStop } from "@/server";

/** A fake backend: it records each call and answers with what the test gives it. */
const backend = (answer: (url: string, init?: RequestInit) => Promise<Response>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const send = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    return answer(url, init);
  };
  return { calls, send };
};

/** Runs one request on a root with `tags`, and gives back its settled result. */
const request = async (
  tags: NonNullable<Parameters<typeof createScope>[0]>["tags"],
  method = "GET",
) => {
  const app = createScope({ tags });
  await app.ready;
  const result = await app.settle(httpRequest, {
    rawInput: { url: "https://api.example/x?q=1", method, body: "hi" },
  });
  await app.close();
  return result;
};

test("an HTTP status is a result, and each set-cookie header stays its own", async () => {
  const fake = backend(async () => {
    const headers = new Headers([
      ["set-cookie", "a=1"],
      ["set-cookie", "b=2"],
      ["x-one", "1"],
    ]);
    return new Response("nope", { status: 404, headers });
  });

  const result = await request([httpBackend(fake.send)], "post");

  if (result.status !== "success") throw new Error(`not a success: ${result.status}`);
  expect(result.value).toEqual({
    status: 404,
    headers: { "set-cookie": ["a=1", "b=2"], "x-one": ["1"] },
    body: "nope",
  });
  expect(fake.calls.map(({ url, init }) => [url, init?.method, init?.body])).toEqual([
    ["https://api.example/x?q=1", "POST", "hi"],
  ]);
});

test("a send failure raises HttpRequestFailed with the cause's name and code", async () => {
  const refused = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
  const nested = new TypeError("fetch failed", { cause: { name: "SocketError", code: 54 } });
  const causes = [refused, nested, "not an object"];

  const payloads: unknown[] = [];
  for (const cause of causes) {
    const result = await request([httpBackend(backend(() => Promise.reject(cause)).send)]);
    if (result.status !== "failed") throw new Error(`not a failure: ${result.status}`);
    if (!isError(result.error, "HttpRequestFailed")) throw result.error;
    payloads.push(result.error.payload);
  }

  expect(payloads).toEqual([
    { method: "GET", path: "/x", cause: { name: "Error", code: "ECONNREFUSED" } },
    { method: "GET", path: "/x", cause: { name: "SocketError", code: 54 } },
    { method: "GET", path: "/x" },
  ]);
});

test("backendStop and requestStop each end a wait for the reply", async () => {
  const waiting = backend(
    (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      ),
  );

  const names: unknown[] = [];
  for (const stop of [backendStop, requestStop]) {
    const controller = new AbortController();
    const result = request([httpBackend(waiting.send), stop(controller.signal)]);
    await until(() => expect(waiting.calls.length).toBe(names.length + 1));

    controller.abort();
    const ended = await result;

    if (ended.status !== "failed") throw new Error(`not a failure: ${ended.status}`);
    if (!isError(ended.error, "HttpRequestFailed")) throw ended.error;
    names.push(ended.error.payload.cause?.name);
  }

  expect(names).toEqual(["AbortError", "AbortError"]);
});

/** Polls a check every 5 ms until it passes, for at most a second. */
async function until(check: () => void) {
  for (const started = Date.now(); ; await Bun.sleep(5)) {
    try {
      return check();
    } catch (error) {
      if (Date.now() - started > 1000) throw error;
    }
  }
}
