import { createScope, extension, isError } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  paymentApp,
  port,
  host,
  controlToken,
  stopSignal,
  webhookUrl,
  webhookSecret,
} from "../src/index";
import { httpBackend, httpRequest } from "../services/http-client";
import { calls } from "../services/http";

const replies = [
  { status: 200, delivery: "delivered" },
  { status: 299, delivery: "delivered" },
  { status: 300, delivery: "rejected" },
  { status: 503, delivery: "rejected" },
  { status: 0, delivery: "unreachable" },
];

const badRequests = [
  { url: "ftp://127.0.0.1/", method: "GET" },
  { url: "xhttp://127.0.0.1/", method: "GET" },
  { url: "httpx://127.0.0.1/", method: "GET" },
  { url: "http://127.0.0.1/", method: " GET" },
  { url: "http://127.0.0.1/", method: "GET " },
  { url: "http://127.0.0.1/", method: "GET\n" },
  { url: "http://127.0.0.1/", method: "" },
];

test.each(badRequests)(
  "outgoing HTTP rejects invalid URL or method %j before sending",
  async (input) => {
    const stop = new AbortController();
    const scope = createScope({ signal: stop.signal });
    try {
      try {
        await scope.run(httpRequest, { rawInput: input });
        expect.fail("invalid HTTP input must fail");
      } catch (error) {
        if (!isError(error, "DataValidationFailed")) throw error;
        if (!isError(error.payload.cause, "SchemaRejected")) throw error.payload.cause;
        expect(error.payload.cause.payload.issues).not.toHaveLength(0);
      }
    } finally {
      stop.abort();
      await scope.closed;
    }
  },
);

function createGate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("cancelling one HTTP call stops its send and leaves the parent able to send again", async () => {
  const stop = new AbortController();
  const cancel = new AbortController();
  const started = createGate<AbortSignal>();
  const release = createGate<Response>();
  let sends = 0;
  const scope = createScope({
    signal: stop.signal,
    tags: [
      httpBackend((_url, init) => {
        if (++sends === 2) return Promise.resolve(new Response(null, { status: 204 }));
        const signal = init?.signal;
        if (!signal) throw new TypeError("HTTP requires a signal");
        started.resolve(signal);
        return Promise.race([
          release.promise,
          new Promise<Response>((_done, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        ]);
      }),
    ],
  });
  await scope.ready;
  const result = scope.settle(httpRequest, {
    signal: cancel.signal,
    rawInput: { url: "https://example.test/held", method: "GET" },
  });
  try {
    const signal = await started.promise;
    cancel.abort();
    await expect.poll(() => signal.aborted).toBe(true);
    expect((await result).status).toBe("cancelled");
    expect(
      await scope.run(httpRequest, {
        rawInput: { url: "https://example.test/next", method: "GET" },
      }),
    ).toEqual({ status: 204 });
  } finally {
    release.resolve(new Response(null));
    stop.abort();
    await scope.closed;
  }
});

async function deliver(url: string, mode = "now") {
  const created = await fetch(`${url}/v1/payment_intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: 900, currency: "usd" }),
  });
  const intent = z.object({ id: z.string() }).parse(await created.json());
  await (
    await fetch(`${url}/control/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer grader" },
      body: JSON.stringify({ intent_id: intent.id, mode }),
    })
  ).arrayBuffer();
}

test.each(replies)(
  "a webhook reply $status records $delivery before returning to its caller",
  async ({ status, delivery }) => {
    const returned: unknown[] = [];
    const recorded: unknown[] = [];
    const outcomes = extension({
      label: "read webhook outcomes",
      hooks: {
        run(event) {
          if (event.op.label !== "deliver signed webhook") return event.next();
          return Promise.resolve(event.next()).then((value) => {
            returned.push(value);
            recorded.push(
              ...event
                .resolve(calls)
                .filter((call) => call.kind === "webhook")
                .map((call) => call.delivery),
            );
            return value;
          });
        },
      },
    });
    const stop = new AbortController();
    const scope = createScope({
      signal: stop.signal,
      extensions: [outcomes, paymentApp],
      tags: [
        port(0),
        host("127.0.0.1"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1/webhooks/stripe"),
        webhookSecret("domain-test"),
        httpBackend(async () => {
          if (status === 0) throw new TypeError("network failed");
          return new Response("reply", { status });
        }),
      ],
    });
    try {
      await scope.ready;
      const { url } = scope.resolve(paymentApp);
      await deliver(url);
      await expect.poll(() => returned).toEqual([[delivery]]);
      expect(recorded).toEqual([delivery]);
      const log = await (
        await fetch(`${url}/control/calls`, {
          headers: { authorization: "Bearer grader" },
        })
      ).json();
      expect(
        z
          .object({ data: z.array(z.object({ kind: z.string() }).passthrough()) })
          .parse(log)
          .data.filter((call) => call.kind === "webhook"),
      ).toEqual([{ kind: "webhook", route: "POST webhook", time: expect.any(Number), status }]);
    } finally {
      stop.abort();
      await scope.closed;
    }
  },
);

test("each webhook copy has an HTTP span below the webhook operation and its resource", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    observe: { history: 200 },
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrl("http://127.0.0.1:1/webhooks/stripe?secret=hidden"),
      webhookSecret("span-test"),
      httpBackend(async () => new Response("accepted", { status: 202 })),
    ],
  });
  try {
    await scope.ready;
    const { url } = scope.resolve(paymentApp);
    const created = await fetch(`${url}/v1/payment_intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 900, currency: "usd" }),
    });
    const intent = z.object({ id: z.string() }).parse(await created.json());
    await (
      await fetch(`${url}/control/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer grader" },
        body: JSON.stringify({ intent_id: intent.id, mode: "twice" }),
      })
    ).arrayBuffer();
    await expect
      .poll(() => scope.spans().filter((s) => s.name === "http POST /webhooks/stripe").length)
      .toBe(2);
    const spans = scope.spans();
    const webhook = spans.find((s) => s.name === "deliver signed webhook");
    for (const span of spans.filter((s) => s.name === "http POST /webhooks/stripe")) {
      const request = spans.find((s) => s.id === span.parentId);
      expect(request).toMatchObject({ name: "http.request", parentId: webhook?.id });
      expect(span).toMatchObject({
        status: "ok",
        attributes: {
          "http.request.method": "POST",
          "url.path": "/webhooks/stripe",
          "http.response.status_code": 202,
        },
      });
    }
    expect(spans.some((s) => s.name === "http" && s.kind === "resource")).toBe(true);
  } finally {
    stop.abort();
    await scope.closed;
  }
});
