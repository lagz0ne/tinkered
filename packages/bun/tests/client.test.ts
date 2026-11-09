import { channel, createScope, data, operation, remoteData, rpc } from "@tinker/core";
import type { Observe, Scope } from "@tinker/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createWs, ws } from "@/client";
import { ws as wsServer } from "@/index";

// The client side, frame by frame: what each call, watch, stop and close puts on the socket.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const api = rpc({
  echo: { input: z.object({ n: z.number() }), output: z.object({ n: z.number() }) },
  slow: { input: z.null(), output: z.null() },
  count: { mode: "stream", input: z.null(), output: z.number() },
  ticks: { mode: "stream", input: z.null(), output: z.number() },
});

let release = () => {};

const echo = operation({
  label: "echo.here",
  input: api.echo.input,
  run: async (_, { input }) => input,
});

const slow = operation({
  label: "slow.here",
  input: z.null(),
  run: () => new Promise<null>((done) => (release = () => done(null))),
});

const count = operation({
  label: "count.here",
  input: z.null(),
  depends: { out: channel.required },
  run: ({ out }) => {
    for (let n = 0; n < 3; n++) out.send(n);
  },
});

const ticks = operation({
  label: "ticks.here",
  input: z.null(),
  depends: { out: channel.required },
  run: async ({ out }) => {
    for (let n = 0; !out.closed.aborted; n++) {
      out.send(n);
      await tick(5);
    }
  },
});

/** Every frame the tab's sockets send and get, and each socket's close code, by order. */
function spy() {
  const sent: Array<Array<Record<string, unknown>>> = [];
  const got: Array<Array<Record<string, unknown>>> = [];
  const opened: Array<{ url: string; headers?: Record<string, string> }> = [];
  const closed: number[] = [];
  const Real = globalThis.WebSocket;
  globalThis.WebSocket = class extends Real {
    constructor(url: string, options?: { headers?: Record<string, string> }) {
      super(url, options as never);
      opened.push({ url, headers: options?.headers });
      this.addEventListener("message", (e) => got.push(JSON.parse(String(e.data))));
    }
    override send(d: string) {
      sent.push(JSON.parse(d));
      super.send(d);
    }
    override close(code?: number, reason?: string) {
      closed.push(code ?? 0);
      super.close(code, reason);
    }
  } as typeof WebSocket;
  closers.push(() => (globalThis.WebSocket = Real));

  return { sent, got, opened, closed, messages: () => sent.flat() };
}

async function serve(seen: string[] = []) {
  const transport = wsServer.server({ path: "/rpc", services: [api as never] });
  const scope = await createScope({
    capsules: [api({ implement: { echo, slow, count, ticks } }), transport],
  }).ready;
  closers.push(() => scope.close());

  const door = scope.resolve(transport);
  const bun = Bun.serve({
    port: 0,
    idleTimeout: 0,
    websocket: door.websocket as never,
    fetch: (r, b) => {
      seen.push(r.headers.get("x-who") ?? "");
      const reply = door.upgrade(r, scope, b as never);
      return reply === null ? undefined : (reply ?? new Response(null, { status: 404 }));
    },
  });
  closers.push(() => bun.stop(true));

  return { scope, bun, url: `ws://localhost:${bun.port}/rpc` };
}

async function tab(url: string, extra: Record<string, unknown> = {}, observe?: Observe.Config) {
  const client = await createScope({
    observe,
    capsules: [ws.client({ url, ...extra }), api({ remote: ws.client })],
  }).ready;
  closers.push(() => client.close());
  return client;
}

const faultOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (api.fault.is(e) ? { fault: e.fault, payload: e.payload } : e),
  );

test("a call goes as one message: its id, address, text, and the call's traceparent", async () => {
  const { url } = await serve();
  const frames = spy();
  const spans: Array<{ name: string; traceId: string }> = [];
  const client = await tab(url, {}, { export: (s) => void spans.push(s) });

  expect(await client.run(api.echo, { input: { n: 7 } })).toEqual({ n: 7 });
  const [message] = frames.messages();
  expect(message).toMatchObject({ i: 1, a: "echo", t: '{"n":7}' });
  expect(String(Object(message).m.traceparent)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  expect(Object(message).w).toBeUndefined();
  expect(spans.map((s) => s.name)).toContain("ws.send");
  expect(frames.got.flat()).toEqual([{ i: 1, t: expect.any(String) }]);
});

test("ids count up per tab, one per call and per watch", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);

  await client.run(api.echo, { input: { n: 1 } });
  await client.run(api.echo, { input: { n: 2 } });
  const seen: number[] = [];
  for await (const n of await client.run(api.count, { input: null })) seen.push(n as number);

  expect(seen).toEqual([0, 1, 2]);
  expect(frames.messages().map((m) => m.i)).toEqual([1, 2, 3]);
  expect(frames.messages()[2]).toMatchObject({ a: "count", w: 1 });
});

