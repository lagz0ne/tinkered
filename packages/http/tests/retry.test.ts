import { expect, test } from "vite-plus/test";
import { createScope, operation, makeTestClock } from "@tinker/core";
import {
  backend,
  httpClient,
  HttpRequest,
  HttpResponse,
  isError as isHttpError,
  type HttpClient,
} from "../src/index.ts";

const flaky = httpClient({ label: "flaky", retry: { times: 2, delay: (n) => n * 1000 } });
const retrying = httpClient({ label: "retrying", retry: { times: 2 } });
const plain = httpClient({ label: "plain" });

const flakyText = operation({
  label: "flaky.text",
  depends: { send: flaky.send },
  run: async ({ send }, ctx) => {
    const received = await send.run({
      input: HttpRequest.get("https://api/repos"),
    });
    return ((res) => res.text())(received);
  },
});

const retryingText = operation({
  label: "retrying.text",
  depends: { send: retrying.send },
  run: async ({ send }, ctx) => {
    const received = await send.run({
      input: HttpRequest.get("https://api/repos"),
    });
    return ((res) => res.text())(received);
  },
});

const retryingRaw = operation({
  label: "retrying.raw",
  depends: { send: retrying.send },
  run: ({ send }, ctx) => send.run({ input: HttpRequest.get("https://api/missing") }),
});

const plainText = operation({
  label: "plain.text",
  depends: { send: plain.send },
  run: async ({ send }, ctx) => {
    const received = await send.run({
      input: HttpRequest.get("https://api/repos"),
    });
    return ((res) => res.text())(received);
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
    tags: [backend(failing)],
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
  const kids = scope.spans().filter((span) => span.name === "flaky.attempt");
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
    tags: [backend(wobbly)],
  });
  expect(await scope.run(retryingText)).toBe("back");
  expect(calls).toBe(2);
  const kids = scope.spans().filter((span) => span.name === "retrying.attempt");
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
  const scope = createScope({ clock: makeTestClock({ now: 0 }), tags: [backend(missing)] });
  const res = await scope.run(retryingRaw);
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("nf");
  expect(calls).toBe(1);
  await scope.close();
});

test("closing during backoff rejects with the abort reason and makes no further call", async () => {
  const boom = new Error("boom");
  let calls = 0;
  const failing: HttpClient.Backend = async () => {
    calls += 1;
    throw boom;
  };
  const scope = createScope({ clock: makeTestClock({ now: 0 }), tags: [backend(failing)] });
  const running = scope.run(flakyText);
  await until(() => calls === 1);
  await drain();
  const closing = scope.close();
  const outcome = await running.then(
    () => "resolved",
    (error: unknown) => error,
  );
  const result = await closing;
  // The first attempt already failed real work (`boom`) before the close parked the
  // retry on the clock: reality wins over the abort, so the scope settles `failed`
  // with the recorded failure (ADR 0028) — but the run itself still surfaces the
  // abort reason, never a wrapped Transport.
  expect(result.status).toBe("failed");
  if (result.status !== "failed") throw result;
  expect(result.error).toBe(boom);
  expect(outcome).not.toBe(boom);
  if (outcome instanceof Error && isHttpError(outcome, "RequestFailed")) throw outcome;
  expect(calls).toBe(1);
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
