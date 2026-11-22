import { createScope, isError as isCoreError } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
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

/** Runs one request on a root made with `options`, and gives back its settled result. */
const request = async (
  options: Pick<NonNullable<Parameters<typeof createScope>[0]>, "tags" | "observe">,
  rawInput: Record<string, string> = { url: "https://api.example/x?q=1", method: "GET" },
) => {
  const app = createScope({ tags: options.tags, observe: options.observe });
  await app.ready;
  const result = await app.settle(httpRequest, { rawInput: { body: "hi", ...rawInput } });
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

  const result = await request(
    { tags: [httpBackend(fake.send)] },
    { url: "https://api.example/x?q=1", method: "post" },
  );

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
    const result = await request({
      tags: [httpBackend(backend(() => Promise.reject(cause)).send)],
    });
    if (result.status !== "failed") throw new Error(`not a failure: ${result.status}`);
    if (isError(result.error, "MainClosedMissing")) throw result.error;
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
    const result = request({ tags: [httpBackend(waiting.send), stop(controller.signal)] });
    await until(() => expect(waiting.calls.length).toBe(names.length + 1));

    controller.abort();
    const ended = await result;

    if (ended.status !== "failed") throw new Error(`not a failure: ${ended.status}`);
    if (!isError(ended.error, "HttpRequestFailed")) throw ended.error;
    names.push(ended.error.payload.cause?.name);
  }

  expect(names).toEqual(["AbortError", "AbortError"]);
});

test("a URL that is not http(s), or a method that is not a token, is bad input; nothing is sent", async () => {
  const fake = backend(async () => new Response("ok"));
  const bad = [
    { url: "ftp://api.example/x", method: "GET" },
    { url: "httpx://api.example/x", method: "GET" },
    { url: "xhttp://api.example/x", method: "GET" },
    { url: "https://api.example/x", method: "G(T" },
  ];

  const plain = await request(
    { tags: [httpBackend(fake.send)] },
    { url: "http://a.example/x", method: "GET" },
  );
  const kinds: unknown[] = [];
  for (const input of bad) {
    const result = await request({ tags: [httpBackend(fake.send)] }, input);
    if (result.status !== "failed") throw new Error(`not a failure: ${input.url} ${input.method}`);
    if (!isCoreError(result.error, "DataValidationFailed")) throw result.error;
    kinds.push(result.error.kind);
  }

  expect(plain.status).toBe("success");
  expect(kinds).toHaveLength(bad.length);
  expect(fake.calls.map(({ url }) => url)).toEqual(["http://a.example/x"]);
});

test("a stop that already fired sends nothing", async () => {
  const fake = backend(async () => new Response("ok"));
  const stopped = AbortSignal.abort();

  const result = await request({ tags: [httpBackend(fake.send), requestStop(stopped)] });

  if (result.status !== "failed") throw new Error(`not a failure: ${result.status}`);
  if (!isError(result.error, "HttpRequestFailed")) throw result.error;
  expect(fake.calls).toEqual([]);
});

test("a caller that cancels the wait gets a cancelled run, not HttpRequestFailed", async () => {
  const waiting = backend(
    (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      ),
  );
  const app = createScope({ tags: [httpBackend(waiting.send)] });
  await app.ready;
  const caller = new AbortController();
  const result = app.settle(httpRequest, {
    rawInput: { url: "https://api.example/x", method: "GET" },
    signal: caller.signal,
  });
  await until(() => expect(waiting.calls).toHaveLength(1));

  caller.abort();

  expect((await result).status).toBe("cancelled");
  await app.close();
});

test("the request's span names its method, path and status", async () => {
  const spans: Observe.Span[] = [];
  const fake = backend(async () => new Response("ok", { status: 201 }));

  const result = await request({
    observe: { export: (span) => void spans.push(span) },
    tags: [httpBackend(fake.send)],
  });

  expect(result.status).toBe("success");
  expect(spans.find((span) => span.name === "http.request")?.attributes).toEqual({
    "http.request.method": "GET",
    "url.path": "/x",
    "http.response.status_code": 201,
  });
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
