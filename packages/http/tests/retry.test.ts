import { expect, test } from "vite-plus/test";
import { createScope, operation, makeTestClock, namespace } from "@tinker/core";
import {
  backend,
  config,
  HttpRequest,
  HttpResponse,
  isError as isHttpError,
  send,
  type HttpClient,
} from "../src/index.ts";

const flakyRetry = { times: 2, delay: (n: number) => n * 1000 };
const retryingRetry = { times: 2 };
const github = namespace({ tags: config({ baseUrl: "https://api.github.com" }) });

const flakyText = operation({
  label: "flaky.text",
  depends: { send },
  run: async ({ send: sendIt }) => {
    const received = await sendIt.run({
      input: HttpRequest.get("https://api/repos"),
    });
    return received.text();
  },
});

const retryingText = operation({
  label: "retrying.text",
  depends: { send },
  run: async ({ send: sendIt }) => {
    const received = await sendIt.run({
      input: HttpRequest.get("https://api/repos"),
    });
    return received.text();
  },
});

const retryingRaw = operation({
  label: "retrying.raw",
  depends: { send },
  run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/missing") }),
});

const plainText = operation({
  label: "plain.text",
  depends: { send },
  run: async ({ send: sendIt }) => {
    const received = await sendIt.run({
      input: HttpRequest.get("https://api/repos"),
    });
    return received.text();
  },
});

/** Let queued microtasks run until `ready` holds; a stuck backend fails the next assert, never hangs. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !ready(); i += 1) await Promise.resolve();
}

/** Drain the microtask queue: every already-queued continuation runs, no timer fires. */
async function drain(): Promise<void> {
  for (let i = 0; i < 1000; i += 1) await Promise.resolve();
}

test("two failures then success waits 1s then 2s and leaves one span per attempt", async () => {
  const boom = new Error("boom");
  let calls = 0;
  const failing: HttpClient.Backend = async (request) => {
    calls += 1;
    if (calls < 3) throw boom;
    return HttpResponse.make(request, { status: 200, body: "[]" });
  };
  const clock = makeTestClock({ now: 0 });
  const scope = createScope({
    clock,
    observe: { history: 20 },
    tags: [backend(failing), config({ retry: flakyRetry })],
  });
  const running = scope.run(flakyText);
  await until(() => calls === 1);
  expect(calls).toBe(1);
  await drain();
  clock.advance(1000);
  await until(() => calls === 2);
  expect(calls).toBe(2);
  await drain();
  clock.advance(2000);
  expect(await running).toBe("[]");
  expect(calls).toBe(3);
  const kids = scope.spans().filter((span) => span.name === "http.attempt");
  expect(kids.map((span) => span.attributes.attempt)).toEqual([1, 2, 3]);
  expect(kids.map((span) => span.status)).toEqual(["failed", "failed", "ok"]);
  await scope.close();
});

test("a 503 then a 200 resolves after one retry and the 503 span stays ok", async () => {
  let calls = 0;
  const wobbly: HttpClient.Backend = async (request) => {
    calls += 1;
    return HttpResponse.make(request, { status: calls === 1 ? 503 : 200, body: "back" });
  };
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    observe: { history: 20 },
    tags: [backend(wobbly), config({ retry: retryingRetry })],
  });
  expect(await scope.run(retryingText)).toBe("back");
  expect(calls).toBe(2);
  const kids = scope.spans().filter((span) => span.name === "http.attempt");
  expect(kids.length).toBe(2);
  expect(kids[0].status).toBe("ok");
  expect(kids[0].attributes.status).toBe(503);
  await scope.close();
});

test("a 404 is not retried and arrives raw", async () => {
  let calls = 0;
  const missing: HttpClient.Backend = async (request) => {
    calls += 1;
    return HttpResponse.make(request, { status: 404, body: "nf" });
  };
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    tags: [backend(missing), config({ retry: retryingRetry })],
  });
  const res = await scope.run(retryingRaw);
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("nf");
  expect(calls).toBe(1);
  await scope.close();
});