test("a call stopped by its caller sends a stop for its id, and fails with the reason", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);
  const stop = new AbortController();

  const running = client.run(api.slow, { input: null, signal: stop.signal });
  await tick();
  stop.abort(new Error("left"));
  const failed = await running.then(
    () => null,
    (e: unknown) => e,
  );
  await tick();
  release();

  expect(frames.messages()).toEqual([expect.objectContaining({ i: 1, a: "slow" }), { i: 1, x: 1 }]);
  expect(failed).toBeDefined();
  expect(failed).not.toBeNull();
});

test("a watch the reader leaves sends a stop for its id, once", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);

  for await (const n of await client.run(api.ticks, { input: null })) {
    if (n === 1) break;
  }
  await tick(50);

  expect(frames.messages()).toEqual([
    expect.objectContaining({ i: 1, a: "ticks", w: 1 }),
    { i: 1, x: 1 },
  ]);
});

test("headers go on the upgrade, and a tab with none sends none", async () => {
  const seen: string[] = [];
  const { url } = await serve(seen);
  const frames = spy();

  const a = await tab(url, { headers: { "x-who": "ana" } });
  await a.run(api.echo, { input: { n: 1 } });
  const b = await tab(url);
  await b.run(api.echo, { input: { n: 2 } });

  expect(seen).toEqual(["ana", ""]);
  expect(frames.opened.map((o) => o.headers)).toEqual([{ "x-who": "ana" }, undefined]);
});

test("closing the tab closes its socket with 1000", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);

  await client.run(api.echo, { input: { n: 1 } });
  await client.close();

  expect(frames.closed).toEqual([1000]);
});

test("reset closes the socket in use with 1000, and a reset with no socket does nothing", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);

  client.run(ws.client.reset);
  expect(frames.closed).toEqual([]);

  await client.run(api.echo, { input: { n: 1 } });
  client.run(ws.client.reset);
  expect(frames.closed).toEqual([1000]);
});

test("a server that goes away fails each waiting call as link", async () => {
  const { url, bun } = await serve();
  const client = await tab(url);

  await client.run(api.echo, { input: { n: 1 } });
  const waiting = faultOf(client.run(api.slow, { input: null }));
  await tick();
  await bun.stop(true);

  expect(await waiting).toMatchObject({ fault: "link" });
  release();
});

test("a socket that drops fails its calls as link; the next call opens a new socket", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);

  await client.run(api.echo, { input: { n: 1 } });
  const waiting = faultOf(client.run(api.slow, { input: null }));
  await tick();
  client.run(ws.client.reset);

  expect(await waiting).toMatchObject({ fault: "link" });
  expect(await client.run(api.echo, { input: { n: 2 } })).toEqual({ n: 2 });
  expect(frames.opened.length).toBe(2);
  release();
});

test("a tab with no url does not start: the url is required", () => {
  expect(() => createScope({ capsules: [ws.client({} as never)] })).toThrow("MissingConfig");
});

test("call and watch run only inside a scope that holds the capsule", () => {
  const bare = createScope({});
  closers.push(() => bare.close());

  expect(() => bare.run(ws.client.call, { input: { address: "a", value: 1, meta: {} } })).toThrow(
    "CapsuleMissing",
  );
});

test("each createWs is its own client, with its own labels", () => {
  const other = createWs();

  expect(other.client).not.toBe(ws.client);
  expect(ws.client.label).toBe("ws");
  expect(ws.client.call.label).toBe("ws.call");
  expect(ws.client.watch.label).toBe("ws.watch");
  expect(ws.client.reset.label).toBe("ws.reset");
});

test("remoteData over the socket reads a cell and its pushes", async () => {
  const cell = data({ initial: 0 });
  const board = remoteData({ cell });
  const bump = operation({
    label: "bump",
    depends: { c: cell.controller },
    run: ({ c }) => c.set(c.get() + 1),
  });
  const transport = wsServer.server({ path: "/rpc", services: [board as never] });
  const server: Scope.Handle = await createScope({ capsules: [board({ serve: true }), transport] })
    .ready;
  closers.push(() => server.close());
  const door = server.resolve(transport);
  const bun = Bun.serve({
    port: 0,
    idleTimeout: 0,
    websocket: door.websocket as never,
    fetch: (r, b) => {
      const reply = door.upgrade(r, server, b as never);
      return reply === null ? undefined : (reply ?? new Response(null, { status: 404 }));
    },
  });
  closers.push(() => bun.stop(true));
  const reader = await createScope({
    capsules: [ws.client({ url: `ws://localhost:${bun.port}/rpc` }), board({ read: ws.client })],
  }).ready;
  closers.push(() => reader.close());

  await tick();
  server.run(bump);
  await tick();
  expect(reader.resolve(board.cell).get()).toBe(1);
});

