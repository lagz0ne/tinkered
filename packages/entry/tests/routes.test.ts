import { createScope, namespace, operation } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";

import { requestBody, routes } from "@/server";

const echo = operation({
  label: "echo",
  input: z.object({ id: z.string(), q: z.string() }),
  run: (_deps, { input }) => input,
});

const empty = operation({ label: "empty", run: () => undefined });
const raw = operation({ label: "raw", run: () => new Response("ok", { status: 201 }) });

const boom = operation({
  label: "boom",
  run: () => {
    throw new Error("boom");
  },
});

const slow = operation({
  label: "slow",
  run: (_deps, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
});

test("each route reply maps to its HTTP status", async () => {
  const stop = new AbortController();
  const app = await createScope({
    capsules: [
      routes({
        stop: stop.signal,
        table: {
          "GET /x/{id}": echo,
          "POST /empty": empty,
          "GET /raw": raw,
          "GET /boom": boom,
          "GET /slow": slow,
        },
      }),
    ],
  }).ready;
  const fetch = app.resolve(routes).fetch;
  const call = (path: string, init?: RequestInit) =>
    fetch(new Request(`http://t${path}`, init), app);

  const ok = await call("/x/7?q=a");
  expect(ok?.status).toBe(200);
  expect(await ok?.json()).toEqual({ id: "7", q: "a" });
  expect((await call("/x/7"))?.status).toBe(400);
  expect((await call("/empty", { method: "POST" }))?.status).toBe(204);
  expect((await call("/raw"))?.status).toBe(201);
  expect((await call("/boom"))?.status).toBe(500);
  expect(await call("/nope")).toBeUndefined();
  expect(await call("/empty")).toBeUndefined();

  const waiting = call("/slow");
  stop.abort();
  expect((await waiting)?.status).toBe(503);

  await app.close();
});

test("a fixed path after a param row that also fits it: the param row still wins", async () => {
  const which = (label: string) => operation({ label, run: () => new Response(label) });
  const app = await createScope({
    capsules: [
      routes({
        stop: new AbortController().signal,
        table: {
          "GET /a/first": which("fixed-first"),
          "GET /a/{id}": which("param"),
          "GET /a/late": which("fixed-late"),
          "POST /a/late": which("other-method"),
        },
      }),
    ],
  }).ready;
  const fetch = app.resolve(routes).fetch;
  const text = async (path: string, method = "GET") =>
    (await fetch(new Request(`http://t${path}`, { method }), app))?.text();

  expect(await text("/a/first")).toBe("fixed-first");
  expect(await text("/a/late")).toBe("param");
  expect(await text("/a/late", "POST")).toBe("other-method");
  expect(await text("/a/late/")).toBeUndefined();

  await app.close();
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Polls a check every 5 ms until it passes, for at most a second. */
const until = async (check: () => void) => {
  for (const started = Date.now(); ; await Bun.sleep(5)) {
    try {
      return check();
    } catch (error) {
      if (Date.now() - started > 1000) throw error;
    }
  }
};

/** The one span a run of `name` exported; it fails when there is none. */
const named = (spans: Observe.Span[], name: string) => {
  const span = spans.find((s) => s.name === name);
  if (!span) throw new Error(`no span named ${name}`);
  return span;
};

test("an early reply streams while its op runs; the op's span ends after the body ends", async () => {
  const spans: Observe.Span[] = [];
  const more = Promise.withResolvers<void>();
  const stream = operation({
    label: "stream",
    depends: { reply: routes.reply.required },
    run: async ({ reply }) => {
      const opened = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
      const body = new ReadableStream<Uint8Array>({ start: opened.resolve });
      reply(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));

      const writer = await opened.promise;
      writer.enqueue(encoder.encode("data: one\n\n"));

      await more.promise;
      writer.enqueue(encoder.encode("data: two\n\n"));
      writer.close();
    },
  });
  const app = await createScope({
    observe: { export: (span) => void spans.push(span) },
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /stream": stream } })],
  }).ready;
  const answer = app.resolve(routes).fetch;
  const http = Bun.serve({
    port: 0,
    fetch: async (r) => (await answer(r, app)) ?? new Response(null, { status: 404 }),
  });

  try {
    const response = await fetch(`${http.url}stream`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe("data: one\n\n");
    expect(spans.map((span) => span.name)).not.toContain("stream");

    more.resolve();
    let rest = "";
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      rest += decoder.decode(next.value);
    }
    expect(rest).toBe("data: two\n\n");
    await until(() => expect(named(spans, "stream").status).toBe("ok"));
  } finally {
    more.resolve();
    await http.stop(true);
    await app.close();
  }
});

test("an op that replies early and then fails keeps its reply", async () => {
  const spans: Observe.Span[] = [];
  const replied = Promise.withResolvers<void>();
  const late = operation({
    label: "late",
    depends: { reply: routes.reply.required },
    run: async ({ reply }) => {
      reply(new Response("sent", { status: 202 }));
      await replied.promise;
      throw new Error("after the reply");
    },
  });
  const app = await createScope({
    observe: { export: (span) => void spans.push(span) },
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /late": late } })],
  }).ready;

  const response = await app.resolve(routes).fetch(new Request("http://t/late"), app);
  replied.resolve();

  expect(response?.status).toBe(202);
  expect(await response?.text()).toBe("sent");
  await until(() => expect(named(spans, "late").status).toBe("failed"));

  await app.close();
});

test("after an early reply, a Response the op returns is dropped and its body cancelled", async () => {
  const cancelled = Promise.withResolvers<unknown>();
  const replied = Promise.withResolvers<void>();
  const twice = operation({
    label: "twice",
    depends: { reply: routes.reply.required },
    run: async ({ reply }) => {
      reply(new Response("first", { status: 202 }));
      await replied.promise;
      return new Response(new ReadableStream({ cancel: (reason) => cancelled.resolve(reason) }));
    },
  });
  const app = await createScope({
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /twice": twice } })],
  }).ready;

  const response = await app.resolve(routes).fetch(new Request("http://t/twice"), app);
  replied.resolve();

  expect(response?.status).toBe(202);
  expect(await response?.text()).toBe("first");
  expect(await cancelled.promise).toBeUndefined();

  await app.close();
});

test("a route op's request stop aborts when its request ends", async () => {
  const started = Promise.withResolvers<void>();
  const seen = Promise.withResolvers<unknown>();
  const held = operation({
    label: "held",
    depends: { stop: routes.stop.required },
    run: ({ stop }) =>
      new Promise((_, reject) => {
        stop.addEventListener("abort", () => {
          seen.resolve(stop.reason);
          reject(stop.reason);
        });
        started.resolve();
      }),
  });
  const app = await createScope({
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /held": held } })],
  }).ready;
  const client = new AbortController();
  const reason = new DOMException("left", "AbortError");
  const waiting = app
    .resolve(routes)
    .fetch(new Request("http://t/held", { signal: client.signal }), app);
  await started.promise;

  client.abort(reason);

  expect(await seen.promise).toBe(reason);
  expect((await waiting)?.status).toBe(503);
  await app.close();
});

test("a request body a route opens ends when the server stops", async () => {
  const started = Promise.withResolvers<void>();
  const ended = Promise.withResolvers<boolean>();
  const read = operation({
    label: "read",
    depends: { body: requestBody, request: routes.request.required },
    run: async ({ body, request }) => {
      const reader = body.open(request.body!);
      started.resolve();
      const next = await reader.read();
      ended.resolve(next.done);
    },
  });
  const stop = new AbortController();
  const app = await createScope({
    capsules: [routes({ stop: stop.signal, table: { "POST /read": read } })],
  }).ready;
  const open = new ReadableStream<Uint8Array>();
  const waiting = app
    .resolve(routes)
    .fetch(new Request("http://t/read", { method: "POST", body: open }), app);
  await started.promise;

  stop.abort();

  expect(await ended.promise).toBe(true);
  expect((await waiting)?.status).toBe(503);
  await app.close();
});

test("a second reply is dropped and its body cancelled; the first one answers", async () => {
  const cancelled = Promise.withResolvers<unknown>();
  const both = operation({
    label: "both",
    depends: { reply: routes.reply.required },
    run: ({ reply }) => {
      reply(new Response("first"));
      reply(new Response(new ReadableStream({ cancel: (reason) => cancelled.resolve(reason) })));
    },
  });
  const app = await createScope({
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /both": both } })],
  }).ready;

  const response = await app.resolve(routes).fetch(new Request("http://t/both"), app);

  expect(await response?.text()).toBe("first");
  expect(await cancelled.promise).toBeUndefined();
  await app.close();
});

const remote = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
const valid = `00-${remote.traceId}-${remote.spanId}-01`;

/** Bad headers: each one is ignored, so the request starts a fresh trace. */
const malformed = [
  "",
  "garbage",
  valid.toUpperCase(),
  `ff-${remote.traceId}-${remote.spanId}-01`,
  `01-${remote.traceId}-${remote.spanId}-01`,
  `00-${"0".repeat(32)}-${remote.spanId}-01`,
  `00-${remote.traceId}-${"0".repeat(16)}-01`,
  `00-${remote.traceId.slice(2)}-${remote.spanId}-01`,
  `${valid}-extra`,
];

const traced = operation({ label: "trace.echo", run: () => ({ ok: true }) });

test("a request with a valid traceparent gives a route span that is its child", async () => {
  const spans: Observe.Span[] = [];
  const app = await createScope({
    observe: { export: (span) => void spans.push(span) },
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /echo": traced } })],
  }).ready;

  const response = await app
    .resolve(routes)
    .fetch(new Request("http://t/echo", { headers: { traceparent: valid } }), app);

  expect([response?.status, response?.headers.get("cache-control")]).toEqual([200, "no-store"]);
  const span = named(spans, "trace.echo");
  expect(span.traceId).toBe(remote.traceId);
  expect(span.parentSpanId).toBe(remote.spanId);
  expect(span.sampled).toBe(true);
  await app.close();
});

test("a missing or malformed traceparent starts a fresh trace; the request still answers 200", async () => {
  const spans: Observe.Span[] = [];
  const app = await createScope({
    observe: { export: (span) => void spans.push(span) },
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /echo": traced } })],
  }).ready;
  const fetch = app.resolve(routes).fetch;

  for (const header of [undefined, ...malformed]) {
    const headers: Record<string, string> = header === undefined ? {} : { traceparent: header };
    spans.length = 0;

    const response = await fetch(new Request("http://t/echo", { headers }), app);

    expect(response?.status).toBe(200);
    const span = named(spans, "trace.echo");
    expect(span.traceId).not.toBe(remote.traceId);
    expect(span.parentSpanId).toBeUndefined();
  }
  await app.close();
});

test("a request after the root closed answers 500, it does not reject", async () => {
  const closing = await createScope({
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /echo": traced } })],
  }).ready;
  const answer = closing.resolve(routes).fetch;
  await closing.close();

  const response = await answer(new Request("http://t/echo"), closing);

  expect(response?.status).toBe(500);
});

test("a row bound to a quiet namespace makes no span, even when it fails", async () => {
  const spans: Observe.Span[] = [];
  const hushed = operation({
    label: "hushed",
    run: () => {
      throw new Error("quiet failure");
    },
  });
  const loud = operation({ label: "loud", run: () => ({ ok: true }) });
  const app = await createScope({
    observe: { export: (span) => void spans.push(span) },
    tags: [routes.ns({ op: hushed, ns: namespace({ observe: false }) })],
    capsules: [
      routes({
        stop: new AbortController().signal,
        table: { "GET /hushed": hushed, "GET /loud": loud },
      }),
    ],
  }).ready;
  const fetch = app.resolve(routes).fetch;

  const statuses = [
    (await fetch(new Request("http://t/hushed"), app))?.status,
    (await fetch(new Request("http://t/loud"), app))?.status,
  ];

  expect(statuses).toEqual([500, 200]);
  expect(spans.map((span) => span.name)).toEqual(["loud"]);
  await app.close();
});

test("a route borrows the body: after the request the body is free again", async () => {
  const peek = operation({
    label: "peek",
    depends: { body: requestBody, request: routes.request.required },
    run: async ({ body, request }) => {
      const first = await body.open(request.body!).read();
      return decoder.decode(first.value);
    },
  });
  const skip = operation({ label: "skip", depends: { body: requestBody }, run: () => undefined });
  const app = await createScope({
    capsules: [
      routes({
        stop: new AbortController().signal,
        table: { "POST /peek": peek, "POST /skip": skip },
      }),
    ],
  }).ready;
  const fetch = app.resolve(routes).fetch;
  const incoming = new Request("http://t/peek", { method: "POST", body: "abc" });

  const peeked = await fetch(incoming, app);
  const skipped = await fetch(new Request("http://t/skip", { method: "POST", body: "x" }), app);

  expect(await peeked?.json()).toBe("abc");
  expect(incoming.body?.locked).toBe(false);
  expect(skipped?.status).toBe(204);
  await app.close();
});

test("a body opened after its request ended is cancelled at once", async () => {
  const started = Promise.withResolvers<void>();
  const late = Promise.withResolvers<void>();
  const ended = Promise.withResolvers<boolean>();
  const read = operation({
    label: "read-late",
    depends: { body: requestBody, request: routes.request.required },
    run: async ({ body, request }) => {
      started.resolve();
      await late.promise;
      const next = await body.open(request.body!).read();
      ended.resolve(next.done);
    },
  });
  const app = await createScope({
    capsules: [routes({ stop: new AbortController().signal, table: { "POST /read": read } })],
  }).ready;
  const client = new AbortController();
  const open = new ReadableStream<Uint8Array>();
  const waiting = app
    .resolve(routes)
    .fetch(
      new Request("http://t/read", { method: "POST", body: open, signal: client.signal }),
      app,
    );
  await started.promise;

  client.abort();
  late.resolve();

  expect(await ended.promise).toBe(true);
  expect((await waiting)?.status).toBe(503);
  await app.close();
});

test("the root's close waits for a dropped reply's cancel; a failed cancel is a warning", async () => {
  const lines: string[] = [];
  const slow = Promise.withResolvers<void>();
  let cancelled = false;
  const many = operation({
    label: "many",
    depends: { reply: routes.reply.required },
    run: ({ reply }) => {
      reply(new Response("first"));
      reply(new Response(null));
      reply(new Response(new ReadableStream({ cancel: () => slow.promise })));
      reply(
        new Response(
          new ReadableStream({
            cancel: () => {
              throw new Error("no cancel");
            },
          }),
        ),
      );
    },
  });
  const app = await createScope({
    observe: { log: (line) => void lines.push(line.message) },
    capsules: [routes({ stop: new AbortController().signal, table: { "GET /many": many } })],
  }).ready;
  const response = await app.resolve(routes).fetch(new Request("http://t/many"), app);
  expect(await response?.text()).toBe("first");

  const closing = app.close().then(() => cancelled);
  await new Promise((turn) => setImmediate(turn));
  cancelled = true;
  slow.resolve();

  expect(await closing).toBe(true);
  expect(lines).toEqual(["routes: a dropped reply's body did not cancel"]);
});