test("closing during backoff cancels the scope without another retry", async () => {
  const boom = new Error("boom");
  let calls = 0;
  const failing: HttpClient.Backend = async () => {
    calls += 1;
    throw boom;
  };
  const scope = createScope({
    clock: makeTestClock({ now: 0 }),
    tags: [backend(failing), config({ retry: flakyRetry })],
  });
  const running = scope.run(flakyText);
  await until(() => calls === 1);
  await drain();
  const closing = scope.close();
  const outcome = await running.then(
    () => "resolved",
    (error: unknown) => error,
  );
  const result = await closing;
  expect(result.status).toBe("cancelled");
  expect(outcome).not.toBe(boom);
  if (outcome instanceof Error && isHttpError(outcome, "RequestFailed")) throw outcome;
  expect(calls).toBe(1);
});

test("a call signal cancels a namespaced retry wait and leaves the root usable", async () => {
  const seen: string[] = [];
  const delays: number[] = [];
  const wobbly: HttpClient.Backend = async (request) => {
    seen.push(HttpRequest.toUrl(request));
    return HttpResponse.make(request, { status: seen.length === 1 ? 503 : 200 });
  };
  const clock = makeTestClock();
  const stop = new AbortController();
  const callStop = new AbortController();
  const reason = { instruction: "send the next request" };
  const scope = createScope({
    signal: stop.signal,
    clock,
    tags: [
      backend(wobbly),
      config({
        retry: {
          times: 2,
          delay: (attempt) => {
            delays.push(attempt);
            return 1000;
          },
        },
      }),
    ],
  });
  await scope.ready;
  try {
    const running = scope.settle(send, {
      ns: github,
      signal: callStop.signal,
      input: HttpRequest.get("/retry"),
    });
    await until(() => delays.length === 1);
    expect(delays).toEqual([1]);
    callStop.abort(reason);
    const cancelled = await running;
    if (cancelled.status !== "cancelled") expect.unreachable();
    expect(cancelled.reason).toBe(reason);

    const fresh = await scope.run(send, { ns: github, input: HttpRequest.get("/fresh") });
    expect(fresh.status).toBe(200);
    clock.advance(1000);
    await drain();
    expect(seen).toEqual(["https://api.github.com/retry", "https://api.github.com/fresh"]);
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test("without retry a rejecting backend fails Transport after one call with its cause", async () => {
  const boom = new Error("boom");
  let calls = 0;
  const failing: HttpClient.Backend = async () => {
    calls += 1;
    throw boom;
  };
  const scope = createScope({ clock: makeTestClock({ now: 0 }), tags: [backend(failing)] });
  try {
    await scope.run(plainText);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "RequestFailed")) throw error;
    expect(error.payload.reason).toBe("Transport");
    expect(error.payload.cause).toBe(boom);
  }
  expect(calls).toBe(1);
  await scope.close();
});

/** Run `retryingText` in a session whose backend throws `thrown` once, then answers "[]". */
async function retryInSession(thrown: unknown): Promise<[string, string]> {
  let calls = 0;
  const once: HttpClient.Backend = async (request) => {
    calls += 1;
    if (calls === 1) throw thrown;
    return HttpResponse.make(request, { status: 200, body: "[]" });
  };
  const scope = createScope({ tags: [backend(once), config({ retry: retryingRetry })] });
  const session = scope.createSession();
  const text = await session.run(retryingText);
  const closed = await session.close({ graceful: true });
  await scope.close();
  return [text, closed.status];
}

test("a backend TypeError is retried as Transport and its session still closes success", async () => {
  expect(await retryInSession(new TypeError("fetch failed"))).toEqual(["[]", "success"]);
});

test("a backend managed error is retried and its session still closes success", async () => {
  const offline = Object.assign(new Error("Offline"), { kind: "Offline", payload: {} });
  expect(await retryInSession(offline)).toEqual(["[]", "success"]);
});

test("a throwing accept is thrown unchanged and never retried", async () => {
  const bug = new TypeError("bug in accept");
  let calls = 0;
  const ok: HttpClient.Backend = async (request) => {
    calls += 1;
    return HttpResponse.make(request, { status: 200, body: "x" });
  };
  const accept = (): boolean => {
    throw bug;
  };
  const scope = createScope({ tags: [backend(ok), config({ retry: retryingRetry, accept })] });
  const outcome = await scope.run(retryingText).then(
    () => "resolved",
    (error: unknown) => error,
  );
  expect(outcome).toBe(bug);
  expect(calls).toBe(1);
  await scope.close();
});