test("a call aborted after its answer sends no stop", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);
  const stop = new AbortController();

  await client.run(api.echo, { input: { n: 1 }, signal: stop.signal });
  stop.abort(new Error("late"));
  await tick();

  expect(frames.messages()).toEqual([expect.objectContaining({ i: 1, a: "echo" })]);
});

test("a watch that ended sends no stop, and its open span is ws.open", async () => {
  const { url } = await serve();
  const frames = spy();
  const spans: string[] = [];
  const client = await tab(url, {}, { export: (s) => void spans.push(s.name) });

  for await (const n of await client.run(api.count, { input: null })) void n;
  await tick(50);

  expect(frames.messages()).toEqual([expect.objectContaining({ i: 1, a: "count", w: 1 })]);
  expect(spans).toContain("ws.open");
});

test("a watch the server answers with a status fails as link", async () => {
  const transport = wsServer.server({ path: "/rpc", services: [api as never], maxWatches: 0 });
  const scope = await createScope({
    capsules: [api({ implement: { echo, slow, count, ticks } }), transport],
  }).ready;
  closers.push(() => scope.close());

  const door = scope.resolve(transport);
  const bun = Bun.serve({
    port: 0,
    idleTimeout: 0,
    websocket: door.websocket as never,
    fetch: (r, b) => (door.upgrade(r, scope, b as never) === null ? undefined : new Response(null)),
  });
  closers.push(() => bun.stop(true));
  const client = await tab(`ws://localhost:${bun.port}/rpc`);

  const drain = async () => {
    for await (const n of await client.run(api.count, { input: null })) void n;
  };
  expect(await faultOf(drain())).toMatchObject({ fault: "link" });
});

test("a socket that drops fails its watch as link, and the tab's close skips the dropped socket", async () => {
  const { url, bun } = await serve();
  const frames = spy();
  const client = await tab(url);

  const values = await client.run(api.ticks, { input: null });
  const drain = async () => {
    for await (const n of values) void n;
  };
  const failed = faultOf(drain());
  await tick();
  await bun.stop(true);

  expect(await failed).toMatchObject({ fault: "link" });
  await client.close();
  expect(frames.closed).toEqual([]);
});

test("32 calls of one tick go as one frame, with no empty frame after", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url);

  await Promise.all(Array.from({ length: 32 }, (_, n) => client.run(api.echo, { input: { n } })));

  expect(frames.sent.map((f) => f.length)).toEqual([32]);
});

test("reset tells the server why: its close reason is reset", async () => {
  const reasons: string[] = [];
  const transport = wsServer.server({ path: "/rpc", services: [api as never] });
  const scope = await createScope({
    capsules: [api({ implement: { echo, slow, count, ticks } }), transport],
  }).ready;
  closers.push(() => scope.close());

  const door = scope.resolve(transport);
  const websocket = door.websocket as unknown as {
    close: (ws: unknown, ...rest: unknown[]) => void;
  };
  const close = websocket.close;
  websocket.close = (ws, code, reason) => (reasons.push(String(reason)), close(ws, code, reason));
  const bun = Bun.serve({
    port: 0,
    idleTimeout: 0,
    websocket: websocket as never,
    fetch: (r, b) => (door.upgrade(r, scope, b as never) === null ? undefined : new Response(null)),
  });
  closers.push(() => bun.stop(true));
  const client = await tab(`ws://localhost:${bun.port}/rpc`);

  await client.run(api.echo, { input: { n: 1 } });
  client.run(ws.client.reset);
  await tick(50);

  expect(reasons).toEqual(["reset"]);
});

test("a watch takes the next id and carries the traceparent; a call after it takes the one after", async () => {
  const { url } = await serve();
  const frames = spy();
  const client = await tab(url, {}, { export: () => undefined });

  for await (const n of await client.run(api.count, { input: null })) void n;
  await client.run(api.echo, { input: { n: 1 } });

  const [watch, call] = frames.messages();
  expect([watch?.i, call?.i]).toEqual([1, 2]);
  expect(String(Object(watch).m.traceparent)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});
