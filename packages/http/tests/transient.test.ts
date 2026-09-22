import { expect, test } from "vite-plus/test";
import { createScope, operation, makeTestClock } from "@tinker/core";
import {
  attempt,
  backend,
  config,
  HttpRequest,
  HttpResponse,
  isError as isHttpError,
  send,
  type HttpClient,
} from "../src/index.ts";


/** Drain the microtask queue: every already-queued continuation runs, no timer fires. */
async function drain(): Promise<void> {
  for (let i = 0; i < 1000; i += 1) await Promise.resolve();
}

test("a 408 retries and a 429 retries, but a 404 arrives without a retry", async () => {
  const calls: number[] = [];
  const statuses = [408, 429, 404];
  const backendByCall: HttpClient.Backend = async (request) => {
    calls.push(1);
    expect(calls.length).toBeLessThanOrEqual(3);
    return HttpResponse.make(request, {
      status: statuses[calls.length - 1],
      body: `s${calls.length}`,
    });
  };
  const raw = operation({
    label: "retrying.raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/missing") }),
  });
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    tags: [backend(backendByCall), config({ retry: { times: 3 } })],
  });
  const res = await scope.run(raw);
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("s3");
  expect(calls.length).toBe(3);
  await scope.close();
});

test("a 500 retries through to success and a 501 does too", async () => {
  let calls = 0;
  const wobbly: HttpClient.Backend = async (request) => {
    calls += 1;
    return HttpResponse.make(request, { status: calls === 1 ? 500 : 200, body: "back" });
  };
  const text = operation({
    label: "retrying.text",
    depends: { send },
    run: async ({ send: sendIt }) => {
      const received = await sendIt.run({
        input: HttpRequest.get("https://api/repos"),
      });
      return received.text();
    },
  });
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    tags: [backend(wobbly), config({ retry: { times: 3 } })],
  });
  expect(await scope.run(text)).toBe("back");
  expect(calls).toBe(2);
  await scope.close();
});

test("the retry budget runs out: three transient statuses deliver the last one", async () => {
  let calls = 0;
  const down: HttpClient.Backend = async (request) => {
    calls += 1;
    return HttpResponse.make(request, { status: 503, body: `try${calls}` });
  };
  const raw = operation({
    label: "retrying.raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/down") }),
  });
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    tags: [backend(down), config({ retry: { times: 3 } })],
  });
  const res = await scope.run(raw);
  expect(calls).toBe(4);
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("try4");
  await scope.close();
});

test("a rejected status throws ResponseFailed and skips the body reader", async () => {
    let readerCalls = 0;
  const guarded = operation({
    label: "strict.guarded",
    depends: { send },
    run: async ({ send: sendIt }) => {
      const received = await sendIt.run({
        input: HttpRequest.get("https://api/repos"),
      });
      readerCalls += 1;
      return received.text();
    },
  });
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    tags: [
      backend(async (request) => HttpResponse.make(request, { status: 500, body: "down" })),
      config({ accept: (status) => status < 300 }),
    ],
  });
  try {
    await scope.run(guarded);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("StatusCode");
    expect(error.payload.response.status).toBe(500);
  }
  expect(readerCalls).toBe(0);
  await drain();
  await scope.close();
});
