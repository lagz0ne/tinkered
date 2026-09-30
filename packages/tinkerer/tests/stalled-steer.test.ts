import { readFileSync } from "node:fs";
import { createScope, makeTestClock } from "@tinker/core";
import { backend, config, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { expect, test } from "vite-plus/test";
import { steer, tinkerer } from "../src/index.ts";

const coder = tinkerer({ label: "coder" });
const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));
const partial = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n');

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function stalled() {
  const waiting = deferred<void>();
  const cancelled = deferred<void>();
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        source = controller;
        controller.enqueue(partial);
      },
      pull: () => waiting.resolve(),
      cancel: () => cancelled.resolve(),
    },
    { highWaterMark: 0 },
  );
  return { body, waiting, cancelled, finish: () => source?.error(new Error("cleanup")) };
}

function recording(
  seen: HttpRequest.Record[],
  first: ReadableStream<Uint8Array>,
): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    if (seen.length > 1) expect(first.locked).toBe(false);
    return HttpResponse.make(request, { status: 200, body: seen.length === 1 ? first : answer });
  };
}

test("a steer restarts a stalled stream without waiting for another event", async () => {
  const seen: HttpRequest.Record[] = [];
  const first = stalled();
  const scope = createScope({
    tags: [
      backend(recording(seen, first.body)),
      coder.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  const running = session.settle(coder.turn, { input: "start" });
  try {
    await first.waiting.promise;
    session.controller(coder.inbox).update((entries) => [...entries, steer("switch")]);
    await expect.poll(() => seen.length).toBe(2);
    expect((await running).status).toBe("success");
    await first.cancelled.promise;
    expect(first.body.locked).toBe(false);
    expect(session.resolve(coder.messages).slice(0, 3)).toEqual([
      { role: "user", content: "start" },
      { role: "assistant", content: "Partial" },
      { role: "user", content: "switch" },
    ]);
    expect((await session.close({ graceful: true })).status).toBe("success");
  } finally {
    first.finish();
    await running;
    await scope.close();
  }
});

test("a steer restarts a request while HTTP headers are still pending", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const seen: HttpRequest.Record[] = [];
  const aborted = deferred<void>();
  const held: HttpClient.Backend = (request, signal) => {
    seen.push(request);
    if (seen.length > 1)
      return Promise.resolve(HttpResponse.make(request, { status: 200, body: answer }));
    entered.resolve();
    return new Promise((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted.resolve();
          reject(signal.reason);
        },
        { once: true },
      );
      release.promise.then(
        () => resolve(HttpResponse.make(request, { status: 200, body: answer })),
        reject,
      );
    });
  };
  const scope = createScope({
    tags: [backend(held), coder.config({ model: "m", baseUrl: "https://api" })],
  });
  const session = scope.createSession();
  const running = session.settle(coder.turn, { input: "start" });
  try {
    await entered.promise;
    session.controller(coder.inbox).update((entries) => [...entries, steer("switch")]);
    await expect.poll(() => seen.length).toBe(2);
    await aborted.promise;
    expect((await running).status).toBe("success");
    expect(session.resolve(coder.messages).slice(0, 2)).toEqual([
      { role: "user", content: "start" },
      { role: "user", content: "switch" },
    ]);
    expect((await session.close({ graceful: true })).status).toBe("success");
  } finally {
    release.resolve();
    await running;
    await scope.close();
  }
});

test("a steer cancels an HTTP retry wait before the clock advances", async () => {
  const waiting = deferred<void>();
  const seen: HttpRequest.Record[] = [];
  const clock = makeTestClock();
  const retrying: HttpClient.Backend = async (request) => {
    seen.push(request);
    return HttpResponse.make(request, {
      status: seen.length === 1 ? 503 : 200,
      body: answer,
    });
  };
  const scope = createScope({
    clock,
    tags: [
      backend(retrying),
      config({
        retry: {
          times: 1,
          delay: () => {
            waiting.resolve();
            return 1000;
          },
        },
      }),
      coder.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  const running = session.settle(coder.turn, { input: "start" });
  try {
    await waiting.promise;
    session.controller(coder.inbox).update((entries) => [...entries, steer("switch")]);
    await expect.poll(() => seen.length).toBe(2);
    expect((await running).status).toBe("success");
    expect(session.resolve(coder.messages).slice(0, 2)).toEqual([
      { role: "user", content: "start" },
      { role: "user", content: "switch" },
    ]);
    expect((await session.close({ graceful: true })).status).toBe("success");
  } finally {
    clock.advance(1000);
    await running;
    await scope.close();
  }
});

test("a forced close cancels a stalled stream and settles its turn", async () => {
  const first = stalled();
  const scope = createScope({
    tags: [
      backend(recording([], first.body)),
      coder.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  const running = session.settle(coder.turn, { input: "start" });
  try {
    await first.waiting.promise;
    const closing = session.close();
    await expect.poll(() => first.body.locked).toBe(false);
    await first.cancelled.promise;
    expect((await running).status).toBe("cancelled");
    expect((await closing).status).toBe("cancelled");
  } finally {
    first.finish();
    await running;
    await scope.close();
  }
});
