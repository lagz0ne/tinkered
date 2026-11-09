import { createMemory, memory } from "@tinker/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { channel, createScope, operation, resource, rpc, transport } from "@/main";
import type { Observe } from "@/main";

// The memory transport: each request in its own server session, in the caller's trace, with
// the request and its stop bound, as a socket server binds them.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const api = rpc({
  who: {
    input: z.null(),
    output: z.object({ who: z.string(), url: z.string(), stop: z.boolean() }),
  },
  count: { mode: "stream", input: z.null(), output: z.number() },
  heard: { mode: "stream", input: z.null(), output: z.string() },
});

const closed: string[] = [];

const perRequest = resource({
  label: "per.request",
  target: "session",
  factory: (_deps, ctx) => {
    ctx.defer(() => void closed.push("request"));
    return {};
  },
});

const who = operation({
  label: "who.here",
  input: z.null(),
  depends: { req: transport.request, stop: transport.requestStop, perRequest },
  run: ({ req, stop }) => ({
    who: req.headers.get("x-who") ?? "",
    url: req.url,
    stop: stop instanceof AbortSignal,
  }),
});

const count = operation({
  label: "count.here",
  input: z.null(),
  depends: { out: channel.required, perRequest },
  run: ({ out }) => out.send(1),
});

const heard = operation({
  label: "heard.here",
  input: z.null(),
  depends: { out: channel.required, req: transport.request, stop: transport.requestStop },
  run: ({ out, req, stop }) =>
    out.send(`${req.headers.get("x-who") ?? ""} ${req.url} ${stop instanceof AbortSignal}`),
});

async function pair(headers?: Record<string, string>) {
  const spans: Observe.Span[] = [];
  const server = await createScope({
    observe: { export: (s) => void spans.push(s) },
    capsules: [api({ implement: { who, count, heard } }), memory.server({ services: [api] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    observe: { export: (s) => void spans.push(s) },
    capsules: [
      memory.client({ peer: server, ...(headers ? { headers } : {}) }),
      api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => tab.close());

  return { server, tab, spans };
}

test("a call reaches the server with the request: its headers, its url, its stop", async () => {
  const { tab } = await pair({ "x-who": "ana" });

  expect(await tab.run(api.who, { input: null })).toEqual({
    who: "ana",
    url: "http://memory/who",
    stop: true,
  });
});

test("a watch reaches the server with the request too", async () => {
  const { tab } = await pair({ "x-who": "bo" });

  const seen: unknown[] = [];
  for await (const line of await tab.run(api.heard, { input: null })) {
    seen.push(line);
    break;
  }
  expect(seen).toEqual(["bo http://memory/heard true"]);
});

test("a client with no headers sends none", async () => {
  const { tab } = await pair();

  expect(await tab.run(api.who, { input: null })).toMatchObject({ who: "" });
});

test("each request runs in its own server session, closed when it ends", async () => {
  const { tab } = await pair();
  closed.length = 0;

  await tab.run(api.who, { input: null });
  expect(closed).toEqual(["request"]);

  for await (const _ of await tab.run(api.count, { input: null })) break;
  await tick();
  expect(closed).toEqual(["request", "request"]);
});

test("the server's spans are in the caller's trace, under the transport's own spans", async () => {
  const { tab, spans } = await pair();

  await tab.run(api.who, { input: null });
  for await (const _ of await tab.run(api.count, { input: null })) break;
  await tick();

  const named = (name: string) => spans.filter((s) => s.name === name);
  const [send] = named("memory.send");
  const [open] = named("memory.open");
  const [serve] = named("memory.serve");
  const [stream] = named("memory.serveStream");

  expect([send, open, serve, stream].every(Boolean)).toBe(true);
  expect(serve!.traceId).toBe(send!.traceId);
  expect(serve!.parentSpanId).toBe(send!.spanId);
  expect(stream!.traceId).toBe(open!.traceId);
  expect(stream!.parentSpanId).toBe(open!.spanId);
  expect(named("memory.call").length + named("memory.watch").length).toBeGreaterThan(0);
});

test("the transports' names: each createMemory is its own", () => {
  const other = createMemory();

  expect(other.client).not.toBe(memory.client);
  expect([memory.client.label, memory.server.label]).toEqual(["memory", "memory.server"]);
  expect([memory.client.call.label, memory.client.watch.label]).toEqual([
    "memory.call",
    "memory.watch",
  ]);
  expect([memory.server.serve.label, memory.server.serveStream.label]).toEqual([
    "memory.serve",
    "memory.serveStream",
  ]);
});

test("a client needs its peer, and a server its services", async () => {
  const fails = (capsules: unknown[]) => {
    try {
      return createScope({ capsules: capsules as never }).ready.then(
        () => null,
        (e: unknown) => e,
      );
    } catch (error) {
      return error;
    }
  };

  expect(await fails([memory.client({} as never)])).toMatchObject({
    kind: "MissingConfig",
    payload: { label: "memory", key: "peer" },
  });
  expect(await fails([memory.server({} as never)])).toMatchObject({
    kind: "MissingConfig",
    payload: { label: "memory.server", key: "services" },
  });
});

test("a server is lenient by default: two services with one address still start", async () => {
  const shadow = rpc({ who: { input: z.null(), output: z.null() } });
  const server = await createScope({
    capsules: [
      api({ implement: { who, count, heard } }),
      shadow({
        implement: { who: operation({ label: "shadow", input: z.null(), run: () => null }) },
      }),
      memory.server({ services: [api, shadow] }),
    ],
  }).ready;
  closers.push(() => server.close());

  expect(server).toBeDefined();
});
